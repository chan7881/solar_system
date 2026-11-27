"""지구 구름 질감 — NASA GIBS의 VIIRS(NOAA-20·21) 가시광 합성에서 구름 투명도만 뽑아 흑백 JPG로.

받는 곳: GIBS WMS(epsg4326, 전구 −180~180·−90~90, 4096×2048) — 레이어 VIIRS_NOAA20(틈 메우기 NOAA21)_CorrectedReflectance_TrueColor,
눈·얼음 가르기는 VIIRS_NOAA20_CorrectedReflectance_BandsM11-I2-I1(눈·얼음 구름은 하늘색). MODIS는 폭이 좁아 궤도 가장자리 줄무늬가 커서 쓰지 않았다.
(VIIRS SNPP는 이 날짜들에 GIBS가 영상을 주지 않았다 — 3KB짜리 오류 그림이 온다.) 하루치 영상의 틈은 NOAA21로 메우고 겨울 반구 극지는 극야로 비어 있다.
그래서 기준 날짜(BASE)로 만들고, 북극 쪽은 여름 날짜(NORTH)로 위도 45~60° 사이에서 서서히 바꿔 채운다.
끊김 처리(2026-11-27): 햇빛 반사 띠는 NOAA21로 바꾸고, 경도 180° 이음매는 다음 날 영상으로 서서히 넘기고,
위도 62~70° 위는 이틀 × 두 위성 평균(밝기·눈얼음 거르기 모두) — 자세한 까닭은 day_min·seamless.
원본 영상은 원본/clouds/ 에 받아 둔다(git 밖).

구름 뽑기: 구름은 흰색(세 채널이 비슷하게 높음), 땅·바다는 어느 한 채널이 낮다 → 관측의 min(R,G,B) 가 구름 몫.
맑은 날 지표(textures/earth_2k.jpg)의 min(R,G,B)를 바탕으로 빼서 구름 투명도를 낸다(눈·사막처럼 바탕이 밝은 곳은 자동으로 약해진다).
빼기는 선형 빛 세기로 한다(관측 = a·흰 구름 + (1−a)·바탕) — 화면이 선형으로 섞으므로. 8비트에서 옅은 구름이 뭉개지지 않게
a^(1/2.2)로 담고 셰이더가 2.2승으로 되돌린다(main.js 구름 껍질).
색은 셰이더에서 입힌다(흰색 × 낮 밝기). 구름은 시간을 돌려도 고정(사용자 결정, 2026-11-22).
쓰는 법: python tools/make_clouds.py [check]   — check는 구름을 지표 위에 얹은 확인 그림을 scratch에 낸다
"""
import sys
import urllib.request
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / '원본' / 'clouds'
OUT = ROOT / 'textures' / 'earth_clouds_4k.jpg'
SURF = ROOT / 'textures' / 'earth_2k.jpg'
W, H = 4096, 2048
BASE = '2026-11-19'
NORTH = '2026-06-20'
URL = ('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1'
       '&LAYERS={layer}&STYLES=&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH={w}&HEIGHT={h}&FORMAT=image/png&TIME={date}')


def fetch(sat: str, date: str, bands='TrueColor', w=W, h=H) -> np.ndarray:
    RAW.mkdir(parents=True, exist_ok=True)
    f = RAW / f'{sat}_{bands}_{date}_{w}.png'
    if not f.exists():
        layer = f'VIIRS_{sat}_CorrectedReflectance_{bands}'
        with urllib.request.urlopen(URL.format(layer=layer, w=w, h=h, date=date), timeout=300) as r:
            data = r.read()
        if len(data) < 50000:
            raise SystemExit(f'{layer} {date}: 영상이 오지 않음({len(data)}바이트)')
        f.write_bytes(data)
    return np.asarray(Image.open(f).convert('RGBA'), dtype=np.float32) / 255


def valid(a: np.ndarray) -> np.ndarray:
    # 틈·극야는 (0,0,0)이거나 투명
    return (a[..., 3] > 0.5) & (a[..., :3].max(axis=-1) > 0.02)


def lin(v):
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def blur(v: np.ndarray, ok: np.ndarray, sigma: float) -> np.ndarray:
    """빈칸을 빼고 흐리게(경도 방향은 이어 붙여서)"""
    num = gaussian_filter(np.where(ok, v, 0), sigma, mode=('nearest', 'wrap'))
    den = gaussian_filter(ok.astype(np.float32), sigma, mode=('nearest', 'wrap'))
    return num / np.maximum(den, 1e-3)


def decl(date: str) -> float:
    doy = np.datetime64(date).astype('datetime64[D]') - np.datetime64(date[:4] + '-01-01')
    return -23.44 * np.cos(2 * np.pi * (doy.astype(int) + 10) / 365)


LAT = 90 - (np.arange(H) + 0.5) / H * 180
LON = -180 + (np.arange(W) + 0.5) / W * 360


def day_min(date: str):
    """하루치 min(R,G,B)(선형)와 유효 칸. NOAA20 우선, 틈은 NOAA21.
    ① 햇빛 반사: 두 위성의 반사 띠는 반 칸 어긋나 있다 → 태양 직하 위도 ±25° 안에서 흐리게 뭉갠 밝기가
       NOAA21보다 확연히 밝은 곳(NOAA20의 반사 띠)은 NOAA21로 바꾼다(50분 차라 구름은 거의 같다).
    반환: (min, 유효, 합, 개수) — 합·개수는 극지 평균용"""
    t, q = fetch('NOAA20', date), fetch('NOAA21', date)
    vt, vq = valid(t), valid(q)
    mt, mq = lin(t[..., :3].min(axis=-1)), lin(q[..., :3].min(axis=-1))
    both = vt & vq
    g = blur(mt, vt, 12) - blur(mq, vq, 12)
    band = np.clip((25 - np.abs(LAT - decl(date))) / 5, 0, 1)[:, None]
    wq = np.clip((g - 0.02) / 0.04, 0, 1) * band
    m = np.where(both, mt * (1 - wq) + mq * wq, np.where(vt, mt, mq))
    return m, vt | vq, np.where(vt, mt, 0) + np.where(vq, mq, 0), vt.astype(np.float32) + vq


def cyan(date: str, sat='NOAA20'):
    """눈·얼음 하늘색 정도와 유효 칸"""
    raw = fetch(sat, date, 'BandsM11-I2-I1', 2048, 1024)
    b = np.asarray(Image.fromarray((raw * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), dtype=np.float32) / 255
    return np.clip((b[..., 1] - b[..., 0] - 0.12) / 0.2, 0, 1), valid(b)


def seamless(date: str):
    """② 경도 180° 이음매: 하루 합성은 동쪽 끝(+180°)이 서쪽 끝(−180°)보다 24시간 이르다.
    다음 날 영상의 동쪽 끝이 그날 서쪽 끝과 같은 시각이므로 경도 165°부터 180°까지 다음 날로 서서히 바꾼다.
    반환: (min 선형, 유효, 눈·얼음 하늘색 정도)"""
    nxt = str(np.datetime64(date) + 1)
    m, ok, s, n = day_min(date)
    m1, ok1, s1, n1 = day_min(nxt)
    (c, _), (c1, _) = cyan(date), cyan(nxt)
    w = np.clip((LON - 165) / 15, 0, 1)[None, :] * np.ones((H, 1))
    w = np.where(ok1, np.where(ok, w, 1), 0)
    m = m * (1 - w) + m1 * w
    # ③ 위도 62~70° 위는 이틀 × 두 위성 평균 — 극지는 타일마다 다른 시각의 영상이 붙어 네모난 조각이 진다
    n = n + n1
    wp = np.where(n > 0, np.clip((np.abs(LAT) - 62) / 8, 0, 1)[:, None], 0)
    m = m * (1 - wp) + (s + s1) / np.maximum(n, 1) * wp
    c = c * (1 - w) + c1 * w
    cs = [cyan(d, sat) for d in (date, nxt) for sat in ('NOAA20', 'NOAA21')]   # 눈·얼음 거르기 영상도 같은 까닭으로 평균
    cn = sum(v.astype(np.float32) for _, v in cs)
    cavg = sum(np.where(v, x, 0) for x, v in cs) / np.maximum(cn, 1)
    wc = np.where(cn > 0, np.clip((np.abs(LAT) - 62) / 8, 0, 1)[:, None], 0)
    return m, ok | ok1, c * (1 - wc) + cavg * wc


def cloud_alpha() -> np.ndarray:
    """선형 구름 투명도(0~1)"""
    m, ok, cy = seamless(BASE)
    mN, okN, cyN = seamless(NORTH)
    lat = LAT
    wN = np.clip((lat - 45) / 15, 0, 1)[:, None]           # 위도 45° 이하 0 → 60° 이상 1
    wN = np.where(okN, wN, 0)
    wN = np.where(~ok, np.where(okN, 1, 0), wN)             # 기준에 없으면 여름 영상으로
    m = m * (1 - wN) + mN * wN
    ok = ok | okN
    surf = np.asarray(Image.open(SURF).convert('RGB').resize((W, H), Image.LANCZOS), dtype=np.float32) / 255
    mb = surf.min(axis=-1)
    th = lin(mb * 0.9 + 0.08)  # 바탕 문턱(sRGB 값으로 정한 것을 선형으로)
    a = np.clip((m - th) / (1 - th), 0, 1)
    # 눈·얼음: 7-2-1 합성에서 하늘색(G − R 큼). 위도 45° 위·−55° 아래에서만 걸러 낸다(열대 얼음 구름은 남긴다)
    cy = cy * (1 - wN) + cyN * wN
    zone = np.clip((np.abs(lat) - 45) / 10, 0, 1)[:, None]
    zone = np.where(lat[:, None] < 0, np.clip((-lat[:, None] - 55) / 10, 0, 1), zone)
    a = a * (1 - cy * zone)
    a = np.where(ok, a, 0)
    return np.clip(a ** 1.1, 0, 1)


if __name__ == '__main__':
    a = cloud_alpha()
    im = Image.fromarray((a ** (1 / 2.2) * 255 + 0.5).astype(np.uint8), 'L')
    im.save(OUT, quality=88, optimize=True)
    print(f'{OUT.name}: {OUT.stat().st_size // 1024}KB, 평균 {a.mean():.3f}, 0.5 넘는 칸 {np.mean(a > 0.5) * 100:.1f}%')
    if 'check' in sys.argv:
        surf = np.asarray(Image.open(SURF).convert('RGB').resize((W, H), Image.LANCZOS), dtype=np.float32) / 255
        out = lin(surf) * (1 - a[..., None]) + a[..., None]
        enc = np.where(out <= 0.0031308, out * 12.92, 1.055 * out ** (1 / 2.4) - 0.055)
        Image.fromarray((enc * 255 + 0.5).astype(np.uint8)).resize((2048, 1024), Image.LANCZOS).save(ROOT / '원본' / 'clouds' / 'check.png')
