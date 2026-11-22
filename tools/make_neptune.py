"""해왕성 표면 띠 지도 — Voyager 2 사진(PIA00046, NASA/JPL, 퍼블릭 도메인)에서 위도별 색만 뽑는다.

경도 방향 무늬(대흑점·스쿠터·구름)는 만들지 않는다(2026-11-22 사용자 결정) — 위도마다 경도 중앙값이라 점은 지워지고 띠만 남는다.
원본은 git에 넣지 않는다(`원본/neptune/PIA00046.jpg`, 주소는 textures/출처.md).
쓰는 법: python tools/make_neptune.py <PIA00046.jpg> [--check]

방법(make_saturn.py와 같은 생각, 햇빛 방향 대신 매끈한 밝기 곡면)
1. 원판: 밝기로 중심·반지름을 잡는다. 구로 본다(편평도 1.7%의 위도 오차는 띠 폭보다 작다).
2. 보는 위도 B는 Horizons(Voyager 2에서 본 해왕성, 1989-08-16~17 −29.46°)로 고정하고, 극 방향 기울기 θ(사진 위쪽에서 시계 방향)는
   띠를 따라 흐르는 밝기 기울기가 위도선과 맞는 값으로 고른다(밝기 곡면을 쓴 얼룩 최소화는 평평해 θ를 못 가렸다 — 0.17~0.20 어디서나). 밝기 얼룩은 μ·x·y 낮은 차수 곡면(림 어두워짐·위상)으로 따로 맞춰 뺀다.
3. 위도마다 중앙값 → 1024줄 → 가로로 똑같이 펼쳐 2048×1024. 못 본 위도(보는 쪽 반대 극 근처)는 가장 가까운 값에서 이어 부드럽게.
"""
import sys
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter1d

OUT = Path(__file__).resolve().parent.parent / 'textures' / 'neptune_2k.jpg'
DEG = math.pi / 180
NB = 360  # 위도 칸(0.5°)


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255


def disc(img):
    L = img.mean(2)
    m = L > 12
    ys, xs = np.nonzero(m)
    # 가장자리 점(원판 가장자리 = 각 행·열의 끝)에 원을 맞춘다
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    R = ((xs.max() - xs.min()) + (ys.max() - ys.min())) / 4
    return cx, cy, R


def points(img, cx, cy, R, step):
    H, W = img.shape[:2]
    ys, xs = np.mgrid[0:H:step, 0:W:step]
    x = (xs - cx) / R
    y = (cy - ys) / R
    r2 = x * x + y * y
    ok = r2 < 0.97 ** 2
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    return x[ok], y[ok], z[ok], img[ys[ok], xs[ok]]


def lat_of(x, y, z, theta, B):
    # 극 방향(보는 좌표: x 오른쪽, y 위, z 보는 쪽): 사진 위쪽에서 시계 방향으로 θ 기운 면 위 + B만큼 보는 쪽으로
    pole = np.array([math.sin(theta) * math.cos(B), math.cos(theta) * math.cos(B), math.sin(B)])
    return np.arcsin(np.clip(x * pole[0] + y * pole[1] + z * pole[2], -1, 1))


def basis(x, y, z):
    return np.stack([z, x, y, x * x, x * y, y * y, z * z], 1)  # 상수는 띠 색이 맡는다


def fit(x, y, z, logI, theta, B, mu_min=0.35):
    """위도 띠 색(채널마다 중앙값) + 매끈한 곡면. 반환: (남는 얼룩 크기, 띠 색 로그 [NB,3], 곡면 계수, 쓴 칸)."""
    lat = lat_of(x, y, z, theta, B)
    k = np.clip(((lat / DEG + 90) / 180 * NB).astype(int), 0, NB - 1)
    ok = z > mu_min
    Bm = basis(x, y, z)
    surf = np.zeros(7 * 3).reshape(7, 3)
    band = np.zeros((NB, 3))
    cnt = np.bincount(k[ok], minlength=NB)
    for it in range(4):
        r = logI - Bm @ surf
        for c in range(3):
            for b in np.nonzero(cnt >= 6)[0]:
                band[b, c] = np.median(r[ok & (k == b), c])
        res = logI - band[k]
        for c in range(3):
            surf[:, c] = np.linalg.lstsq(Bm[ok], res[ok, c], rcond=None)[0]
    left = logI - band[k] - Bm @ surf
    score = np.sqrt(np.mean(left[ok][:, 1] ** 2))
    return score, band, surf, cnt >= 6


def best_theta(img, cx, cy, R, B):
    """기울기 θ: 띠 둘레의 밝기 기울기(고주파)가 위도 기울기와 나란한 정도가 가장 큰 값 — 밝기 모형 없이 방향만 본다."""
    from scipy.ndimage import gaussian_filter, sobel
    L = np.log(np.maximum(srgb_to_lin(img[..., 1]), 1e-4))
    H, W = L.shape
    hp = L - gaussian_filter(L, 10)
    gy, gx = sobel(hp, 0), sobel(hp, 1)
    ys, xs = np.mgrid[0:H, 0:W]
    X, Y = (xs - cx) / R, (cy - ys) / R
    r2 = X * X + Y * Y
    Z = np.sqrt(np.clip(1 - r2, 0, 1))
    mag = np.hypot(gx, gy)
    w = np.where((r2 < 0.8 ** 2) & (mag < np.percentile(mag[r2 < 0.64], 95)), mag, 0)  # 가장 센 5%(점·구름)는 뺀다

    def score(th):
        dly, dlx = np.gradient(lat_of(X, Y, Z, th, B))
        cr = (gx * dly - gy * dlx) / (mag + 1e-12) / (np.hypot(dlx, dly) + 1e-12)
        return (w * cr ** 2).sum() / w.sum()
    cand = [(score(t * DEG), t) for t in np.arange(-45, 45.01, 3)]
    t0 = min(cand)[1]
    cand = [(score(t * DEG), t) for t in np.arange(t0 - 3, t0 + 3.01, 0.25)]
    sc, t = min(cand)
    print(f'기울기 탐색: 최소 {sc:.4f} (θ={t:+.2f}°), 0°에서 {score(0.0):.4f}, ±30°에서 {score(30 * DEG):.4f}·{score(-30 * DEG):.4f}')
    return t * DEG


def main(src: Path, check: bool):
    img = np.asarray(Image.open(src).convert('RGB'), float)
    cx, cy, R = disc(img)
    print(f'원판 중심 ({cx:.1f}, {cy:.1f}) 반지름 {R:.1f}화소')
    x, y, z, rgb = points(img, cx, cy, R, 3)
    logI = np.log(np.maximum(srgb_to_lin(rgb), 1e-4))
    # 보는 위도 B는 Horizons(관측자 Voyager 2, 1989-08-16~17, 해왕성 중심 위도 −29.46°)로 고정하고 기울기 θ만 훑는다 —
    # 둘 다 훑으면 얼룩이 가장 작은 쪽이 엉뚱한 구석(B +61°)으로 간다.
    B = -29.4 * DEG
    theta = best_theta(img, cx, cy, R, B)
    best = (0.0, theta, B)
    s, theta, B = best
    print(f'기울기 θ = {theta / DEG:+.2f}° · 보는 위도 B = {B / DEG:+.2f}° · 남는 얼룩 {s:.4f}(로그)')
    x, y, z, rgb = points(img, cx, cy, R, 2)
    logI = np.log(np.maximum(srgb_to_lin(rgb), 1e-4))
    s, band, surf, seen = fit(x, y, z, logI, theta, B)
    print(f'본 위도 {seen.sum() / 2:.0f}° / 180° (칸 {seen.sum()}/{NB})')
    # 못 본 위도는 가까운 값에서 이어 간다
    idx = np.nonzero(seen)[0]
    full = np.empty((NB, 3))
    for c in range(3):
        full[:, c] = np.interp(np.arange(NB), idx, band[idx, c])
    full = gaussian_filter1d(full, 1.2, axis=0, mode='nearest')
    # 1024줄로, 위도 90°N이 맨 위
    lat = np.linspace(90, -90, 1024, endpoint=False) - 90 / 1024
    pos = (lat + 90) / 180 * NB - 0.5
    rows = np.stack([np.interp(pos, np.arange(NB), full[:, c]) for c in range(3)], 1)
    tex = lin_to_srgb(np.exp(rows))
    out = np.repeat(tex[:, None, :], 2048, axis=1)
    Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8)).save(OUT, quality=90, optimize=True, progressive=True)
    print(f'{OUT.name}: {OUT.stat().st_size // 1024}KB 맨 위 {np.round(tex[0])} 적도 {np.round(tex[512])} 맨 아래 {np.round(tex[-1])}')
    if check:
        # 확인 그림: 사진 위에 위도선(10°)
        im = Image.fromarray(img.astype(np.uint8))
        d = ImageDraw.Draw(im)
        pole = np.array([math.sin(theta) * math.cos(B), math.cos(theta) * math.cos(B), math.sin(B)])
        for latd in range(-80, 90, 10):
            f = latd * DEG
            pts = []
            for t in np.linspace(0, 2 * math.pi, 400):
                # 극 방향 p에 수직인 두 축 e1·e2로 위도 원을 그린다
                e1 = np.cross(pole, [0, 0, 1.0]); e1 /= np.linalg.norm(e1)
                e2 = np.cross(pole, e1)
                P = math.sin(f) * pole + math.cos(f) * (math.cos(t) * e1 + math.sin(t) * e2)
                if P[2] > 0:
                    pts.append((cx + P[0] * R, cy - P[1] * R))
                elif len(pts) > 1:
                    d.line(pts, fill=(255, 60, 60) if latd == 0 else (255, 255, 0), width=1); pts = []
            if len(pts) > 1:
                d.line(pts, fill=(255, 60, 60) if latd == 0 else (255, 255, 0), width=1)
        p = src.parent / 'check_neptune.png'
        im.resize((700, 700)).save(p)
        print('확인 그림', p)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--check']
    if len(args) != 1:
        raise SystemExit(__doc__)
    main(Path(args[0]), '--check' in sys.argv)
