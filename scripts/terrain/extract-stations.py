#!/usr/bin/env python3
"""Railway stations for the real-world theaters from the Overture Maps places theme (category train_station) into
.cache/transport/stations.json as [lat, lon, name, confidence]. bake-transport.mjs keeps the ones that lie on a railway.

usage: python3 scripts/terrain/extract-stations.py   (same environment as extract-transport.py)
"""
import json, importlib.util, os
from concurrent.futures import ThreadPoolExecutor
import pyarrow.parquet as pq, pyarrow.fs as pafs, pyarrow.compute as pc
import shapely

spec = importlib.util.spec_from_file_location('xt', os.path.join(os.path.dirname(__file__), 'extract-transport.py'))
xt = importlib.util.module_from_spec(spec); spec.loader.exec_module(xt)
BASE = f'overturemaps-us-west-2/release/{xt.RELEASE}/theme=places/type=place/'
fs = xt.s3()
theaters, _ = xt.boxes()

def work(job):
    path, rg = job
    t = pq.ParquetFile(fs.open_input_file(path)).read_row_group(rg, columns=['basic_category', 'taxonomy', 'names', 'confidence', 'geometry'])
    cat = pc.struct_field(t['taxonomy'], 'primary')
    t = t.filter(pc.fill_null(pc.or_kleene(pc.equal(cat, 'train_station'), pc.equal(t['basic_category'], 'train_station')), False))
    out = []
    pts = shapely.from_wkb(t['geometry'].to_numpy(zero_copy_only=False)) if t.num_rows else []
    names = t['names'].to_pylist(); conf = t['confidence'].to_pylist()
    for k, p in enumerate(pts):
        if not xt.hits((p.x, p.y, p.x, p.y), theaters): continue
        out.append([round(p.y, 6), round(p.x, 6), (names[k] or {}).get('primary') or '', round(conf[k] or 0, 2)])
    return out

jobs = []
for f in fs.get_file_info(pafs.FileSelector(BASE)):
    if not f.path.endswith('.parquet'): continue
    md = pq.ParquetFile(fs.open_input_file(f.path)).metadata
    names = [md.schema.column(i).path for i in range(md.num_columns)]
    ix = [names.index('bbox.' + n) for n in ('xmin', 'ymin', 'xmax', 'ymax')]
    for r in range(md.num_row_groups):
        st = [md.row_group(r).column(i).statistics for i in ix]
        if xt.hits((st[0].min, st[1].min, st[2].max, st[3].max), theaters): jobs.append((f.path, r))
print(len(jobs), 'row groups')
res = []
with ThreadPoolExecutor(6) as ex:
    for r in ex.map(work, jobs): res += r
os.makedirs(xt.OUT, exist_ok=True)
json.dump(res, open(f'{xt.OUT}/stations.json', 'w'), ensure_ascii=False)
print(len(res), 'stations')
