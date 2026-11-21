# 별자리 선·이름(J2000 적경·적위, 도) → textures/constellations.json
# 원본: d3-celestial(Olaf Frohn, BSD-3) data/constellations.lines.json · constellations.json → 원본/const/ (git 밖)
#   curl -L -o 원본/const/lines.json https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json
#   curl -L -o 원본/const/names.json https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
L = json.loads((root / '원본/const/lines.json').read_text(encoding='utf-8'))
N = json.loads((root / '원본/const/names.json').read_text(encoding='utf-8'))
FIX = {'Her': '헤르쿨레스자리'}  # 한국천문학회 표기
r = lambda v: round(v, 3)
lines = [[r(c) for p in ln for c in p] for f in L['features'] for ln in f['geometry']['coordinates']]
names = [[FIX.get(f['id'], f['properties']['ko']), *map(r, f['geometry']['coordinates'])] for f in N['features']]
out = root / 'textures/constellations.json'
out.write_text(json.dumps({'lines': lines, 'names': names}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(len(lines), 'lines', sum(len(l) // 2 for l in lines), 'points', len(names), 'names', out.stat().st_size, 'bytes')
