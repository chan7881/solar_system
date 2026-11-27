"""이아페투스 지도 — 어두운 앞쪽 반구(Cassini Regio)와 밝은 뒤쪽 반구의 명암 차이를 살린 2048×1024 흑백 JPG.

USGS 모자이크(make_saturnmoons.py)는 밝기를 고르게 맞춰 두 반구가 83 대 110 정도로만 다르다. 실제 반사율은 약 10배 차이다:
  Squyres & Sagan 1983 (Nature 303, 782) 「앞쪽 꼭짓점에서 뒤쪽으로 약 10배」 · Spencer & Denk 2010 (Science 327, 432) 0.04 대 0.39
  · Buratti et al. 2005 0.04 대 0.4.
원본은 명암이 남아 있는 Cassini ISS 전구 색 지도 NASA PIA18436(2014, Schenk/LPI, 400m/화소) — 원본/saturnmoons/PIA18436.tif(git 밖).
  색은 자외선~적외선으로 늘린 것이라 쓰지 않고 밝기(Rec.709 가중합)만 쓴다.
  배치: 왼쪽 끝 동경 0°·동쪽이 오른쪽. USGS 지도와 고주파 무늬 상관이 180° 이동·안 뒤집음에서만 최고(2026-11-27),
  Engelier 분지(남위 44°·동경 96°)와 Cassini Regio 중심(동경 약 270°) 자리로도 확인. `check` 인자로 분화구 겹친 그림.
밝기 옮기기: 선형 반사율 L = K·v^G (v = 원본 밝기/255). 원본의 밝기 곡선은 알려져 있지 않아(선형으로 읽으면 1/5.7, sRGB로 읽으면 1/30)
  G는 어두운 쪽 중심(남북위 20° 안·동경 240~300°)과 밝은 쪽(남북위 20° 안·동경 60~120°) 평균 비가 RATIO가 되도록 정하고,
  K는 밝은 쪽 평균을 예전 USGS 지도 같은 자리의 선형 평균 BRIGHT로 맞춘다(밝은 쪽 보이는 밝기는 그대로, 명암만 바로잡음).
쓰는 법: python tools/make_iapetus.py <원본/saturnmoons 폴더> [check]
"""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_galilean import OUT, load, to_app  # noqa: E402

SRC = 'PIA18436.tif'
LEFT = 0          # 원본 왼쪽 끝의 동경(°)
RATIO = 0.10      # 어두운 쪽 / 밝은 쪽 반사율
BRIGHT = 0.1674   # 밝은 쪽 상자의 선형 평균 — 예전 USGS 지도(커밋 87f53b5의 textures/iapetus_2k.jpg)에서 잰 값
DARK_BOX = (240, 300, -20, 20)   # 동경 시작·끝, 위도 아래·위
BRIGHT_BOX = (60, 120, -20, 20)


def srgb_to_lin(v):
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(x):
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.maximum(x, 0), 1 / 2.4) - 0.055)


def box(a: np.ndarray, b, left_lon_e: float) -> np.ndarray:
    """지도 a(왼쪽 끝 동경 left_lon_e, 동쪽이 오른쪽)에서 상자 b의 값."""
    h, w = a.shape[:2]
    l0, l1, b0, b1 = b
    r0, r1 = round((90 - b1) / 180 * h), round((90 - b0) / 180 * h)
    c0 = round(((l0 - left_lon_e) % 360) / 360 * w)
    return np.roll(a, -c0, axis=1)[r0:r1, :round(((l1 - l0) % 360) / 360 * w)]  # 이음매를 넘는 상자도 잘리지 않게


def solve_gamma(v: np.ndarray, left: float) -> float:
    d, b = box(v, DARK_BOX, left), box(v, BRIGHT_BOX, left)
    lo, hi = 0.2, 5.0
    f = lambda g: (d ** g).mean() / (b ** g).mean()
    if not f(hi) <= RATIO <= f(lo):
        raise SystemExit(f'G {lo}~{hi} 안에서 비 {RATIO}를 못 맞춤({f(lo):.3f}~{f(hi):.3f})')
    for _ in range(60):  # G가 클수록 비가 작아진다
        g = (lo + hi) / 2
        if (d ** g).mean() / (b ** g).mean() > RATIO:
            lo = g
        else:
            hi = g
    return (lo + hi) / 2


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != 'check']
    if not args:
        raise SystemExit(__doc__)
    root = Path(args[0])
    Image.MAX_IMAGE_PIXELS = None
    a, empty = load(root / SRC)
    print(f'관측 없어 메운 칸 {empty:.2%}')
    y = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32) if a.ndim == 3 and a.shape[2] == 3 else a.reshape(a.shape[:2])
    v = np.clip(y / 255, 1e-4, 1)
    g = solve_gamma(v, LEFT)
    k = BRIGHT / (box(v, BRIGHT_BOX, LEFT) ** g).mean()
    L = k * v ** g
    print(f'G = {g:.3f}, K = {k:.4f}, 최대 반사율(선형) {L.max():.3f}')
    if L.max() > 1:
        raise SystemExit('반사율이 1을 넘는 칸이 있어 잘리면 밝은 쪽 평균이 BRIGHT에서 벗어난다')
    out = np.clip(lin_to_srgb(L) * 255 + 0.5, 0, 255).astype(np.uint8)
    img = Image.fromarray(to_app(out, LEFT))  # 흑백(L) — 세 채널이 같으므로
    if 'check' in sys.argv:
        from make_saturnmoons import check
        craters = json.load(open(root / 'names' / 'craters.json', encoding='utf-8'))['iapetus']
        check('iapetus', img.convert('RGB'), craters).save(root / 'check_iapetus_pia.png')
        raise SystemExit
    dst = OUT / 'iapetus_2k.jpg'
    img.save(dst, quality=88, optimize=True, progressive=True)
    # 저장한 JPG를 다시 읽어 잰다 — 앱 규약(왼쪽 끝 −180°)
    lin = srgb_to_lin(np.asarray(Image.open(dst).convert('L')).astype(float) / 255)
    d, b = box(lin, DARK_BOX, -180).mean(), box(lin, BRIGHT_BOX, -180).mean()
    print(f'{dst.name}: {dst.stat().st_size // 1024}KB · 어두운 쪽 {d:.4f} / 밝은 쪽 {b:.4f} = {d / b:.3f}')
    if abs(d / b - RATIO) > 0.005 or abs(b - BRIGHT) > 0.002:
        raise SystemExit(f'저장한 지도가 목표와 다름: 비 {d / b:.3f}(목표 {RATIO}) · 밝은 쪽 {b:.4f}(목표 {BRIGHT})')
