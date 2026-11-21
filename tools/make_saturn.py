"""토성 표면 띠 지도 만들기 — Cassini 자연색 사진 두 장(NASA/JPL/SSI, 퍼블릭 도메인)에서 위도별 색을 뽑는다.

토성은 경도 방향 무늬가 거의 없어 위도별 띠로 충분하다. 공개된 원통 지도가 없어서 사진에서 직접 뽑는다.
  남반구: PIA06193 (2004-10-06, 남쪽에서 봄)   북반구: PIA21046 (2016-04-25, 북쪽에서 봄)
원본은 git에 넣지 않는다. 받는 주소는 textures/출처.md.
쓰는 법: python tools/make_saturn.py <원본 폴더> [--check]   (--check: 사진 위에 맞춘 위도선을 그린 확인 그림을 원본 폴더에)

방법
1. 보는 각도·크기·기울기: 고리 바깥 테두리(A고리 끝 136,774km)를 타원으로 맞춘다. 짧은 지름/긴 지름 = |sin B|(B: 보는 위도).
2. 사진의 각 화소를 편평한 회전 타원체(적도 60,268km · 극 54,364km) 위 점으로 되돌려 행성 중심 위도를 구한다.
3. 밝기 보정: 햇빛 방향은 해의 토성 위도(ephemeris.js로 계산)와 위상각(캡션)에서 구하고, Minnaert 법칙
   I = A·μ0^k·μ^(k−1)로 나눠 반사율 A를 얻는다. 고리에 가린 화소·비스듬한 화소(μ, μ0 < 0.3)는 뺀다.
4. 위도마다 중앙값. 두 사진이 겹치는 적도 부근(−5°~+5°)에서 북반구 사진의 채널별 배율을 남반구에 맞춘다.
5. 평균 밝기는 목성 지도와 기하 알베도 비로 맞춘다(사진 노출은 제각각이라).
"""
import sys
import math
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
OUT = Path(__file__).resolve().parent.parent / 'textures' / 'saturn_2k.jpg'
RE, RP = 60268.0, 54364.0     # 1bar 적도·극 반지름(km, IAU)
A_RING = 136774.0             # A고리 바깥 끝(src/rings.js RING_EDGES.aOut)
RING_IN = 74490.0             # C고리 안쪽 끝 — 이 안쪽은 가리지 않는다
K = 0.9                       # Minnaert 지수(가시광 토성 근사)
DEG = math.pi / 180

# 사진마다: 파일, 해의 토성 위도(°, ephemeris.js), 위상각(°, 캡션), 쓸 위도 범위
SHOTS = {
    'south': dict(file='PIA06193.jpg', sun_lat=-23.76, phase=72.0, lat=(-90, 5)),
    'north': dict(file='PIA21046.tif', sun_lat=26.11, phase=55.0, lat=(-5, 90)),
}


def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255


def fit_ring(L):
    """고리 바깥 테두리 타원 — 중심에서 사방으로 나가며 마지막 밝은 화소를 모아 맞춘다."""
    H, W = L.shape
    mask = L > 25
    ys, xs = np.nonzero(mask)
    cx, cy = xs.mean(), ys.mean()
    pts = []
    rmax = int(max(W, H) * 0.6)
    rr = np.arange(rmax)
    # 좌우 고리 팔만 쓴다 — 위·아래로는 행성이 고리 테두리 밖으로 튀어나와(남쪽에서 본 2004년 사진) 그 테두리가 잡힌다
    angs = np.linspace(0, 2 * np.pi, 2880, endpoint=False)
    angs = angs[np.abs(np.sin(angs)) < math.sin(35 * DEG)]
    for a in angs:
        x = (cx + np.cos(a) * rr).astype(int)
        y = (cy + np.sin(a) * rr).astype(int)
        ok = (x >= 0) & (x < W) & (y >= 0) & (y < H)
        hit = np.nonzero(mask[y[ok], x[ok]])[0]
        if len(hit):
            pts.append((x[ok][hit[-1]], y[ok][hit[-1]]))
    pts = np.array(pts, np.float32)
    # 고리 위로 튀어나온 행성 테두리 같은 엉뚱한 점을 빼며 다시 맞춘다
    keep = np.ones(len(pts), bool)
    for _ in range(6):
        (ex, ey), (w, h), ang = cv2.fitEllipse(pts[keep])
        if w > h:
            a_px, b_px, t = w / 2, h / 2, ang * DEG
        else:
            a_px, b_px, t = h / 2, w / 2, (ang + 90) * DEG
        e1 = np.array([math.cos(t), math.sin(t)])
        e2 = np.array([-e1[1], e1[0]])
        q = pts - (ex, ey)
        rho = np.hypot(q @ e1 / a_px, q @ e2 / b_px)  # 타원 위면 1
        res = np.abs(rho - 1) * b_px  # 대략 화소
        keep = res < max(2.0, np.percentile(res[keep], 60) * 2)
    e_maj = e1 if e1[0] >= 0 else -e1  # 오른쪽을 향하게
    e_up = np.array([e_maj[1], -e_maj[0]])
    if e_up[1] > 0:
        e_up = -e_up  # 화면 위쪽
    resid = np.median(res[keep])
    return dict(c=np.array([ex, ey]), a=a_px, b=b_px, e_maj=e_maj, e_up=e_up, resid=resid, used=f'{keep.sum()}/{len(pts)}')


def geometry(L, shot, north_view):
    g = fit_ring(L)
    B = math.asin(g['b'] / g['a']) * (1 if north_view else -1)
    s = g['a'] / A_RING  # 화소/km
    d = np.array([0, math.sin(B), math.cos(B)])  # 몸체 좌표(X 오른쪽, Y 북극, Z 보는 쪽)에서 보는 방향
    up = np.array([0, math.cos(B), -math.sin(B)])
    # 햇빛 방향: 위도 sun_lat, 보는 방향과의 각 = 위상각
    bs, ph = shot['sun_lat'] * DEG, shot['phase'] * DEG
    cosD = (math.cos(ph) - math.sin(B) * math.sin(bs)) / (math.cos(B) * math.cos(bs))
    D = math.acos(max(-1, min(1, cosD)))
    return g, B, s, d, up, bs, D


def sample(img, L, shot, north_view):
    g, B, s, d, up, bs, D = geometry(L, shot, north_view)
    H, W = L.shape
    lin = srgb_to_lin(img)
    # 밝은 쪽(경도 +/−)은 원판 좌우 밝기로 정한다
    best = None
    for sign in (1, -1):
        sun = np.array([math.cos(bs) * math.sin(sign * D), math.sin(bs), math.cos(bs) * math.cos(sign * D)])
        lats = np.arange(-89.75, 90, 0.5)
        rows = np.full((len(lats), 3), np.nan)
        score = []
        for i, lat in enumerate(lats):
            if not (shot['lat'][0] <= lat <= shot['lat'][1]):
                continue
            f = lat * DEG
            r = 1 / math.sqrt(math.cos(f) ** 2 / RE ** 2 + math.sin(f) ** 2 / RP ** 2)
            lon = np.arange(-180, 180, 0.25) * DEG
            P = np.stack([r * math.cos(f) * np.sin(lon), np.full_like(lon, r * math.sin(f)), r * math.cos(f) * np.cos(lon)], 1)
            n = P / np.array([RE ** 2, RP ** 2, RE ** 2])
            n /= np.linalg.norm(n, axis=1, keepdims=True)
            mu, mu0 = n @ d, n @ sun
            ok = (mu > 0.3) & (mu0 > 0.3)
            # 고리에 가림: 보는 쪽으로 간 시선이 고리면을 C~A고리 안에서 지난다
            t = -P[:, 1] / d[1]
            Q = P + t[:, None] * d
            rq = np.hypot(Q[:, 0], Q[:, 2])
            ok &= ~((t > 0) & (rq > RING_IN) & (rq < A_RING))
            if ok.sum() < 8:
                continue
            u, v = P[ok, 0], P[ok] @ up
            xy = g['c'] + s * (u[:, None] * g['e_maj'] + v[:, None] * g['e_up'])
            x, y = np.round(xy[:, 0]).astype(int), np.round(xy[:, 1]).astype(int)
            inn = (x >= 0) & (x < W) & (y >= 0) & (y < H)
            if inn.sum() < 8:
                continue
            I = lin[y[inn], x[inn]]
            phot = (mu0[ok][inn] ** K * mu[ok][inn] ** (K - 1))[:, None]
            A = I / phot
            rows[i] = np.median(A, 0)
            score.append(np.std(A.mean(1)) / max(1e-6, np.mean(A.mean(1))))
        cand = (np.nanmean(score) if score else 9, sign, rows)
        if best is None or cand[0] < best[0]:
            best = cand
    return best[2], best[1], (g, B, s, D)


def check_image(img, shot, geo, sign, path):
    g, B, s, D = geo
    im = Image.fromarray(img.astype(np.uint8))
    dr = ImageDraw.Draw(im)
    d = np.array([0, math.sin(B), math.cos(B)])
    up = np.array([0, math.cos(B), -math.sin(B)])
    lw = max(1, int(im.width / 1000))
    for lat in range(-80, 90, 10):
        f = lat * DEG
        r = 1 / math.sqrt(math.cos(f) ** 2 / RE ** 2 + math.sin(f) ** 2 / RP ** 2)
        pts = []
        for lon in np.arange(-90, 91, 2) * DEG:
            P = np.array([r * math.cos(f) * math.sin(lon), r * math.sin(f), r * math.cos(f) * math.cos(lon)])
            n = P / np.array([RE ** 2, RP ** 2, RE ** 2])
            if n @ d <= 0:
                if len(pts) > 1:
                    dr.line(pts, fill=(255, 60, 60) if lat == 0 else (60, 200, 255), width=lw)
                pts = []
                continue
            xy = g['c'] + s * (P[0] * g['e_maj'] + (P @ up) * g['e_up'])
            pts.append(tuple(xy))
        if len(pts) > 1:
            dr.line(pts, fill=(255, 60, 60) if lat == 0 else (60, 200, 255), width=lw)
    # 고리 바깥 테두리
    pts = [tuple(g['c'] + g['a'] * math.cos(t) * g['e_maj'] + g['b'] * math.sin(t) * g['e_up']) for t in np.linspace(0, 2 * np.pi, 400)]
    dr.line(pts, fill=(255, 220, 0), width=lw)
    im.thumbnail((1600, 1600))
    im.save(path, quality=85)


def main(root: Path, check: bool):
    bands = {}
    for key, shot in SHOTS.items():
        img = np.asarray(Image.open(root / shot['file']).convert('RGB')).astype(float)
        L = img.mean(2)
        rows, sign, geo = sample(img, L, shot, key == 'north')
        g, B, s, D = geo
        print(f"{shot['file']}: B={B / DEG:+.2f}° 축척 {1 / s:.1f}km/화소 고리 맞춤 잔차 {g['resid']:.2f}화소(점 {g['used']}) "
              f"햇빛 경도 {sign * D / DEG:+.1f}° 위도 {np.sum(~np.isnan(rows[:, 0]))}줄")
        bands[key] = rows
        if check:
            check_image(img, shot, geo, sign, root / f"check_{key}.jpg")
    lats = np.arange(-89.75, 90, 0.5)
    S, N = bands['south'], bands['north']
    both = ~np.isnan(S[:, 0]) & ~np.isnan(N[:, 0])
    gain = np.nanmedian(S[both] / N[both], 0)
    print(f'겹치는 위도 {both.sum()}줄, 북반구 사진 배율 R·G·B = {np.round(gain, 3)}')
    N = N * gain
    band = np.where(np.isnan(S), N, np.where(np.isnan(N), S, (S + N) / 2))
    # 극 가까이 빈 줄은 가장 가까운 값으로
    good = ~np.isnan(band[:, 0])
    for c in range(3):
        band[:, c] = np.interp(lats, lats[good], band[good, c])
    print(f'채운 위도 범위 {lats[good][0]:+.2f}° ~ {lats[good][-1]:+.2f}° (밖은 끝값으로)')
    # 사진마다 노출이 달라 절대 밝기는 버리고, 목성 지도(jupiter_2k.jpg)와 기하 알베도 비(토성 0.499 / 목성 0.538,
    # Mallama et al. 2017)가 맞도록 평균 휘도를 맞춘다
    jup = srgb_to_lin(np.asarray(Image.open(OUT.parent / 'jupiter_2k.jpg').convert('RGB')).astype(float)).reshape(-1, 3)
    lum = lambda c: c @ np.array([0.2126, 0.7152, 0.0722])
    w = np.cos(lats * DEG)  # 면적 가중
    band = band * (lum(jup).mean() * 0.499 / 0.538) / (np.sum(lum(band) * w) / np.sum(w))
    print('평균 반사율(선형) R·G·B', np.round(np.sum(band * w[:, None], 0) / np.sum(w), 3))
    srgb = lin_to_srgb(band)[::-1]  # 위쪽 = 북극
    col = np.asarray(Image.fromarray(srgb[:, None, :].astype(np.uint8)).resize((1, 1024), Image.BILINEAR))
    tex = np.repeat(col, 2048, axis=1)
    Image.fromarray(tex).save(OUT, quality=90)
    print(f'{OUT.name}: {OUT.stat().st_size // 1024}KB')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]), '--check' in sys.argv)
