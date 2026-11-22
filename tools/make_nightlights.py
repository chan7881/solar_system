"""지구 밤 불빛 질감 — NASA Black Marble 2016(VIIRS) 색 합성 지도에서 불빛 세기만 뽑아 2048×1024 흑백 JPG로.

원본: textures/출처.md 의 주소에서 받은 BlackMarble_2016_3km.jpg(13500×6750)를 원본/nightlights/ 에 둔다(git 밖).
배치: 단순 원통 도법, 왼쪽 끝 = 경도 −180°, 가운데 = 0° — 낮 지도(earth_2k.jpg)와 나일강·인도 해안선을 겹쳐 확인했다.
색 합성 지도는 불빛(노란빛) 아래에 땅을 짙은 남색으로 깔아 두었다(사하라 약 (38,35,63), 바다 약 (5,5,15)).
남색 바탕은 R ≈ 0.5·B 근처라서 R − 0.5·B 에서 바탕 남은 값(약 8)을 빼면 불빛만 남는다. 색은 셰이더에서 입힌다.
밝기 곡선은 화면 승인(2026-11-22)에 맞춘 것이다 — 노란 도심은 255로 포화되고(도심 안 밝기 차이는 버림), 화면은 이 값을
sRGB로 읽어(main.js loadTexture) 희미한 교외 불빛을 줄인다. 둘 중 하나를 바꾸면 모습이 달라지니 화면을 다시 확인한다.
쓰는 법: python tools/make_nightlights.py [원본 경로]
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / '원본' / 'nightlights' / 'BlackMarble_2016_3km.jpg'
OUT = ROOT / 'textures' / 'earth_night_2k.jpg'
SIZE = (2048, 1024)
FLOOR = 8.0  # 남색 바탕이 R − 0.5·B 에 남기는 값(사하라 표본 7)


def lights(rgb: np.ndarray) -> np.ndarray:
    r, b = rgb[..., 0].astype(np.float32), rgb[..., 2].astype(np.float32)
    return np.clip((r - 0.5 * b - FLOOR) * (255 / (255 - 127.5 - FLOOR)), 0, 255)


if __name__ == '__main__':
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SRC
    im = Image.open(src).convert('RGB')
    if abs(im.width / im.height - 2) > 0.01:
        raise SystemExit(f'2:1 전구 지도가 아님 {im.size}')
    # 줄이기 전에 뽑는다(줄인 뒤 뽑으면 작은 불빛이 바탕과 섞여 사라진다)
    L = Image.fromarray(lights(np.asarray(im)).astype(np.uint8), 'L')
    L = L.reduce(max(1, im.width // SIZE[0] // 2)).resize(SIZE, Image.LANCZOS)
    L.save(OUT, quality=90, optimize=True)
    a = np.asarray(L)
    print(f'{OUT.name}: {src.name} {im.size} -> {L.size}, {OUT.stat().st_size // 1024}KB, '
          f'0이 아닌 칸 {np.mean(a > 0) * 100:.1f}% · 최댓값 {a.max()}')
