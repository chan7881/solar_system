"""갈릴레이 위성 지도 — USGS Galileo SSI·Voyager 전구 모자이크를 2048×1024 JPG로(가운데 = 경도 0°, 동쪽이 오른쪽).

원본은 git에 넣지 않는다(수백 MB, 원본/galilean/). 주소는 textures/출처.md.
관측 없는 곳(검정, 주로 극 둘레)은 평균에서 빼고 줄인 뒤 주변 값을 퍼뜨려 메운다(make_venus.py와 같은 방식).
쓰는 법: python tools/make_galilean.py <원본 폴더> [천체 ...]
라벨의 경도 규약은 지도마다 달라 믿지 않는다 — 넷 다 단순 원통 도법·동쪽이 오른쪽이고, 왼쪽 끝 경도(LEFT)는 지형으로 확인했다(2026-11-22):
  이오     왼쪽 끝 동경 −180° — Pele 고리 남위 18.7°·동경 104.7°, Loki 북위 12.6°·동경 51.2°
  유로파   왼쪽 끝 동경 0°   — Pwyll 빛줄기 남위 25.2°·동경 88.6°(어두운 뒤쪽 반구가 동경 90° 둘레)
  가니메데 왼쪽 끝 동경 0°   — Tros 북위 11°·동경 333°, Osiris 남위 38°·동경 194°, Galileo Regio 동경 190~250°
  칼리스토 왼쪽 끝 동경 0°   — Valhalla 북위 14.7°·동경 304°, Burr 북위 42.7°·동경 225°
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

Image.MAX_IMAGE_PIXELS = None
OUT = Path(__file__).resolve().parent.parent / 'textures'
SIZE = (2048, 1024)

SOURCES = {  # 천체: (파일, 원본 왼쪽 끝의 동경)
    'io': ('Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif', -180),
    'europa': ('Europa_Voyager_GalileoSSI_global_mosaic_500m.tif', 0),
    'ganymede': ('Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif', 0),
    'callisto': ('Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif', 0),
}


def load(src: Path) -> tuple[np.ndarray, float]:
    """줄인 지도(float, H×W×3)와 관측 없는 칸 비율. 관측 없는 곳(검정 0)은 평균에서 빼고 줄인 뒤 주변 값을 퍼뜨려 메운다."""
    im = Image.open(src)
    if im.mode not in ('RGB', 'L'):
        raise SystemExit(f'{src.name}: 8비트 RGB/L이 아님({im.mode})')
    if abs(im.width / im.height - 2) > 0.01:
        raise SystemExit(f'{src.name}: 2:1 전구 지도가 아님 {im.size}')
    bands = im.split()
    valid = Image.fromarray(((np.max([np.asarray(b) for b in bands], axis=0) > 0) * 255).astype(np.uint8))
    f = max(1, min(im.width // SIZE[0], im.height // SIZE[1]) // 2)
    # (값의 상자 평균) / (유효 비율의 상자 평균) — 검정을 섞지 않고 줄인다
    shrink = lambda x: np.asarray((x.reduce(f) if f > 1 else x).resize(SIZE, Image.BOX), dtype=np.float32)
    w = shrink(valid) / 255
    a = np.stack([shrink(b) for b in bands], -1) / np.maximum(w, 1e-6)[..., None]
    have = (w > 0.5).astype(np.float32)
    a[have == 0] = 0
    filled, done = a.copy(), have.copy()
    for sigma in (1, 2, 4, 8, 16, 32, 64, 128):  # 반경을 키워 가며 정규화 합성곱(가로는 둥글게, 세로는 가장자리 복제)
        if done.all():
            break
        den = gaussian_filter(have, sigma, mode=['nearest', 'wrap'])
        new = (done == 0) & (den > 1e-3)
        for c in range(a.shape[2]):
            num = gaussian_filter(a[..., c] * have, sigma, mode=['nearest', 'wrap'])
            filled[..., c][new] = num[new] / den[new]
        done[new] = 1
    if not done.all():
        raise SystemExit(f'{src.name}: 다 못 메움')
    if filled.shape[2] == 1:
        filled = np.repeat(filled, 3, axis=2)
    return filled, 1 - have.mean()


def to_app(a: np.ndarray, left_lon_e: float) -> np.ndarray:
    """왼쪽 끝 경도를 −180°로 옮긴다(동쪽이 오른쪽인 원본만)."""
    return np.roll(a, round(((left_lon_e + 180) % 360) / 360 * a.shape[1]), axis=1)


if __name__ == '__main__':
    if len(sys.argv) < 2 or any(k not in SOURCES for k in sys.argv[2:]):
        raise SystemExit(__doc__ + '\n천체: ' + ' '.join(SOURCES))
    root = Path(sys.argv[1])
    for key in sys.argv[2:] or list(SOURCES):
        name, left = SOURCES[key]
        a, empty = load(root / name)
        print(f'{key}: 관측 없어 메운 칸 {empty:.2%}')
        dst = OUT / f'{key}_2k.jpg'
        Image.fromarray(to_app(np.clip(a + 0.5, 0, 255).astype(np.uint8), left)).save(dst, quality=88, optimize=True, progressive=True)
        print(f'{dst.name}: {name} -> {SIZE}, {dst.stat().st_size // 1024}KB')
