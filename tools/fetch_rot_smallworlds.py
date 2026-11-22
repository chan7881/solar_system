"""트리톤·천왕성 위성 5개·세레스 자세 검사 기준값을 JPL Horizons에서 받는다 → tests/horizons_smallworlds_rot.txt · _vec.txt.

태양 직하점(관측자 500@10, QUANTITIES 14·21)과, 같은 행의 광행시만큼 앞선 시각의 태양 중심 위치(VECTORS, J2000 황도, km).
Horizons 경도는 동경+, 위도는 측지 위도 — 시험에서 행성 중심 위도로 바꾼다(반지름은 머리글에 적음).
쓰는 법: python tools/fetch_rot_smallworlds.py
"""
import re, time, urllib.parse, urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'tests'
JDS = [2433450.5, 2451544.5, 2457217.5, 2461365.5, 2468405.5]
BODIES = {'801': 'triton', '701': 'ariel', '702': 'umbriel', '703': 'titania', '704': 'oberon', '705': 'miranda', 'DES=2000001;': 'ceres'}


def api(**kw):
    q = urllib.parse.urlencode({'format': 'text', 'MAKE_EPHEM': 'YES', 'CENTER': "'500@10'", 'TIME_TYPE': "'TT'", **kw})
    for k in range(6):
        try:
            return urllib.request.urlopen('https://ssd.jpl.nasa.gov/api/horizons.api?' + q, timeout=90).read().decode()
        except Exception as e:
            print('재시도', e); time.sleep(5)
    raise SystemExit('Horizons 실패')


rot, vec, radii = [], [], []
for cid, key in BODIES.items():
    tl = "'" + ' '.join(f'{j:.1f}' for j in JDS) + "'"
    t = api(COMMAND=f"'{cid}'", EPHEM_TYPE='OBSERVER', TLIST=tl, QUANTITIES="'14,21'")
    m = re.search(r'Target radii\s*:\s*([\d.]+), ([\d.]+), ([\d.]+)', t)
    radii.append(f'# radii {key} {m.group(1)} {m.group(2)} {m.group(3)}')
    rows = re.findall(r'^ (\d{4}-\w{3}-\d\d) (\S+)\s+([\d.]+)\s+(-?[\d.]+)\s+([\d.]+)\s*$', t.split('$$SOE')[1].split('$$EOE')[0], re.M)
    assert len(rows) == 5, (key, t[-800:])
    jps = []
    for (d, tm, lon, lat, lt), jd in zip(rows, JDS):
        rot.append(f'{key} sun {d} {tm} {lon} {lat} {lt}')
        jps.append(jd - float(lt) / 1440)
    tv = api(COMMAND=f"'{cid}'", EPHEM_TYPE='VECTORS', TLIST="'" + ' '.join(f'{j:.9f}' for j in jps) + "'",
             VEC_TABLE="'1'", REF_PLANE="'ECLIPTIC'", REF_SYSTEM="'ICRF'", OUT_UNITS="'KM-S'", VEC_CORR="'NONE'", CSV_FORMAT='NO')
    vs = re.findall(r'X =\s*(\S+)\s+Y =\s*(\S+)\s+Z =\s*(\S+)', tv.split('$$SOE')[1])
    assert len(vs) == 5, (key, tv[-800:])
    for jp, (x, y, z) in zip(jps, vs):
        vec.append(f'{key} {jp:.9f} {x} {y} {z}')
    print(key, 'ok')
(OUT / 'horizons_smallworlds_rot.txt').write_text(
    '# JPL Horizons %s 받음: 트리톤·천왕성 위성·세레스, TIME_TYPE=TT, QUANTITIES=14(ObsSub-LON/LAT),21(LT 분) · IAU 모형, 동경+, 측지 위도, 관측자 500@10(태양 직하점)\n' % time.strftime('%Y-%m-%d')
    + '# 열: 천체 관측자 날짜 시각 동경(°) 위도(°) 광행시(분)\n' + '\n'.join(radii) + '\n' + '\n'.join(rot) + '\n', encoding='utf-8')
(OUT / 'horizons_smallworlds_vec.txt').write_text(
    '# 같은 행의 광행시만큼 앞선 시각(JD TT)의 대상 위치 — 태양 중심, J2000 황도, km(VECTORS, 기하 위치)\n# 열: 천체 JD x y z\n' + '\n'.join(vec) + '\n', encoding='utf-8')
