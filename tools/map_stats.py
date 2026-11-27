"""표면 지도 밝기 통계 → src/map_stats.js (손으로 고치지 않는다 — 지도를 다시 뽑으면 이것도 다시 돌린다).

천체마다 화면 밝기를 실제 반사율 비로 맞추는 데(src/albedo.js) 쓴다.
  mean: 선형 밝기(Rec.709 가중합)의 넓이 평균(위도 cos 가중) — 지도 전체의 평균 반사율에 해당
  peak: 세 채널 중 가장 큰 값의 넓이 99.5 백분위 — 밝기를 올릴 때 이 값이 1을 넘지 않게(하얗게 날아가지 않게)
  iapetusBright: 이아페투스 밝은 쪽(남북위 20° 안·동경 60~120°, make_iapetus.py와 같은 자리) 평균 — 반사율 0.5에 맞출 자리
쓰는 법: python tools/map_stats.py
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
KEYS = ['mercury', 'earth', 'mars', 'jupiter', 'saturn', 'moon', 'pluto', 'charon', 'io', 'europa', 'ganymede', 'callisto',
        'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'iapetus', 'neptune', 'ceres', 'triton', 'miranda', 'ariel', 'umbriel',
        'titania', 'oberon']  # main.js TEXTURED와 같은 목록(tests/albedo.test.mjs가 대조)


def linear(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def stats(key):
    a = linear(np.asarray(Image.open(ROOT / 'textures' / f'{key}_2k.jpg').convert('RGB'), float) / 255)
    h, w = a.shape[:2]
    lat = (0.5 - (np.arange(h) + 0.5) / h) * np.pi
    wt = np.repeat(np.cos(lat)[:, None], w, 1)
    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    mean = float((lum * wt).sum() / wt.sum())
    mx = a.max(2).ravel()
    o = np.argsort(mx)
    c = np.cumsum(wt.ravel()[o])
    peak = float(mx[o][np.searchsorted(c, 0.995 * c[-1])])
    out = {'mean': round(mean, 5), 'peak': round(peak, 5)}
    if key == 'iapetus':
        lon = (np.arange(w) + 0.5) / w * 360 - 180  # 가운데 0°·동경+
        m = (np.abs(np.degrees(lat))[:, None] <= 20) & ((lon >= 60) & (lon <= 120))[None, :]
        out['bright'] = round(float((lum * wt)[m].sum() / wt[m].sum()), 5)
    return out


def main():
    s = {k: stats(k) for k in KEYS}
    body = ('// tools/map_stats.py가 만든다 — 손으로 고치지 않는다(지도를 다시 뽑으면 다시 돌린다)\n'
            '// mean: 선형 밝기 넓이 평균 · peak: 가장 밝은 채널의 넓이 99.5 백분위 · bright: 이아페투스 밝은 쪽 평균\n'
            f'export const MAP_STATS = {json.dumps(s, ensure_ascii=False)};\n')
    (ROOT / 'src' / 'map_stats.js').write_text(body, encoding='utf-8')
    for k, v in s.items():
        print(k, v)


if __name__ == '__main__':
    main()
