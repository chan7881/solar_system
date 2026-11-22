"""토성 위성 6개 지도 — USGS Cassini(·Voyager) 전구 모자이크를 2048×1024 JPG로(가운데 = 경도 0°, 동쪽이 오른쪽).

원본은 git에 넣지 않는다(수백 MB, 원본/saturnmoons/). 주소는 textures/출처.md. 줄이기·빈 곳 메우기는 make_galilean.py와 같다.
쓰는 법: python tools/make_saturnmoons.py <원본 폴더> [check] [천체 ...]
라벨의 경도 규약은 믿지 않는다 — 여섯 다 단순 원통 도법·동쪽이 오른쪽이고, 왼쪽 끝 경도(LEFT)는
USGS 지명 자료(분화구 중심·지름, 원본/saturnmoons/names/)를 겹쳐 지형으로 확인했다(2026-11-22, check 인자로 확인 그림).
눈으로 가리기 어려운 레아는 분화구 원 안 밝기 기울기의 평균을 경도 1° 이동·좌우 뒤집기마다 재어 최고점을 골랐다
(같은 방법이 엔셀라두스·테티스·디온·이아페투스에서 눈으로 본 배치와 0~2° 안에서 일치. 미마스는 분화구가 빽빽해 점수가 안 갈려 Herschel로만 확인):
  미마스      왼쪽 끝 동경 −180° — Herschel 남위 1.4°·동경 248.2°
  엔셀라두스  왼쪽 끝 동경 0°    — 북쪽 분화구 무리(Duniazad·Shahrazad·Ali Baba), 점수 최고 0°
  테티스      왼쪽 끝 동경 −180° — Odysseus 북위 32.8°·동경 231.1°, Telemus, 점수 최고 180°
  디온        왼쪽 끝 동경 −180° — Evander·Aeneas, 점수 최고 180°
  레아        왼쪽 끝 동경 −180° — 라벨(서경+·가운데 180°)대로 읽은 0°는 틀림. 점수 최고 180°(1.40배, 0°는 낮음)
  이아페투스  왼쪽 끝 동경 −180° — Turgis·Engelier·Gerin 분지, 어두운 Cassini Regio가 동경 270° 둘레, 점수 최고 182°
"""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_galilean import OUT, SIZE, load, to_app  # noqa: E402

SOURCES = {  # 천체: (파일, 원본 왼쪽 끝의 동경, 평균 반지름 km — 확인 그림의 분화구 크기용)
    'mimas': ('Cassini_DLR/MI_170630_DLR_basemap_degrees.tif', -180, 198.2),
    'enceladus': ('Enceladus_Cassini_ISS_Global_Mosaic_100m_HPF.tif', 0, 252.1),
    'tethys': ('Tethys_Cassini_mosaic_global_293m.tif', -180, 531.0),
    'dione': ('Dione_Cassini_Voyager_mosaic_global_154m.tif', -180, 561.4),
    'rhea': ('Rhea_Cassini_Voyager_mosaic_global_417m.tif', -180, 763.5),
    'iapetus': ('Iapetus_Cassini_Voyager_mosaic_global_783m.tif', -180, 734.3),
}


def check(key: str, img: Image.Image, craters: list) -> Image.Image:
    """앱 규약 지도 위에 지명 자료의 분화구(중심·지름)를 원으로 — 지형과 겹치면 경도 배치가 맞다."""
    w, h = img.size
    im = img.convert('RGB')
    d = ImageDraw.Draw(im)
    R = SOURCES[key][2]
    for name, dia, lat, lon_e in sorted(craters, key=lambda c: -c[1])[:25]:
        x = ((lon_e + 180) % 360) / 360 * w
        y = (90 - lat) / 180 * h
        ang = np.degrees(dia / 2 / R)  # 지름의 반을 중심각(°)으로
        rx = ang / 360 * w / max(np.cos(np.radians(lat)), 0.2)
        ry = ang / 180 * h
        d.ellipse([x - rx, y - ry, x + rx, y + ry], outline=(255, 60, 60), width=3)
        d.text((x + 3, y - 6), name, fill=(255, 255, 0))
    return im


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != 'check']
    if not args or any(k not in SOURCES for k in args[1:]):
        raise SystemExit(__doc__ + '\n천체: ' + ' '.join(SOURCES))
    root = Path(args[0])
    for key in args[1:] or list(SOURCES):
        name, left, _ = SOURCES[key]
        a, empty = load(root / name)
        print(f'{key}: 관측 없어 메운 칸 {empty:.2%}')
        img = Image.fromarray(to_app(np.clip(a + 0.5, 0, 255).astype(np.uint8), left))
        if 'check' in sys.argv:
            craters = json.load(open(root / 'names' / 'craters.json', encoding='utf-8'))[key]
            check(key, img, craters).save(root / f'check_{key}.png')
            continue
        dst = OUT / f'{key}_2k.jpg'
        img.save(dst, quality=88, optimize=True, progressive=True)
        print(f'{dst.name}: {name} -> {SIZE}, {dst.stat().st_size // 1024}KB')
