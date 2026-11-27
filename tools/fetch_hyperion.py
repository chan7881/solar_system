"""히페리온 지도용 Cassini ISS 사진(CISSCAL 보정본)과 SPICE 커널을 받아 원본/hyperion/ 에 둔다(git 밖).

사진: OPUS(PDS Rings Node) — 투명 필터(CLEAR), 히페리온 중심 해상도 ≤ RES_MAX km/화소.
      목록은 원본/hyperion/iss/list.json, 파일은 원본/hyperion/iss/<이름>_CALIB.IMG·.LBL
커널: NAIF Cassini(https://naif.jpl.nasa.gov/pub/naif/CASSINI/kernels/) — 재구성 궤도(SCPSE R: 탐사선·행성·위성)·
      자세(ra.bc)·시계·좌표틀·카메라. 사진 날짜를 덮는 것만 원본/hyperion/spice/ 에.

실행: python tools/fetch_hyperion.py [list] [images] [kernels]   (인자 없으면 전부)
"""
import json, re, sys, time, urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / '원본' / 'hyperion'
ISS, SPICE = ROOT / 'iss', ROOT / 'spice'
RES_MAX = 1.5  # km/화소 — 히페리온 긴 지름 360km가 240화소 넘게
OPUS = 'https://opus.pds-rings.seti.org/api'
NAIF = 'https://naif.jpl.nasa.gov/pub/naif/CASSINI/kernels'
FIXED = {'lsk': 'naif0012.tls', 'sclk': 'cas00172.tsc', 'fk': 'cas_v43.tf', 'ik': 'cas_iss_v10.ti', 'pck': 'pck00011.tpc'}
UA = {'User-Agent': 'Mozilla/5.0'}
COLS = ('opusid,time1,observationduration,COISScamera,COISSfilter,COISSmissinglines,SURFACEGEOhyperion_centerdistance1,'
        'SURFACEGEOhyperion_centerresolution1,SURFACEGEOhyperion_centerphaseangle1')


def get(url, path=None, tries=6):
    for k in range(tries):
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read()
            if path:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b)
            return b
        except Exception as e:
            print('  다시 시도', url.rsplit('/', 1)[-1], e); time.sleep(10)
    raise RuntimeError(url)


def make_list():
    q = (f'{OPUS}/data.json?instrument=Cassini+ISS&surfacegeometrytargetname=Hyperion'
         f'&SURFACEGEOhyperion_centerresolution2={RES_MAX}&order=time1&limit=5000&cols={COLS}')
    d = json.loads(get(q))
    rows = [dict(zip(['id', 'time', 'dur', 'cam', 'filter', 'missing', 'dist', 'res', 'phase'], r)) for r in d['page']]
    rows = [r for r in rows if r['filter'] == 'CLEAR']
    print('사진', len(rows))
    ISS.mkdir(parents=True, exist_ok=True)
    (ISS / 'list.json').write_text(json.dumps(rows, ensure_ascii=False, indent=0), encoding='utf-8')
    return rows


def images():
    from concurrent.futures import ThreadPoolExecutor
    rows = json.loads((ISS / 'list.json').read_text(encoding='utf-8'))

    def one(r):
        f = json.loads(get(f'{OPUS}/files/{r["id"]}.json'))['data'][r['id']]
        for u in f.get('coiss_calib', []):
            p = ISS / u.rsplit('/', 1)[-1]
            if not p.exists():
                get(u, p)  # 다 받은 뒤에 쓴다 — 끊겨도 반쪽 파일이 남지 않는다
        return r['id']
    with ThreadPoolExecutor(8) as ex:
        for i, rid in enumerate(ex.map(one, rows)):
            print(f'  {i + 1}/{len(rows)} {rid}', flush=True)


def kernels():
    rows = json.loads((ISS / 'list.json').read_text(encoding='utf-8'))
    days = sorted({datetime.fromisoformat(r['time'][:19]).date() for r in rows})
    for sub, name in FIXED.items():
        base = f'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/{sub}' if sub in ('lsk', 'pck') else f'{NAIF}/{sub}'
        p = SPICE / name
        if not p.exists():
            get(f'{base}/{name}', p)
    spk = re.findall(r'href="(\d{6}R_SCPSE_(\d{5})_(\d{5})\.bsp)"', get(f'{NAIF}/spk/').decode())
    ck = re.findall(r'href="((\d{5})_(\d{5})ra\.bc)"', get(f'{NAIF}/ck/').decode())
    need = set()
    for d in days:
        key = d.strftime('%y%j')
        s = sorted([n for n, a, b in spk if a <= key <= b], reverse=True)  # 이름 앞 6자리 = 만든 날 — 가장 늦은 것
        c = [n for n, a, b in ck if a <= key <= b]
        if not s or not c:
            print('  못 찾음', d, s[:1], c[:1]); continue
        need.add(s[0]); need.update(c)
    for n in sorted(need):
        p = SPICE / n
        if not p.exists():
            print('  받기', n, flush=True)
            get(f'{NAIF}/{"spk" if n.endswith(".bsp") else "ck"}/{n}', p)
    (SPICE / 'kernels.json').write_text(json.dumps(sorted(need) + list(FIXED.values()), indent=0), encoding='utf-8')
    print('커널', len(need) + len(FIXED))


if __name__ == '__main__':
    a = set(sys.argv[1:]) or {'list', 'images', 'kernels'}
    if 'list' in a: make_list()
    if 'images' in a: images()
    if 'kernels' in a: kernels()
