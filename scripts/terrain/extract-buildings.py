#!/usr/bin/env python3
"""Building footprints around the airfields of the real-world theaters, from the Overture Maps buildings theme (built
from © OpenStreetMap contributors and other open building datasets, ODbL), into .cache/buildings/<theater>/bld-<patch>.json,
the input of bake-buildings.mjs. One file per detail square (coverdetail.json), each building as
  [lat, lon, w, d, angle, height or -1, fill]
where w × d is the footprint's minimum-area rectangle (m), angle the direction of side w (rad, counter-clockwise from
east), height the roof height (m, -1 unknown) and fill the footprint's share of that rectangle.

usage: python3 scripts/terrain/extract-buildings.py <europe|uswest> [workers]   (same environment as extract-transport.py)
"""
import json, math, os, sys, importlib.util
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pyarrow.parquet as pq, pyarrow.fs as pafs
import shapely

spec = importlib.util.spec_from_file_location('xt', os.path.join(os.path.dirname(__file__), 'extract-transport.py'))
xt = importlib.util.module_from_spec(spec); spec.loader.exec_module(xt)
BASE = f'overturemaps-us-west-2/release/{xt.RELEASE}/theme=buildings/type=building/'
TID = sys.argv[1]
OUT = f'.cache/buildings/{TID}'

def patch_boxes():
    meta = json.load(open(f'assets/theaters/{TID}/meta.json'))
    lcc = xt.Lcc(**meta['proj'])
    out = []
    for p in json.load(open(f'assets/theaters/{TID}/coverdetail.json'))['patches']:
        size = (p['n'] - 1) * p['res']
        pts = [lcc.inverse(p['x0'] + size * i / 8, p['z0'] + size * j / 8) for i in range(9) for j in range(9)]
        la = [q[0] for q in pts]; lo = [q[1] for q in pts]
        out.append((p['id'], (min(lo), min(la), max(lo), max(la))))
    return out

def work(job):
    path, rg = job
    tmp = f"{OUT}/rg/{os.path.basename(path).split('-')[1]}-{rg}.json"
    if os.path.exists(tmp): return 0
    boxes = patch_boxes()
    t = pq.ParquetFile(xt.s3().open_input_file(path)).read_row_group(rg, columns=['geometry', 'bbox', 'height', 'num_floors'])
    bb = t['bbox'].combine_chunks()
    x0, x1, y0, y1 = (bb.field(k).to_numpy(zero_copy_only=False) for k in ('xmin', 'xmax', 'ymin', 'ymax'))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    res = {}
    hs = t['height'].to_pylist(); fl = t['num_floors'].to_pylist()
    for pid, (a, b, c, d) in boxes:
        idx = np.nonzero((cx >= a) & (cx <= c) & (cy >= b) & (cy <= d))[0]
        if not len(idx): continue
        geoms = shapely.from_wkb(t['geometry'].take(idx).to_numpy(zero_copy_only=False))
        rows = []
        for k, g in zip(idx, geoms):
            if g is None or g.is_empty: continue
            c0 = g.centroid
            lat, lon = c0.y, c0.x
            # local metres around the centroid
            kx, ky = 111320 * math.cos(math.radians(lat)), 110540
            gm = shapely.transform(g, lambda p: np.column_stack(((p[:, 0] - lon) * kx, (p[:, 1] - lat) * ky)))
            area = gm.area
            if area < 25: continue
            r = shapely.minimum_rotated_rectangle(gm)
            co = np.asarray(r.exterior.coords)
            e1, e2 = co[1] - co[0], co[2] - co[1]
            w, dd = float(np.hypot(*e1)), float(np.hypot(*e2))
            if w < 1 or dd < 1: continue
            ang = math.atan2(e1[1], e1[0])
            h = hs[k] if hs[k] is not None else (fl[k] * 3.2 if fl[k] else -1)
            rows.append([round(lat, 7), round(lon, 7), round(w, 1), round(dd, 1), round(ang, 3), round(h, 1) if h and h > 0 else -1, round(min(1, area / (w * dd)), 2)])
        if rows: res[pid] = rows
    with open(tmp + '.tmp', 'w') as f: json.dump(res, f)
    os.rename(tmp + '.tmp', tmp)
    return sum(len(v) for v in res.values())

def main():
    os.makedirs(f'{OUT}/rg', exist_ok=True)
    fs = xt.s3()
    boxes = [b for _, b in patch_boxes()]
    jobs = []
    for f in fs.get_file_info(pafs.FileSelector(BASE)):
        if not f.path.endswith('.parquet'): continue
        md = pq.ParquetFile(fs.open_input_file(f.path)).metadata
        names = [md.schema.column(i).path for i in range(md.num_columns)]
        ix = [names.index('bbox.' + n) for n in ('xmin', 'ymin', 'xmax', 'ymax')]
        for r in range(md.num_row_groups):
            st = [md.row_group(r).column(i).statistics for i in ix]
            if xt.hits((st[0].min, st[1].min, st[2].max, st[3].max), boxes): jobs.append((f.path, r))
    print(len(jobs), 'row groups', flush=True)
    n = 0
    with ProcessPoolExecutor(int(sys.argv[2]) if len(sys.argv) > 2 else 4) as ex:
        for k, c in enumerate(ex.map(work, jobs, chunksize=2)):
            n += c
            if k % 50 == 0: print(k, n, flush=True)
    # merge per patch
    merged = {}
    for f in os.listdir(f'{OUT}/rg'):
        if not f.endswith('.json'): continue
        for pid, rows in json.load(open(f'{OUT}/rg/{f}')).items(): merged.setdefault(pid, []).extend(rows)
    for pid, rows in merged.items():
        json.dump(rows, open(f'{OUT}/bld-{pid}.json', 'w'))
        print(pid, len(rows))
    print('done', n)

if __name__ == '__main__': main()
