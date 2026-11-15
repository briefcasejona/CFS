#!/usr/bin/env python3
"""Pull roads and railways for the real-world theaters out of the Overture Maps transportation theme (built from
© OpenStreetMap contributors and other open data, ODbL) into .cache/transport/*.bin, the input of bake-transport.mjs.

Everywhere inside a theater: motorways down to tertiary roads and the railways. Inside the 50 km detail squares around
the airfields (patches.json) also the local streets. Tunnels, abandoned and unbuilt lines are left out.

One file per parquet row group:
  u32 feature count N, u32 point count P, u8 class[N], u8 flags[N], u32 points[N], i32 (lon, lat)[P] in 1e-7 degrees
  class: 0 motorway 1 trunk 2 primary 3 secondary 4 tertiary 5 unclassified 6 residential, 10 railway
  flags: 1 bridge, 2 link (slip road), 4 minor rail (siding, yard; unknown gauge)

usage: pip install pyarrow shapely numpy && python3 scripts/terrain/extract-transport.py [workers]
Behind a proxy set HTTPS_PROXY (and SSL_CERT_FILE for its CA).
"""
import json, math, os, sys
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pyarrow.parquet as pq, pyarrow.fs as pafs, pyarrow.compute as pc
import shapely

RELEASE = '2026-10-21.0'
BASE = f'overturemaps-us-west-2/release/{RELEASE}/theme=transportation/type=segment/'
OUT = '.cache/transport'
# the theaters to extract (the Gulf's roads are baked and unchanged; add it back to re-extract)
THEATERS = [t for t in os.environ.get('CFS_THEATERS', 'europe,uswest').split(',') if t]
ROAD = {'motorway': 0, 'trunk': 1, 'primary': 2, 'secondary': 3, 'tertiary': 4, 'unclassified': 5, 'residential': 6, 'living_street': 6}
MAJOR = [k for k, v in ROAD.items() if v <= 4]
MINOR = [k for k, v in ROAD.items() if v > 4]
RAIL = ['standard_gauge', 'narrow_gauge', 'unknown']
R = 6371008.8

def s3():
    px = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    kw = {'proxy_options': px} if px else {}
    ca = os.environ.get('SSL_CERT_FILE')
    if ca: kw['tls_ca_file_path'] = ca
    return pafs.S3FileSystem(anonymous=True, region='us-west-2', **kw)

class Lcc:
    def __init__(s, lat0, lon0, lat1, lat2):
        f1, f2, f0 = map(math.radians, (lat1, lat2, lat0))
        t = lambda f: math.tan(math.pi / 4 + f / 2)
        s.n = math.log(math.cos(f1) / math.cos(f2)) / math.log(t(f2) / t(f1))
        s.F = math.cos(f1) * t(f1) ** s.n / s.n
        s.rho0 = R * s.F / t(f0) ** s.n
        s.lon0 = math.radians(lon0)
    def inverse(s, x, z):
        dy = s.rho0 + z
        rho = math.hypot(x, dy)
        th = math.atan2(x, dy)
        return math.degrees(2 * math.atan((R * s.F / rho) ** (1 / s.n)) - math.pi / 2), math.degrees(s.lon0 + th / s.n)

def boxes():
    """lon/lat boxes: one per theater, and one per detail square"""
    theaters, patches = [], []
    for tid in THEATERS:
        meta = json.load(open(f'assets/theaters/{tid}/meta.json'))
        lcc = Lcc(**meta['proj'])
        def box(x0, z0, x1, z1):
            pts = [lcc.inverse(x0 + (x1 - x0) * i / 8, z0 + (z1 - z0) * j / 8) for i in range(9) for j in range(9)]
            la = [p[0] for p in pts]; lo = [p[1] for p in pts]
            return (min(lo), min(la), max(lo), max(la))
        h = meta['half']
        theaters.append(box(-h, -h, h, h))
        for p in json.load(open(f'assets/theaters/{tid}/patches.json'))['patches']:
            size = (p['n'] - 1) * p['res']
            patches.append(box(p['x0'] - 500, p['z0'] - 500, p['x0'] + size + 500, p['z0'] + size + 500))
    return theaters, patches

def hits(b, boxes_):
    return any(b[0] < x1 and b[2] > x0 and b[1] < y1 and b[3] > y0 for x0, y0, x1, y1 in boxes_)

def flagged(rules, name):
    """a flag counts when it holds over more than half of the segment"""
    if not rules: return False
    cover = 0.0
    for r in rules:
        if name in (r.get('values') or []):
            bt = r.get('between')
            cover += (bt[1] - bt[0]) if bt else 1.0
    return cover > 0.5

def work(job):
    path, rg = job
    out = f"{OUT}/{os.path.basename(path).split('-')[1]}-{rg}.bin"
    if os.path.exists(out): return 0
    theaters, patches = boxes()
    t = pq.ParquetFile(s3().open_input_file(path)).read_row_group(rg, columns=['subtype', 'class', 'subclass', 'road_flags', 'rail_flags', 'geometry', 'bbox'])
    bb = t['bbox'].combine_chunks()
    x0, x1, y0, y1 = (bb.field(k).to_numpy(zero_copy_only=False) for k in ('xmin', 'xmax', 'ymin', 'ymax'))
    inside = lambda bs: np.any([(x0 < b[2]) & (x1 > b[0]) & (y0 < b[3]) & (y1 > b[1]) for b in bs], axis=0)
    sub, cls = t['subtype'], t['class']
    road = pc.equal(sub, 'road').to_numpy(zero_copy_only=False).astype(bool)
    major = pc.is_in(cls, value_set=__import__('pyarrow').array(MAJOR)).to_numpy(zero_copy_only=False).astype(bool)
    minor = pc.is_in(cls, value_set=__import__('pyarrow').array(MINOR)).to_numpy(zero_copy_only=False).astype(bool)
    rail = pc.equal(sub, 'rail').to_numpy(zero_copy_only=False).astype(bool) & pc.is_in(cls, value_set=__import__('pyarrow').array(RAIL)).to_numpy(zero_copy_only=False).astype(bool)
    keep = inside(theaters) & ((road & major) | rail | (road & minor & inside(patches)))
    idx = np.nonzero(keep)[0]
    t = t.take(idx)
    cl = t['class'].to_pylist(); sb = t['subtype'].to_pylist(); sc = t['subclass'].to_pylist()
    rf = t['road_flags'].to_pylist(); lf = t['rail_flags'].to_pylist()
    geoms = shapely.from_wkb(t['geometry'].to_numpy(zero_copy_only=False))
    C, F, G = [], [], []
    for k in range(len(cl)):
        g = geoms[k]
        if g is None or g.geom_type != 'LineString': continue
        if sb[k] == 'road':
            fl = rf[k]
            if flagged(fl, 'is_tunnel') or flagged(fl, 'is_under_construction'): continue
            C.append(ROAD[cl[k]]); F.append((1 if flagged(fl, 'is_bridge') else 0) | (2 if sc[k] == 'link' or flagged(fl, 'is_link') else 0))
        else:
            fl = lf[k]
            if any(flagged(fl, n) for n in ('is_tunnel', 'is_under_construction', 'is_abandoned', 'is_disused')): continue
            C.append(10); F.append((1 if flagged(fl, 'is_bridge') else 0) | (4 if cl[k] == 'unknown' else 0))
        G.append(g)
    G = np.array(G, dtype=object)
    if len(G):
        xy, gi = shapely.get_coordinates(G, return_index=True)
        npts = np.bincount(gi, minlength=len(G)).astype('<u4')
        co = np.round(xy * 1e7).astype('<i4')
    else:
        npts = np.zeros(0, '<u4'); co = np.zeros((0, 2), '<i4')
    with open(out + '.tmp', 'wb') as f:
        f.write(np.array([len(G), len(co)], '<u4').tobytes())
        f.write(np.array(C, 'u1').tobytes()); f.write(np.array(F, 'u1').tobytes())
        f.write(npts.tobytes()); f.write(co.tobytes())
    os.rename(out + '.tmp', out)
    return len(G)

def main():
    os.makedirs(OUT, exist_ok=True)
    fs = s3()
    theaters, _ = boxes()
    files = [f.path for f in fs.get_file_info(pafs.FileSelector(BASE)) if f.path.endswith('.parquet')]
    jobs = []
    for p in files:
        md = pq.ParquetFile(fs.open_input_file(p)).metadata
        names = [md.schema.column(i).path for i in range(md.num_columns)]
        ix = [names.index('bbox.' + n) for n in ('xmin', 'ymin', 'xmax', 'ymax')]
        for r in range(md.num_row_groups):
            st = [md.row_group(r).column(i).statistics for i in ix]
            if hits((st[0].min, st[1].min, st[2].max, st[3].max), theaters): jobs.append((p, r))
    print(len(jobs), 'row groups', flush=True)
    n = 0
    with ProcessPoolExecutor(int(sys.argv[1]) if len(sys.argv) > 1 else 6) as ex:
        for k, c in enumerate(ex.map(work, jobs, chunksize=4)):
            n += c
            if k % 100 == 0: print(k, n, flush=True)
    print('done', n)

if __name__ == '__main__': main()
