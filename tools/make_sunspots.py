"""태양 흑점 지도(한 자전 합성) — SDO/HMI 연속광(가장자리 어두워짐 뺀 HMIIF, 4096px JPEG) 27장 → textures/sun_spots_2k.jpg

자료: https://sdo.gsfc.nasa.gov/assets/img/browse/YYYY/MM/DD/YYYYMMDD_000000_4096_HMIIF.jpg
  2024-04-27 ~ 2024-05-23 매일 00:00 UT(05-04만 00:30 — 00:00 영상이 없음). 가운데 날 2024-05-10. 받은 파일은 원본/sun/(git 밖).
기하: 각 시각 태양의 정면 경도·위도(IAU_SUN, 동경+)는 Horizons(지구 중심, 관측 14)에서 받는다 → 원본/sun/horizons_tlist.txt.
  영상은 태양 북쪽이 위, 오른쪽이 서쪽(흑점이 오른쪽으로 감, 2024-05-08→12 세로 변화 0.03R로 확인).
합성: 지도 각 점은 그 경도가 정면 자오선에 가장 가까웠던 영상에서 가져오고(이웃 영상과는 경도 차 0.3~0.7일치 구간에서 서서히 바뀜),
  가장자리(μ<0.25)는 쓰지 않는다 — 그래서 극 둘레(약 75° 위)는 비고, 조용한 태양 밝기(1)로 채운다(흑점은 위도 ±40° 안에 생긴다). 시각이 27일에 걸치므로 한 순간의 모습이 아니다.
밝기: JPEG는 조용한 태양 ≈ 202, 흑점 중심 ≈ 0 — 검은 점이 잘린 선형으로 보고 I/I조용 = I0 + (1 − I0)·v/v조용, I0 = 0.2.
  I0는 같은 날 HMII(가장자리 어두워짐 있음) JPEG의 원판 곡선을 src/sun.js 식에 맞춘 값(0.22)이고,
  HMI 흑점 암부 세기 0.2~0.3과도 맞는다. 1 위(백반)는 1로 자른다.
저장: 선형 세기를 sRGB로 부호화한 흑백 JPEG(three.js가 SRGBColorSpace로 읽으면 선형 세기로 돌아온다). 가운데 = 경도 0°, 동쪽이 오른쪽.
쓰는 법: python tools/make_sunspots.py [check]  — check는 원본/sun/check_*.png 확인 그림도 만든다
"""
import sys, re, glob, os, urllib.request, urllib.parse
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '원본', 'sun')
OUT = os.path.join(ROOT, 'textures', 'sun_spots_2k.jpg')
W, H = 2048, 1024
I0 = 0.2
MU_MIN = 0.25
STEP = 13.2  # 하루 동안 정면 경도가 줄어드는 양(°) — 이웃 영상 간격

def images():
    fs = sorted(glob.glob(os.path.join(SRC, '2024*_4096_HMIIF.jpg')))
    days = {}
    for f in fs:
        k = os.path.basename(f)[:8]
        days.setdefault(k, f)  # 하루 한 장(00:00, 없으면 그다음)
    return [days[k] for k in sorted(days) if '20240427' <= k <= '20240523']

def horizons(fs):
    cache = os.path.join(SRC, 'horizons_tlist.txt')
    times = []
    for f in fs:
        m = re.match(r'(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)', os.path.basename(f))
        times.append('%s-%s-%s %s:%s:%s' % m.groups())
    if not os.path.exists(cache) or open(cache, encoding='utf-8').read().count('\n2024-') < len(times):
        q = {'format': 'text', 'COMMAND': "'10'", 'CENTER': "'500@399'", 'EPHEM_TYPE': 'OBSERVER', 'QUANTITIES': "'14'",
             'ANG_FORMAT': 'DEG', 'CSV_FORMAT': 'YES', 'TIME_TYPE': 'UT', 'TLIST_TYPE': 'CAL',
             'TLIST': ' '.join("'%s'" % t for t in times)}
        txt = urllib.request.urlopen('https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode(q), timeout=120).read().decode()
        open(cache, 'w', encoding='utf-8').write(txt)
    txt = open(cache, encoding='utf-8').read()
    assert 'IAU_SUN' in txt and '{East-longitude positive}' in txt
    rows = txt.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()
    out = [(float(r.split(',')[3]), float(r.split(',')[4])) for r in rows]
    assert len(out) == len(fs), (len(out), len(fs))
    return out

def disk(a):
    m = a > 40
    ys, xs = np.nonzero(m)
    return xs.mean(), ys.mean(), np.sqrt(m.sum() / np.pi)

def main(check=False):
    fs = images()
    geo = horizons(fs)
    print(len(fs), '장')
    lon = (np.arange(W) + 0.5) / W * 360 - 180
    lat = 90 - (np.arange(H) + 0.5) / H * 180
    LON, LAT = np.meshgrid(np.radians(lon), np.radians(lat))
    P = np.stack([np.cos(LAT) * np.cos(LON), np.cos(LAT) * np.sin(LON), np.sin(LAT)], -1)
    acc = np.zeros((H, W)); wsum = np.zeros((H, W))
    for f, (L0, B0) in zip(fs, geo):
        a = np.asarray(Image.open(f).convert('L')).astype(float)
        cx, cy, r = disk(a)
        yy, xx = np.mgrid[:a.shape[0], :a.shape[1]]
        quiet = np.median(a[np.hypot(xx - cx, yy - cy) < 0.8 * r])
        l0, b0 = np.radians(L0), np.radians(B0)
        o = np.array([np.cos(b0) * np.cos(l0), np.cos(b0) * np.sin(l0), np.sin(b0)])
        n = np.array([0, 0, 1.0]) - np.sin(b0) * o; n /= np.linalg.norm(n)
        right = np.cross(n, o)  # 화면 오른쪽 = IAU 동경이 커지는 쪽(정면 경도가 날마다 줄어 무늬가 오른쪽으로 감 — 같은 흑점의 경도가 날마다 거의 같게 나오는 쪽으로 확인)
        mu = P @ o
        px = cx + r * (P @ right); py = cy - r * (P @ n)
        ix = np.clip(np.round(px).astype(int), 0, a.shape[1] - 1); iy = np.clip(np.round(py).astype(int), 0, a.shape[0] - 1)
        v = I0 + (1 - I0) * a[iy, ix] / quiet
        d = np.abs(((np.degrees(LON) - L0) + 180) % 360 - 180) / STEP  # 정면 자오선에서 떨어진 경도(일 단위)
        t = np.clip((d - 0.3) / 0.4, 0, 1)
        w = (1 - t * t * (3 - 2 * t)) * (mu > MU_MIN)
        acc += w * v; wsum += w
        print(os.path.basename(f)[:15], 'L0=%.2f B0=%.2f r=%.1f 조용=%.0f' % (L0, B0, r, quiet))
    band = np.abs(LAT) < np.radians(60)
    assert (wsum[band] > 0).all(), '위도 60° 안에 빈 곳'  # 극 둘레는 비스듬해서 안 쓴다 — 흑점이 없는 곳이라 조용한 태양(1)으로 채움
    I = np.where(wsum > 0, acc / np.maximum(wsum, 1e-9), 1.0)
    I = np.clip(I, 0, 1)
    s = np.where(I <= 0.0031308, 12.92 * I, 1.055 * I ** (1 / 2.4) - 0.055)
    Image.fromarray(np.round(s * 255).astype(np.uint8), 'L').save(OUT, quality=92)
    print('저장', OUT, '빈 곳 %.4f' % (wsum == 0).mean(), '최소 I %.3f' % I.min(), 'I<0.8 비율 %.5f' % (I < 0.8).mean())
    if check:
        im = Image.fromarray(np.round(np.clip((I - 0.15) / 0.85, 0, 1) * 255).astype(np.uint8), 'L')
        im.resize((1024, 512)).save(os.path.join(SRC, 'check_map.png'))

if __name__ == '__main__':
    main('check' in sys.argv)
