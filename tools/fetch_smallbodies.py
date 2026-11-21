"""소천체 자료 받기 — JPL SBDB(점 무리)와 JPL Horizons(왜행성·혜성).

1) 점 무리: SBDB Query API에서 궤도 요소를 받아 textures/small_bodies.bin 으로.
   - 소행성대·힐다·트로이: 절대등급 H < 14 (지름 약 5~10km 이상 — 이 범위는 이미 거의 다 발견돼 있어 밀도가 실제와 같다)
     힐다는 a 3.7~4.2AU · e < 0.3 · i < 20°, 트로이는 SBDB 분류 TJN, 소행성대는 나머지 IMB·MBA·OMB
   - 카이퍼대: SBDB 분류 TNO 전부 중 궤도가 정해진 것(condition_code ≤ 6)
   한 천체 = float32 8개: [무리, a(AU), e, i(°), Ω(°), ω(°), M(°), 기원(JD TDB − 2451545)]
   무리: 0 소행성대 · 1 힐다 · 2 트로이 · 3 카이퍼대
2) 왜행성·혜성: Horizons 태양 중심 접촉 궤도 요소(J2000 황도), 1800~2051년 1년 간격 → src/sb_elements.js
   (손으로 고치지 않는다). 원본 응답은 원본/smallbodies/(git 밖).

실행: python tools/fetch_smallbodies.py [points] [elements [key ...]] [check]   (인자 없으면 points·elements)
"""
import json, struct, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / '원본' / 'smallbodies'
J2000 = 2451545.0
H_MAX = 14
MESH_BODIES = {'1', '134340', '136199', '136108', '136472'}  # 세레스·명왕성·에리스·하우메아·마케마케
FIELDS = ['pdes', 'class', 'H', 'a', 'e', 'i', 'om', 'w', 'ma', 'epoch', 'condition_code']

# key: (Horizons COMMAND, 시작 시각) — 명왕성은 Horizons 자료가 1800-01-03부터.
# 명왕성은 명왕성-카론 계 질량중심(9)의 요소 — 몸체(999) 요소에는 카론 둘레를 도는 6.4일 흔들림이 섞인다.
#   몸체 위치는 src/moons.js systemOffsets가 카론 질량만큼 옮긴다(행성과 같은 방식).
TARGETS = {
    'ceres': ('1;', '1800-01-01'), 'pluto': ('9', '1800-01-04'), 'eris': ('136199;', '1800-01-01'),
    'haumea': ('136108;', '1800-01-01'), 'makemake': ('136472;', '1800-01-01'),
    'halley': ('DES=1P; CAP;', '1800-01-01'), 'encke': ('DES=2P; CAP;', '1800-01-01'),
    'churyumov': ('DES=67P; CAP;', '1800-01-01'), 'swifttuttle': ('DES=109P; CAP;', '1800-01-01'),
    'halebopp': ('DES=C/1995 O1; CAP;', '1800-01-01'),
}


def get(url, timeout=300):
    for attempt in range(6):
        try:
            return urllib.request.urlopen(url, timeout=timeout).read().decode()
        except Exception as e:  # 서버가 가끔 끊는다
            print('  다시 시도', e); time.sleep(15)
    raise RuntimeError('응답 없음: ' + url[:120])


def sbdb(cls, cdata=None):
    q = {'fields': ','.join(FIELDS), 'sb-class': cls}
    if cdata:
        q['sb-cdata'] = json.dumps(cdata)
    d = json.loads(get('https://ssd-api.jpl.nasa.gov/sbdb_query.api?' + urllib.parse.urlencode(q)))
    (RAW / f'sbdb_{cls}.json').write_text(json.dumps(d), encoding='utf-8')
    return [dict(zip(d['fields'], r)) for r in d.get('data', [])]


def points():
    rows = []
    for cls in ['IMB', 'MBA', 'OMB', 'TJN']:
        rows += sbdb(cls, {'AND': [f'H|LT|{H_MAX}']})
    tno = sbdb('TNO')
    out, count = [], [0, 0, 0, 0]
    skipped = 0
    for r in rows + tno:
        if str(r['pdes']) in MESH_BODIES:  # 몸체로 따로 그리는 왜행성 — 점이 겹치지 않게
            skipped += 1; continue
        try:
            a, e, i, om, w, ma, ep = (float(r[k]) for k in ['a', 'e', 'i', 'om', 'w', 'ma', 'epoch'])
        except (TypeError, ValueError):
            skipped += 1; continue
        if r['class'] == 'TNO':
            cc = r['condition_code']
            if cc is None or not str(cc).strip().isdigit() or int(cc) > 6 or e >= 1:
                skipped += 1; continue
            g = 3
        elif r['class'] == 'TJN':
            g = 2
        elif 3.7 <= a <= 4.2 and e < 0.3 and i < 20:
            g = 1
        else:
            g = 0
        count[g] += 1
        out.append(struct.pack('<8f', g, a, e, i, om, w, ma, ep - J2000))
    (ROOT / 'textures' / 'small_bodies.bin').write_bytes(b''.join(out))
    print('소행성대 %d · 힐다 %d · 트로이 %d · 카이퍼대 %d (뺀 것 %d)' % (*count, skipped))


def elements(only=()):
    """only: 이 key들만 새로 받고 나머지는 지금 src/sb_elements.js 값을 그대로 둔다."""
    res = {}
    if only:
        t = (ROOT / 'src' / 'sb_elements.js').read_text(encoding='utf-8')
        res = json.loads(t[t.index('export default ') + 15:].rstrip().rstrip(';'))
    for key, (cmd, start) in TARGETS.items():
        if only and key not in only:
            continue
        q = {'format': 'text', 'COMMAND': f"'{cmd}'", 'CENTER': "'500@10'", 'EPHEM_TYPE': 'ELEMENTS',
             'START_TIME': f"'{start}'", 'STOP_TIME': "'2051-01-04'", 'STEP_SIZE': "'1 y'",
             'REF_PLANE': 'ECLIPTIC', 'REF_SYSTEM': 'ICRF', 'CSV_FORMAT': 'YES', 'OUT_UNITS': 'AU-D', 'TIME_TYPE': 'TDB'}
        t = get('https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode(q))
        (RAW / f'{key}_elem.txt').write_text(t, encoding='utf-8')
        if '$$SOE' not in t:
            raise RuntimeError(key + ': ' + t[-600:])
        rows = []
        for line in t.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines():
            c = [s.strip() for s in line.split(',')]
            # JDTDB, 달력, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR
            jd, ec, qr, inc, om, w, tp = float(c[0]), *map(float, c[2:8])
            rows.append([round(jd - J2000, 4), float('%.12g' % ec), float('%.12g' % qr), float('%.10g' % inc),
                         float('%.10g' % om), float('%.10g' % w), round(tp - J2000, 6)])
        name = t.split('Target body name:')[1].split('{')[0].strip()
        res[key] = rows
        print(key, name, len(rows))
    body = json.dumps(res, separators=(',', ':'))
    (ROOT / 'src' / 'sb_elements.js').write_text(
        '// tools/fetch_smallbodies.py가 만든다 — 손으로 고치지 않는다.\n'
        '// JPL Horizons 태양 중심 접촉 궤도 요소(J2000 황도), 1년 간격.\n'
        '// 한 줄: [기원(JD TDB − 2451545), e, q(AU), i(°), Ω(°), ω(°), 근일점 통과(JD TDB − 2451545)]\n'
        f'export default {body};\n', encoding='utf-8')


CHECK_DATES = ['1801-03-10 06:00', '1835-11-16 00:00', '1910-04-20 12:00', '1955-07-07 00:00', '1986-02-09 12:00',
               '1997-04-01 00:00', '2026-11-21 00:00', '2050-09-30 00:00']
# 점 무리 대조용 소행성: 베스타(소행성대) · 153 힐다 · 624 헥토르(트로이) · 486958 아로코스(카이퍼대)
CHECK_POINTS = {'4;': 'vesta', '153;': 'hilda', '624;': 'hektor', '486958;': 'arrokoth'}


def check():
    """테스트용 Horizons 위치(태양 중심, J2000 황도, AU) → tests/horizons_smallbodies.txt"""
    lines = ['# key 날짜(TDB) x y z  — JPL Horizons VECTORS, CENTER 500@10, J2000 황도, AU (tools/fetch_smallbodies.py check)']
    cmds = {k: c for k, (c, _) in TARGETS.items()} | {k: c for c, k in CHECK_POINTS.items()}
    cmds['pluto'] = '999'  # 기준은 명왕성 몸체 — 요소는 질량중심(9)이라 둘 차(약 2,100km)는 테스트 허용 오차 안
    for key, cmd in cmds.items():
        dates = CHECK_DATES if key not in CHECK_POINTS.values() else ['1801-03-10 06:00', '1900-01-01 00:00', '2026-11-21 00:00', '2050-09-30 00:00']
        if key == 'pluto':
            dates = [d for d in dates if d >= '1800-01-04']
        q = {'format': 'text', 'COMMAND': f"'{cmd}'", 'CENTER': "'500@10'", 'EPHEM_TYPE': 'VECTORS',
             'TLIST': ' '.join(f"'{d}'" for d in dates), 'TLIST_TYPE': 'CAL', 'TIME_TYPE': 'TDB',
             'REF_PLANE': 'ECLIPTIC', 'REF_SYSTEM': 'ICRF', 'OUT_UNITS': 'AU-D', 'VEC_TABLE': '1', 'CSV_FORMAT': 'YES'}
        t = get('https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode(q))
        if '$$SOE' not in t:
            raise RuntimeError(key + ': ' + t[-600:])
        for line in t.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines():
            c = [s.strip() for s in line.split(',')]
            lines.append(f'{key} {c[0]} {c[2]} {c[3]} {c[4]}')
        print(key, 'ok')
    (ROOT / 'tests' / 'horizons_smallbodies.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')


if __name__ == '__main__':
    RAW.mkdir(parents=True, exist_ok=True)
    args = sys.argv[1:] or ['points', 'elements']
    if not {'points', 'elements', 'check'} & set(args):
        raise SystemExit('쓰는 법: fetch_smallbodies.py [points] [elements [천체…]] [check]')
    if 'points' in args:
        points()
    if 'elements' in args:
        bad = [a for a in args if a not in TARGETS and a not in ('points', 'elements', 'check')]
        if bad:
            raise SystemExit(f'모르는 천체: {bad} — {list(TARGETS)}')
        elements([a for a in args if a in TARGETS])
    if 'check' in args:
        check()
