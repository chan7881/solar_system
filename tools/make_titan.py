"""타이탄 지표 질감 — USGS Titan Cassini ISS 전구 모자이크(PIA19658, 4km)를 2048×1024 JPG로.

원본은 git에 넣지 않는다(8MB). 주소는 textures/출처.md.
쓰는 법: python tools/make_titan.py <원본 TIF>
원본은 단순 원통 도법·행성 중심 위도. 라벨은 서경+·가운데 180°라고 적었지만 화소 배치는
왼쪽 끝 = 경도 0°, 동쪽이 오른쪽이다(Xanadu 서경 100° 밝음 · Shangri-La 서경 165°·Belet 서경 255° 어두움으로 확인).
→ 반 바퀴 돌려 가운데 = 경도 0°로 맞춘다(이 앱의 지도 규약).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'textures' / 'titan_surface_2k.jpg'
SIZE = (2048, 1024)


def main(src: Path):
    im = Image.open(src)
    if im.mode != 'L':
        raise SystemExit(f'8비트 흑백이 아님({im.mode})')
    a = np.asarray(im)
    print(f'{src.name} {im.size} 빈 곳 {(a == 0).mean():.3%}')
    a = np.roll(a, -a.shape[1] // 2, axis=1)  # 왼쪽 끝 0° → 가운데 0°
    out = Image.fromarray(a).resize(SIZE, Image.BOX)
    out.convert('RGB').save(OUT, quality=88, optimize=True, progressive=True)
    print(f'{OUT.name}: {OUT.stat().st_size // 1024}KB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
