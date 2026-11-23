"""해왕성 대흑점(GDS-89) 무늬 레이어 — Voyager 2 사진 PIA00046(NASA/JPL, 퍼블릭 도메인)에서 띠 밝기와의 차이만 뽑는다.

`make_neptune.py`와 같은 원판·기울기·밝기 곡면·띠 모형을 쓰고(그래야 띠 지도 위에 얹었을 때 어긋나지 않는다),
사진을 위도·경도 격자로 펴서 (사진 ÷ 띠·곡면)을 무늬로 남긴다. 1989년 모습으로 고정한 한 장짜리 무늬다.
경도: 사진 가운데 경도는 Horizons(관측자 Voyager 2, 1989-08-20 08:00 UT — 사진 설명 「근접 통과 4일 20시간 전」,
근접 통과 1989-08-25 03:56 UT)의 관측 아래점 서경 76.4°(Neptune 서경+, IAU2015 System II) → 지도 가운데 0°·동경 오른쪽이면 동경 283.6°.
시각 오차 ±1시간이면 ±22°.
쓰는 법: python tools/make_neptune_gds.py <PIA00046.jpg> [--check]
출력: textures/neptune_gds_2k.png (RGBA 2048×1024, 띠 지도와 같은 가로세로 배치 — 알파 0이면 띠 지도 그대로)
"""
import sys
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, map_coordinates

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_neptune as mn

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'textures' / 'neptune_gds_2k.png'
DEG = math.pi / 180
CENTER_ELON = -76.355  # 사진 가운데의 동경(= −서경 76.355°, 1989-08-20 08:00 UT)
MU_MIN = 0.30          # 이보다 가장자리에 가까운 곳은 쓰지 않는다
W, H = 2048, 1024


def frame(theta, B):
    p = np.array([math.sin(theta) * math.cos(B), math.cos(theta) * math.cos(B), math.sin(B)])
    s = np.array([0, 0, 1.0])
    a = s - p * (s @ p); a /= np.linalg.norm(a)   # 가운데 자오선 방향(적도에서 보는 쪽)
    e = np.cross(p, a)                              # 동쪽(자전 방향)
    return p, a, e


def unroll(img, cx, cy, R, theta, B, band_rows, surf):
    """지도 격자 (위도·경도)마다 사진의 (사진÷띠·곡면)을 로그로 뽑는다. 반환: (res[H,W,3], mu[H,W])."""
    p, a, e = frame(theta, B)
    lat = (90 - (np.arange(H) + 0.5) / H * 180) * DEG
    lon = ((np.arange(W) + 0.5) / W * 360 - 180 + 0) * DEG   # 동경 −180~180, 가운데 0° = 사진 가운데 경도가 아니라 절대 경도
    LON, LAT = np.meshgrid(lon, lat)
    rel = LON - CENTER_ELON * DEG                          # 사진 가운데 자오선에서 동쪽으로 잰 각
    P = (np.sin(LAT)[..., None] * p + np.cos(LAT)[..., None] *
         (np.cos(rel)[..., None] * a + np.sin(rel)[..., None] * e))
    mu = P[..., 2]
    X = cx + P[..., 0] * R
    Y = cy - P[..., 1] * R
    logI = np.log(np.maximum(mn.srgb_to_lin(img), 1e-4))
    samp = np.stack([map_coordinates(logI[..., c], [Y, X], order=1, mode='nearest') for c in range(3)], -1)
    Bm = mn.basis(P[..., 0].ravel(), P[..., 1].ravel(), P[..., 2].ravel()).reshape(H, W, 7)
    k = np.clip(((LAT / DEG + 90) / 180 * mn.NB).astype(int), 0, mn.NB - 1)
    res = samp - band_rows[k] - np.einsum('hwk,kc->hwc', Bm, surf)
    return res, mu, LON / DEG, LAT / DEG


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def window(lat, lon, mu):
    """대흑점과 짝 구름이 든 창(동경 −150~−88°, 위도 −32~−4°) — 가장자리 6°씩 부드럽게. 사진 가장자리(μ<0.35)는 뺀다."""
    f = 6.0
    w = smooth((lon + 150) / f) * smooth((-88 - lon) / f) * smooth((lat + 32) / f) * smooth((-4 - lat) / f)
    return w * smooth((mu - MU_MIN) / 0.15)


def layer(res, mu, lon, lat, band_rows):
    """무늬 RGBA: 색 = 띠 색 × 사진 ÷ 띠·곡면, 알파 = 창 × 무늬 세기(0.05 아래는 잡음으로 보고 0)."""
    g = gaussian_filter(res, (1.0, 1.0, 0))          # 사진 화소가 격자보다 성기니 한 칸 정도만 매끄럽게
    amp = np.abs(g[..., 1])
    a = window(lat, lon, mu) * smooth((amp - 0.05) / 0.10)
    k = np.clip(((lat / DEG_ + 90) / 180 * mn.NB).astype(int), 0, mn.NB - 1)
    lin = np.exp(band_rows[k] + g)
    rgb = mn.lin_to_srgb(lin)
    # 창 밖은 색을 비워 파일을 줄인다. 창 안은 알파가 0이어도 색을 남긴다 — 비우면 질감 보간에서 알파 가장자리가 검게 번진다
    rgb = np.where(window(lat, lon, mu)[..., None] > 0.0, np.clip(rgb + 0.5, 0, 255), 0)
    return np.dstack([rgb, a * 255]).astype(np.uint8), a


DEG_ = 1.0  # lat은 이미 도 단위


def render(tex_base, tex_gds, theta, B, n=500):
    """같은 시점(사진 가운데 경도·보는 위도·기울기)에서 띠 지도+무늬 레이어를 구로 그려 사진과 견준다."""
    p, a, e = frame(theta, B)
    ys, xs = np.mgrid[0:n, 0:n]
    x = (xs + 0.5 - n / 2) / (n / 2) * 1.0
    y = -(ys + 0.5 - n / 2) / (n / 2)
    r2 = x * x + y * y
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    P = np.stack([x, y, z], -1)
    lat = np.degrees(np.arcsin(np.clip(P @ p, -1, 1)))
    lon = np.degrees(np.arctan2(P @ e, P @ a)) + CENTER_ELON
    lon = (lon + 180) % 360 - 180
    u = (lon + 180) / 360 * W - 0.5
    v = (90 - lat) / 180 * H - 0.5
    out = np.zeros((n, n, 3))
    for c in range(3):
        base = map_coordinates(tex_base[..., c], [v, u], order=1, mode='wrap')
        gds = map_coordinates(tex_gds[..., c], [v, u], order=1, mode='wrap')
        al = map_coordinates(tex_gds[..., 3], [v, u], order=1, mode='wrap') / 255
        out[..., c] = base * (1 - al) + gds * al
    out *= (r2 < 1)[..., None]
    return out.astype(np.uint8)


def main(src: Path, check: bool):
    img = np.asarray(Image.open(src).convert('RGB'), float)
    cx, cy, R = mn.disc(img)
    B = -29.4 * DEG
    theta = mn.best_theta(img, cx, cy, R, B)
    x, y, z, rgb = mn.points(img, cx, cy, R, 2)
    logI = np.log(np.maximum(mn.srgb_to_lin(rgb), 1e-4))
    s, band, surf, seen = mn.fit(x, y, z, logI, theta, B)
    idx = np.nonzero(seen)[0]
    full = np.stack([np.interp(np.arange(mn.NB), idx, band[idx, c]) for c in range(3)], 1)
    res, mu, LON, LAT = unroll(img, cx, cy, R, theta, B, band_rows=full, surf=surf)
    rgba, a = layer(res, mu, LON, LAT, full)
    Image.fromarray(rgba, 'RGBA').save(OUT, optimize=True)
    nz = a > 0.02
    print(f'{OUT.name}: {OUT.stat().st_size // 1024}KB · 알파>0 칸 {nz.sum()} · 위도 {LAT[nz].min():.1f}~{LAT[nz].max():.1f} · 동경 {LON[nz].min():.1f}~{LON[nz].max():.1f}')
    if check:
        base = np.asarray(Image.open(ROOT / 'textures' / 'neptune_2k.jpg').convert('RGB'), float)
        mine = render(base, rgba.astype(float), theta, B)
        ph = np.asarray(Image.open(src).convert('RGB').crop((int(cx - R * 1.0), int(cy - R * 1.0), int(cx + R * 1.0), int(cy + R * 1.0))).resize((500, 500)))
        bs = render(base, np.zeros((H, W, 4)), theta, B)
        sheet = np.concatenate([ph, mine, bs], 1)
        sc = np.asarray(Image.fromarray(rgba[..., :3]))
        pth = src.parent / 'check_gds.png'
        Image.fromarray(sheet).save(pth)
        # 펼친 무늬 — 알파를 검은 바탕에 얹어 창 둘레만
        crop = (slice(240, 520), slice(150, 700))
        flat = np.where(a[..., None] > 0.02, rgba[..., :3], 0)[crop]
        Image.fromarray(flat.astype(np.uint8)).save(src.parent / 'check_gds_flat.png')
        print('확인 그림', pth)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--check']
    if len(args) != 1:
        raise SystemExit(__doc__)
    main(Path(args[0]), '--check' in sys.argv)
