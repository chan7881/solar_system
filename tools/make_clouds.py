"""지구 구름 질감 — NASA GIBS의 VIIRS(NOAA-20·21) 가시광 합성에서 구름 투명도만 뽑아 흑백 JPG로.

받는 곳: GIBS WMS(epsg4326, 전구 −180~180·−90~90, 4096×2048) — 레이어 VIIRS_NOAA20(틈 메우기 NOAA21)_CorrectedReflectance_TrueColor,
눈·얼음 가르기는 VIIRS_NOAA20_CorrectedReflectance_BandsM11-I2-I1(눈·얼음 구름은 하늘색). MODIS는 폭이 좁아 궤도 가장자리 줄무늬가 커서 쓰지 않았다.
(VIIRS SNPP는 이 날짜들에 GIBS가 영상을 주지 않았다 — 3KB짜리 오류 그림이 온다.) 하루치 영상의 틈은 NOAA21로 메우고 겨울 반구 극지는 극야로 비어 있다.
그래서 기준 날짜(BASE)로 만들고, 북극 쪽은 여름 날짜(NORTH)로 위도 45~60° 사이에서 서서히 바꿔 채운다.
원본 영상은 원본/clouds/ 에 받아 둔다(git 밖).

구름 뽑기: 구름은 흰색(세 채널이 비슷하게 높음), 땅·바다는 어느 한 채널이 낮다 → 관측의 min(R,G,B) 가 구름 몫.
맑은 날 지표(textures/earth_2k.jpg)의 min(R,G,B)를 바탕으로 빼서 구름 투명도를 낸다(눈·사막처럼 바탕이 밝은 곳은 자동으로 약해진다).
색은 셰이더에서 입힌다(흰색 × 낮 밝기). 구름은 시간을 돌려도 고정(사용자 결정, 2026-11-22).
쓰는 법: python tools/make_clouds.py [check]   — check는 구름을 지표 위에 얹은 확인 그림을 scratch에 낸다
"""
import sys
import urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

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


def merged(date: str):
    """NOAA20 우선, 틈은 NOAA21로. 반환: (rgb, 유효)"""
    t, q = fetch('NOAA20', date), fetch('NOAA21', date)
    vt, vq = valid(t), valid(q)
    rgb = np.where(vt[..., None], t[..., :3], q[..., :3])
    return rgb, vt | vq


def cloud_alpha() -> np.ndarray:
    rgb, ok = merged(BASE)
    rgbN, okN = merged(NORTH)
    lat = 90 - (np.arange(H) + 0.5) / H * 180
    wN = np.clip((lat - 45) / 15, 0, 1)[:, None]           # 위도 45° 이하 0 → 60° 이상 1
    wN = np.where(okN, wN, 0)
    wN = np.where(~ok, np.where(okN, 1, 0), wN)             # 기준에 없으면 여름 영상으로
    rgb = rgb * (1 - wN[..., None]) + rgbN * wN[..., None]
    ok = ok | okN
    m = rgb.min(axis=-1)
    surf = np.asarray(Image.open(SURF).convert('RGB').resize((W, H), Image.LANCZOS), dtype=np.float32) / 255
    mb = surf.min(axis=-1)
    a = np.clip((m - mb * 0.9 - 0.08) / (1 - mb * 0.9 - 0.08), 0, 1)
    # 눈·얼음: 7-2-1 합성에서 하늘색(G − R 큼). 위도 45° 위·−55° 아래에서만 걸러 낸다(열대 얼음 구름은 남긴다)
    def cyan(date):
        b = np.asarray(Image.fromarray((fetch('NOAA20', date, 'BandsM11-I2-I1', 2048, 1024)[..., :3] * 255).astype(np.uint8))
                       .resize((W, H), Image.BILINEAR), dtype=np.float32) / 255
        return np.clip((b[..., 1] - b[..., 0] - 0.12) / 0.2, 0, 1)
    cy = cyan(BASE) * (1 - wN) + cyan(NORTH) * wN
    zone = np.clip((np.abs(lat) - 45) / 10, 0, 1)[:, None]
    zone = np.where(lat[:, None] < 0, np.clip((-lat[:, None] - 55) / 10, 0, 1), zone)
    a = a * (1 - cy * zone)
    a = np.where(ok, a, 0)
    return np.clip(a ** 1.1, 0, 1)


if __name__ == '__main__':
    a = cloud_alpha()
    im = Image.fromarray((a * 255).astype(np.uint8), 'L')
    im.save(OUT, quality=88, optimize=True)
    print(f'{OUT.name}: {OUT.stat().st_size // 1024}KB, 평균 {a.mean():.3f}, 0.5 넘는 칸 {np.mean(a > 0.5) * 100:.1f}%')
    if 'check' in sys.argv:
        surf = np.asarray(Image.open(SURF).convert('RGB').resize((W, H), Image.LANCZOS), dtype=np.float32) / 255
        out = surf * (1 - a[..., None]) + a[..., None]
        Image.fromarray((out * 255).astype(np.uint8)).resize((2048, 1024), Image.LANCZOS).save(ROOT / '원본' / 'clouds' / 'check.png')
