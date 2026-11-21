"""행성 질감 만들기 — 1차 출처(NASA·USGS 퍼블릭 도메인) 원본을 2048×1024 JPG로 줄인다.

원본은 git에 넣지 않는다(수백 MB). 받는 주소는 textures/출처.md.
쓰는 법: python tools/make_textures.py <원본 폴더> [천체 ...]
모든 원본은 단순 원통 도법, 왼쪽 끝 = 경도 −180°(동경+), 가운데 = 0° 로 확인했다
→ SphereGeometry의 u(=동경/360 + 0.5)와 그대로 맞는다. 다른 규약(0~360°, 가운데 180° 등)의 원본을 넣으려면
  이 스크립트에 가로 이동·뒤집기를 먼저 추가해야 한다(지금은 없다).
"""
import sys
from pathlib import Path
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
OUT = Path(__file__).resolve().parent.parent / 'textures'
SIZE = (2048, 1024)

SOURCES = {
    'mercury': 'mercury665.tif',  # USGS MESSENGER MDIS MD3 Color 665m
    'earth': 'earth5400.jpg',     # NASA Blue Marble NG 2004-04 topo·bathy
    'mars': 'mars925.tif',        # USGS Viking Global Color Mosaic 925m
    'jupiter': 'jupiter.tif',     # NASA/JPL/SSI PIA07782
    'moon': 'moon/lroc_color_poles_2k.tif',  # NASA SVS CGI Moon Kit (LROC WAC 색 + 극 지역 LOLA 보완)
}


def shrink(src: Path, dst: Path):
    im = Image.open(src)
    size0 = im.size
    if im.mode not in ('RGB', 'L'):  # 16비트·실수 TIFF를 convert하면 값이 잘려 하얗거나 까맣게 된다
        raise SystemExit(f'{src.name}: 8비트 RGB/L이 아님({im.mode}) — 값 범위를 먼저 맞춰야 한다')
    if abs(im.width / im.height - 2) > 0.01:
        raise SystemExit(f'{src.name}: 2:1 전구 지도가 아님 {im.size}')
    f = max(1, min(im.width // SIZE[0], im.height // SIZE[1]) // 2)  # 큰 TIFF는 먼저 정수배로 줄인다
    if f > 1:
        im = im.reduce(f)
    im = im.convert('RGB')
    im = im.resize(SIZE, Image.LANCZOS)
    im.save(dst, quality=88, optimize=True, progressive=True)
    print(f'{dst.name}: {src.name} {size0} -> {im.size}, {dst.stat().st_size // 1024}KB')


if __name__ == '__main__':
    if len(sys.argv) < 2 or any(k not in SOURCES for k in sys.argv[2:]):
        raise SystemExit(__doc__ + '\n천체: ' + ' '.join(SOURCES))
    root = Path(sys.argv[1])
    OUT.mkdir(exist_ok=True)
    for key in sys.argv[2:] or list(SOURCES):
        shrink(root / SOURCES[key], OUT / f'{key}_2k.jpg')
