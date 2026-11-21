"""위성의 행성 중심 위치·속도를 JPL Horizons에서 받아 원본/moons/<id>.txt 로 둔다(git 밖).

받는 것: 1800-01-01 ~ 2051-01-01, J2000 황도, km·km/s, 행성 중심(500@<행성 ID>).
간격은 위성마다 주기와 어긋나는 값(STEP)으로 — 고른 간격이라도 같은 위상만 찍히지 않게.
check 모드: 같은 기간을 간격의 절반만큼 밀어서 받아 원본/moons/<id>_check.txt (맞춘 식을 따로 대 보는 용도).

실행: python tools/fetch_moons.py [check] [rev]
"""
import sys, time, urllib.parse, urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / '원본' / 'moons'
MOONS = {401: 499, 402: 499, 501: 599, 502: 599, 503: 599, 504: 599,
         601: 699, 602: 699, 603: 699, 604: 699, 605: 699, 606: 699, 608: 699,
         701: 799, 702: 799, 703: 799, 704: 799, 705: 799, 801: 899, 901: 999}
STEP_D = 3.1416  # 일 — 어느 위성 주기와도 맞물리지 않게
CHUNK_Y = 20


def fetch(cmd, center, start, stop, step_min):
    q = {'format': 'text', 'COMMAND': f"'{cmd}'", 'CENTER': f"'500@{center}'", 'EPHEM_TYPE': 'VECTORS',
         'START_TIME': f"'{start}'", 'STOP_TIME': f"'{stop}'", 'STEP_SIZE': f"'{step_min} min'",
         'REF_PLANE': 'ECLIPTIC', 'REF_SYSTEM': 'ICRF', 'OUT_UNITS': 'KM-S', 'VEC_TABLE': '2',
         'CSV_FORMAT': 'YES', 'TIME_TYPE': 'TDB'}
    url = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode(q)
    for attempt in range(8):
        try:
            t = urllib.request.urlopen(url, timeout=180).read().decode()
            break
        except Exception as e:  # 서버가 가끔 끊는다
            print('  다시 시도', e); time.sleep(20)
    else:
        raise RuntimeError('Horizons 응답 없음')
    if '$$SOE' not in t:
        raise RuntimeError(t[-800:])
    body = t.split('$$SOE')[1].split('$$EOE')[0]
    rows = []
    for line in body.strip().splitlines():
        c = [s.strip() for s in line.split(',')]
        rows.append(' '.join([c[0]] + c[2:8]))
    return rows


def main():
    check = 'check' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    step_min = round(STEP_D * 1440)
    items = list(MOONS.items())
    if 'rev' in sys.argv:  # 거꾸로 — 두 벌을 함께 돌려 빨리 받을 때
        items.reverse()
    for mid, center in items:
        path = OUT / (f'{mid}_check.txt' if check else f'{mid}.txt')
        if path.exists():
            continue
        rows = []
        for y in range(1800, 2051, CHUNK_Y):
            y1 = min(y + CHUNK_Y, 2051)
            start = f'{y}-01-01'
            if check:
                # check: 시작을 간격의 절반만큼 민다(하루를 넘는 반 간격은 날짜를 더한다)
                half_d = STEP_D / 2
                start = f'{y}-01-{1 + int(half_d):02d} {int((half_d % 1) * 24):02d}:{int(((half_d % 1) * 24 % 1) * 60):02d}'
            if y == 1800:  # 트리톤 등은 Horizons 자료가 1800-01-02부터, 카론(명왕성 중심)은 01-04부터 — 첫 구간을 늦춘다
                d = int(start[8:10]) + (4 if center == 999 else 2)
                start = start[:8] + f'{d:02d}' + start[10:]
            r = fetch(mid, center, start, f'{y1}-01-01', step_min)
            if rows and r and r[0].split()[0] == rows[-1].split()[0]:
                r = r[1:]
            rows += r
            print(mid, y, len(r))
        path.write_text('\n'.join(rows) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
