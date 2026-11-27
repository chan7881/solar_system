"""흑점 지도 확인 — 지도를 그날 지구에서 본 원판으로 되돌려 실제 HMIIF 영상과 흑점 어두움(1−I)의 상관을 잰다.
python tools/check_sunspots.py [flip]  — flip은 좌우를 뒤집은 지도(변이)로 같은 값을 잰다(크게 떨어져야 한다)."""
import sys, os
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_sunspots import images, horizons, disk, I0, OUT, SRC

def main(flip=False):
    m = np.asarray(Image.open(OUT).convert('L')).astype(float) / 255
    M = np.where(m <= 0.04045, m / 12.92, ((m + 0.055) / 1.055) ** 2.4)
    if flip: M = M[:, ::-1]
    fs = images(); geo = horizons(fs); res = []
    for f, (L0, B0) in zip(fs, geo):
        A = np.asarray(Image.open(f).convert('L')).astype(float)
        cx, cy, r = [v / 4 for v in disk(A)]
        a = A.reshape(1024, 4, 1024, 4).mean((1, 3))  # 4×4 평균으로 1024px — 낟알 무늬·JPEG 잡음을 줄인다
        yy, xx = np.mgrid[:a.shape[0], :a.shape[1]]
        X = (xx - cx) / r; Y = -(yy - cy) / r; inside = X * X + Y * Y < 0.85 ** 2
        l0, b0 = np.radians(L0), np.radians(B0)
        o = np.array([np.cos(b0) * np.cos(l0), np.cos(b0) * np.sin(l0), np.sin(b0)])
        n = np.array([0, 0, 1.0]) - np.sin(b0) * o; n /= np.linalg.norm(n); right = np.cross(n, o)
        mu = np.sqrt(np.clip(1 - X * X - Y * Y, 0, 1))
        P = mu[..., None] * o + X[..., None] * right + Y[..., None] * n
        lon = np.degrees(np.arctan2(P[..., 1], P[..., 0])); lat = np.degrees(np.arcsin(np.clip(P[..., 2], -1, 1)))
        ix = np.clip(((lon + 180) / 360 * M.shape[1]).astype(int), 0, M.shape[1] - 1)
        iy = np.clip(((90 - lat) / 180 * M.shape[0]).astype(int), 0, M.shape[0] - 1)
        quiet = np.median(a[inside])
        obs = gaussian_filter(1 - (I0 + (1 - I0) * a / quiet), 1.5); mod = gaussian_filter(1 - M[iy, ix], 1.5)
        c = np.corrcoef(obs[inside], mod[inside])[0, 1]
        mid = inside & (np.abs(X) < 0.07)  # 그날 영상만 지도를 채운 띠(정면 자오선 ±0.3일치 = 약 ±4°) — 기하(경도·위도 배치)만 본다
        cm = np.corrcoef(obs[mid], mod[mid])[0, 1]
        res.append((c, cm)); print(os.path.basename(f)[:8], '원판 %.3f 가운데 띠 %.3f' % (c, cm))
    r = np.array(res)
    print('원판 평균 %.3f · 가운데 띠 평균 %.3f 최소 %.3f' % (r[:, 0].mean(), r[:, 1].mean(), r[:, 1].min()))

if __name__ == '__main__':
    main('flip' in sys.argv)
