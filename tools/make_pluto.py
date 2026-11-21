"""명왕성·카론 표면 지도 — New Horizons 전구 지도를 2048×1024 JPG로.

원본은 git에 넣지 않는다(명왕성 4MB·카론 77MB). 주소는 textures/출처.md.
쓰는 법: python tools/make_pluto.py <명왕성 색 지도 JPG> <카론 USGS TIF>

명왕성: NASA 「Pluto Global Color Map」(Ralph/MVIC 색). 화소 배치가 USGS 300m 모자이크와 같다(위상 상관 0화소).
  USGS 모자이크의 좌표 태그는 왼쪽 끝 −180°·가운데 0°지만 실제 배치는 왼쪽 끝 0°·가운데 180°·동쪽이 오른쪽이다
  — Burney 분지(북위 45.68°·동경 133.79°, IAU)가 x = 133.79/360 자리에 있고, 가장 자세한 곳(근접 비행 반구)이
  가운데에 온다(Horizons: 뉴호라이즌스 직하점 동경 159~176°). → 반 바퀴 돌려 가운데 = 경도 0°.
카론: USGS 300m 모자이크(흑백). 좌표 태그대로 왼쪽 끝 −180°·가운데 0°·동쪽이 오른쪽 — Kubrick Mons(북위 3.6°·동경 30.8°)
  자리에 해자로 둘린 산이 있고, 근접 비행 반구가 가운데 조금 왼쪽(직하점 동경 342~356°)이다. 돌리지 않는다.

두 지도 모두 남쪽 약 1/3은 2015년 근접 비행 때 극야라 찍히지 않았다(검정). 그 지도의 평균 색으로 메우고 경계만
부드럽게 잇는다 — 그 자리에는 실제 지형이 없다.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, label

Image.MAX_IMAGE_PIXELS = None
TEX = Path(__file__).resolve().parent.parent / 'textures'
SIZE = (2048, 1024)
EMPTY = 10        # 이보다 어두운 화소(밝기 0~255)는 관측 없음
MIN_AREA = 0.01   # 이보다 작은 덩어리(전체의 1%)는 관측 없음 판정에서 뺀다
FEATHER_DEG = 1.5 # 관측 경계를 이만큼(°) 부드럽게


def fill(a):
    """a: (H, W, C) float. 관측 없는 곳을 메운 사본과 메운 비율."""
    H, W = a.shape[:2]
    dark = a.mean(2) < EMPTY
    # 관측 없음 = 어두운 곳 중 큰 덩어리(남쪽 극야 지역)만 — 관측된 어두운 무늬는 남긴다
    lab, n = label(dark)
    size = np.bincount(lab.ravel())
    empty = np.isin(lab, [k for k in range(1, n + 1) if size[k] > MIN_AREA * H * W])
    # 그 안에 떨어져 있는 작은 「관측」 조각(원본 가장자리 찌꺼기)도 관측 없음으로
    lab, n = label(~empty)
    size = np.bincount(lab.ravel())
    empty |= np.isin(lab, [k for k in range(1, n + 1) if size[k] < MIN_AREA * H * W])
    mean = a[~empty].mean(0)
    # 경계만 부드럽게 — 관측 쪽은 그대로 두고, 빈 쪽만 가까운 관측 색(관측 화소만 흐린 값)에서 평균 색으로 옮겨 간다.
    # 빈 화소의 검정은 섞지 않는다(섞으면 경계를 따라 어두운 띠가 생긴다).
    obs = (~empty).astype(float)
    sig = H / 180 * FEATHER_DEG
    w = gaussian_filter(obs, sig, mode=('nearest', 'wrap'))
    near = np.stack([gaussian_filter(a[..., c] * obs, sig, mode=('nearest', 'wrap')) for c in range(a.shape[2])], -1)
    near = near / np.maximum(w, 1e-9)[..., None]
    w = w[..., None]
    return np.where(empty[..., None], near * w + mean * (1 - w), a), empty.mean()


def save(a, name):
    out = Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8)).resize(SIZE, Image.BOX)
    path = TEX / name
    out.convert('RGB').save(path, quality=88, optimize=True, progressive=True)
    print(f'{name}: {path.stat().st_size // 1024}KB')


def main(pluto_src: Path, charon_src: Path):
    p = Image.open(pluto_src).convert('RGB')
    a = np.asarray(p.resize((4096, 2048), Image.BOX), float)
    a, frac = fill(a)
    a = np.roll(a, -a.shape[1] // 2, axis=1)  # 왼쪽 끝 0° → 가운데 0°
    print(f'명왕성 {p.size} 메운 곳 {frac:.1%}')
    save(a, 'pluto_2k.jpg')

    c = Image.open(charon_src)
    if c.mode != 'L':
        raise SystemExit(f'카론: 8비트 흑백이 아님({c.mode})')
    b = np.asarray(c.resize((4096, 2048), Image.BOX), float)[..., None]
    b, frac = fill(b)
    print(f'카론 {c.size} 메운 곳 {frac:.1%}')
    save(b[..., 0], 'charon_2k.jpg')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
