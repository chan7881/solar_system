"""궤도 보기 대조 자료 — JPL Horizons → tests/horizons_orbit.json (tests/orbit.test.mjs가 읽는다).

1) 행성(계 질량중심 1~8, 지구는 지구-달 질량중심 3)·왜행성·혜성: 태양 중심 접촉 궤도 요소(J2000 황도)를 날짜 4개에서.
   왜행성·혜성 날짜는 sb_elements.js의 1년 격자 사이(보간이 맞는지 보려고).
2) 달: 지구 중심 접촉 궤도 요소(같은 날짜) — 머리글의 Keplerian GM도 함께 적는다.
3) 다른 위성: 모행성 중심 위치를 그 날짜를 가운데 둔 한 주기 동안 600칸으로 받아 실제 가장 가까운·먼 거리와
   궤도면 법선(r × v 평균)을 적는다 — 그림의 근점·원점이 실제 경로와 맞는지 본다.

실행: python tools/fetch_orbit_check.py   (원본 응답은 원본/orbit/, git 밖)
"""
import json, math, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / '원본' / 'orbit'
sys.path.insert(0, str(ROOT / 'tools'))
from fetch_smallbodies import TARGETS as SB_TARGETS  # noqa: E402

DATES = [2396933.5, 2433341.5, 2461366.5, 2469258.5]  # 1850-06-15 · 1950-03-01 · 2026-11-22 · 2049-07-01 (TDB 0시)
PLANETS = {'mercury': '1', 'venus': '2', 'earth': '3', 'mars': '4', 'jupiter': '5', 'saturn': '6', 'uranus': '7', 'neptune': '8'}
# key: (Horizons ID, 모행성 ID, 주기(일))
MOONS = {
    'phobos': (401, 499, 0.31891), 'deimos': (402, 499, 1.26244), 'io': (501, 599, 1.76914), 'europa': (502, 599, 3.55118),
    'ganymede': (503, 599, 7.15455), 'callisto': (504, 599, 16.68902), 'mimas': (601, 699, 0.94242), 'enceladus': (602, 699, 1.37022),
    'tethys': (603, 699, 1.88780), 'dione': (604, 699, 2.73692), 'rhea': (605, 699, 4.51750), 'titan': (606, 699, 15.94542),
    'hyperion': (607, 699, 21.27661), 'iapetus': (608, 699, 79.3302), 'miranda': (705, 799, 1.41348), 'ariel': (701, 799, 2.52038),
    'umbriel': (702, 799, 4.14418), 'titania': (703, 799, 8.70587), 'oberon': (704, 799, 13.46324), 'triton': (801, 899, 5.87685),
    'charon': (901, 999, 6.38723),
}
API = 'https://ssd.jpl.nasa.gov/api/horizons.api?'


def get(q, name):
    url = API + urllib.parse.urlencode(q)
    for attempt in range(8):
        try:
            t = urllib.request.urlopen(url, timeout=300).read().decode()
            if '$$SOE' in t:
                (RAW / f'{name}.txt').write_text(t, encoding='utf-8')
                return t
            print(' ', name, '응답 이상', t[-300:])
        except Exception as e:  # 서버가 가끔 끊는다
            print('  다시 시도', name, e)
        time.sleep(10 + 5 * attempt)
    raise RuntimeError('응답 없음: ' + name)


def rows(t):
    return [[s.strip() for s in line.split(',')] for line in t.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()]


def elements(cmd, center, name):
    q = {'format': 'text', 'COMMAND': f"'{cmd}'", 'CENTER': f"'500@{center}'", 'EPHEM_TYPE': 'ELEMENTS',
         'TLIST': ' '.join(f"'{d}'" for d in DATES), 'TLIST_TYPE': 'JD',
         'REF_PLANE': 'ECLIPTIC', 'REF_SYSTEM': 'ICRF', 'CSV_FORMAT': 'YES', 'OUT_UNITS': 'KM-S', 'TIME_TYPE': 'TDB'}
    t = get(q, name)
    out = []
    for c in rows(t):
        # JDTDB, 달력, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR
        out.append({'jd': float(c[0]), 'e': float(c[2]), 'q': float(c[3]), 'i': float(c[4]), 'node': float(c[5]),
                    'argp': float(c[6]), 'a': float(c[11]), 'Q': float(c[12])})
    gm = None
    if 'Keplerian GM' in t:
        gm = float(t.split('Keplerian GM')[1].split(':')[1].split()[0])
    return out, gm


def path_extremes(key):
    hid, center, period = MOONS[key]
    out = []
    for d in DATES:
        q = {'format': 'text', 'COMMAND': f"'{hid}'", 'CENTER': f"'500@{center}'", 'EPHEM_TYPE': 'VECTORS',
             'START_TIME': f"'JD {d - period / 2}'", 'STOP_TIME': f"'JD {d + period / 2}'", 'STEP_SIZE': "'600'",
             'REF_PLANE': 'ECLIPTIC', 'REF_SYSTEM': 'ICRF', 'CSV_FORMAT': 'YES', 'OUT_UNITS': 'KM-S', 'TIME_TYPE': 'TDB',
             'VEC_TABLE': '2'}
        t = get(q, f'{key}_{d}')
        rs, hs = [], [0.0, 0.0, 0.0]
        for c in rows(t):
            x, y, z, vx, vy, vz = map(float, c[2:8])
            rs.append(math.sqrt(x * x + y * y + z * z))
            h = (y * vz - z * vy, z * vx - x * vz, x * vy - y * vx)
            hs = [hs[k] + h[k] for k in range(3)]
        n = math.sqrt(sum(v * v for v in hs))
        out.append({'jd': d, 'min': min(rs), 'max': max(rs), 'pole': [v / n for v in hs]})
    print(' ', key, '완료')
    return key, out


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    res = {'dates': DATES, 'planets': {}, 'small': {}, 'moon': None, 'moons': {}}
    for key, cmd in PLANETS.items():
        res['planets'][key], _ = elements(cmd, 10, f'planet_{key}')
        print(key)
    for key, (cmd, _) in SB_TARGETS.items():
        res['small'][key], _ = elements(cmd, 10, f'small_{key}')
        print(key)
    el, gm = elements('301', 399, 'moon')
    res['moon'] = {'gm': gm, 'rows': el}
    print('moon GM', gm)
    with ThreadPoolExecutor(4) as ex:
        for key, out in ex.map(path_extremes, MOONS):
            res['moons'][key] = out
    (ROOT / 'tests' / 'horizons_orbit.json').write_text(json.dumps(res, indent=1), encoding='utf-8')
    print('tests/horizons_orbit.json')


if __name__ == '__main__':
    main()
