"""금성 지표 질감 — USGS Magellan C3-MDIR 전구 레이더 모자이크(2025m)를 2048×1024 JPG로.

원본은 git에 넣지 않는다(176MB). 주소는 textures/출처.md.
쓰는 법: python tools/make_venus.py <원본 TIF>
원본은 단순 원통 도법, 왼쪽 끝 = 경도 −180°, 가운데 0°, 동쪽이 오른쪽(Maxwell 산 북위 65°·동경 3°로 확인).
값 0은 관측이 없는 곳(약 8%: 궤도 사이 띠·남극 둘레) — 가장자리째 줄일 때 평균에서 빼고,
줄인 뒤에도 비는 칸은 주변 값을 거리 가중으로 퍼뜨려 메운다(경도는 둥글게 이어서).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_erosion

Image.MAX_IMAGE_PIXELS = None
OUT = Path(__file__).resolve().parent.parent / 'textures' / 'venus_surface_2k.jpg'
SIZE = (2048, 1024)
EDGE = 4  # 깎아 낼 가장자리 화소 수


def main(src: Path):
    im = Image.open(src)
    if im.mode != 'L':
        raise SystemExit(f'8비트 흑백이 아님({im.mode})')
    a = np.asarray(im, dtype=np.float32)
    print(f'{src.name} {im.size} 빈 곳 {(a == 0).mean():.1%}')
    # 빈 곳 가장자리 몇 화소는 어둡게 깎여 있다(평균 106 대 전체 129) — 깎아 내고 빈 곳으로 친다
    valid = binary_erosion(a > 0, iterations=EDGE).astype(np.float32)
    # 평균에서 빈 곳을 빼고 줄인다: (값의 상자 평균) / (유효 비율의 상자 평균)
    box = lambda x: np.asarray(Image.fromarray(x, 'F').resize(SIZE, Image.BOX))
    s, w = box(a * valid), box(valid)
    out = np.where(w > 0.5, s / np.maximum(w, 1e-6), 0)
    have = (w > 0.5).astype(np.float32)
    print(f'줄인 뒤 빈 칸 {1 - have.mean():.2%}')
    # 메우기: 반경을 키워 가며 정규화 합성곱(가로는 둥글게, 세로는 가장자리 복제)
    filled, done = out.copy(), have.copy()
    for sigma in (1, 2, 4, 8, 16, 32, 64):
        num = gaussian_filter(out * have, sigma, mode=['nearest', 'wrap'])
        den = gaussian_filter(have, sigma, mode=['nearest', 'wrap'])
        new = (done == 0) & (den > 1e-3)
        filled[new] = num[new] / den[new]
        done[new] = 1
        if done.all():
            break
    if not done.all():
        raise SystemExit('다 못 메움')
    Image.fromarray(np.clip(filled + 0.5, 0, 255).astype(np.uint8), 'L').convert('RGB').save(
        OUT, quality=88, optimize=True, progressive=True)
    print(f'{OUT.name}: {OUT.stat().st_size // 1024}KB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
