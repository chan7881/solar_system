"""혜성 핵 모양 → textures/<이름>_shape.bin (형식은 tools/make_shapes.py와 같다)

원본(git 밖, 원본/67p·원본/halley — 주소는 textures/출처.md):
  67P  cg_dlr_spg_shap4s_050k.wrl — DLR SPG SHAP4S(Rosetta OSIRIS 사진으로 만든 모양), 꼭짓점 2.5만 · 면 5만, CHEOPS 좌표(km, 질량 중심 원점)
       두 덩이 사이 목이 움푹해 가운데에서 본 별 모양이 아니다 → 다시 뽑지 않고 그대로 쓴다.
  핼리 1682q1halley.tab — Stooke(Giotto·Vega 사진) 5° 격자의 반지름(km). 행: 경도 360→0(5° 간격) × 위도 −90→90.
       Stooke 모형은 원점이 모양 가운데가 아닐 수 있다(자료 설명) → 부피 중심으로 옮긴다.
  엔케·스위프트-터틀·헤일-밥 — 모양 모형이 없다. 3축 타원체(축 비율은 추정)에 낮은 차수 굴곡을 더한 근사 모양.
       씨앗을 고정해 늘 같은 모양이 나오고, 부피 같은 구 반지름을 src/smallbodies.js COMETS radius에 맞춘다.
"""
import re
import sys
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from make_shapes import icosphere_dirs, write_bin, report  # noqa: E402

# 근사 모양: (부피 같은 구 반지름 km, 축 비율 a:b:c, 씨앗)
# 엔케: Fernández et al. 2000(Icarus 147, 145) 유효 반지름 2.4km · 축 비율 1.44 이상
# 스위프트-터틀: 유효 반지름 약 13km, 모양 자료 없음 — 축 비율은 다른 혜성 핵의 흔한 값(약 1.3)
# 헤일-밥: 유효 반지름 약 30km(추정 20~40km), 모양 자료 없음
APPROX = {
    'encke': (2.4, (1.45, 1.0, 0.9), 2),
    'swifttuttle': (13.0, (1.3, 1.0, 0.85), 3),
    'halebopp': (30.0, (1.2, 1.0, 0.9), 5),
}


def read_wrl(path):
    txt = open(path).read()
    pt = re.search(r'point\s*\[(.*?)\]', txt, re.S).group(1)
    ix = re.search(r'coordIndex\s*\[(.*?)\]', txt, re.S).group(1)
    v = np.array(pt.replace(',', ' ').split(), float).reshape(-1, 3)
    f = np.array(ix.replace(',', ' ').split(), int).reshape(-1, 4)
    if (f[:, 3] != -1).any():
        sys.exit('삼각형이 아닌 면이 있다')
    return v, f[:, :3]


def outward(m):
    if m.volume < 0:
        m.invert()
    return m


def halley():
    rows = np.loadtxt(ROOT / '원본' / 'halley' / '1682q1halley.tab')
    if len(rows) != 73 * 37:
        sys.exit(f'핼리 격자 행 수 {len(rows)}')
    lon = rows[:, 0].reshape(73, 37)[:, 0]          # 360 … 0
    lat = rows[:, 1].reshape(73, 37)[0]             # −90 … 90
    R = rows[:, 2].reshape(73, 37)
    if not (np.allclose(lon, 360 - 5 * np.arange(73)) and np.allclose(lat, -90 + 5 * np.arange(37))):
        sys.exit('핼리 격자 순서가 예상과 다르다')
    if not np.allclose(R[0], R[-1]):
        sys.exit('핼리 경도 0°와 360° 반지름이 다르다')
    if not (np.ptp(R[:, 0]) < 1e-4 and np.ptp(R[:, -1]) < 1e-4):
        sys.exit('핼리 극의 반지름이 경도마다 다르다')
    d, faces = icosphere_dirs(5)
    la = np.degrees(np.arcsin(np.clip(d[:, 2], -1, 1)))
    lo = np.degrees(np.arctan2(d[:, 1], d[:, 0])) % 360  # 자세 모형이 없어 경도 방향은 화면에 영향이 없다
    Ra = R[::-1]                                      # 경도 0→360 순서로
    fi, fj = lo / 5, (la + 90) / 5
    i0, j0 = np.floor(fi).astype(int).clip(0, 71), np.floor(fj).astype(int).clip(0, 35)
    ti, tj = fi - i0, fj - j0
    r = (Ra[i0, j0] * (1 - ti) * (1 - tj) + Ra[i0 + 1, j0] * ti * (1 - tj)
         + Ra[i0, j0 + 1] * (1 - ti) * tj + Ra[i0 + 1, j0 + 1] * ti * tj)
    m = outward(trimesh.Trimesh(d * r[:, None], faces, process=False))
    m.vertices -= m.center_mass  # 부피 중심으로
    return m


def approx(radius, axes, seed):
    d, faces = icosphere_dirs(5)
    rng = np.random.default_rng(seed)
    a = np.array(axes, float)
    r = 1 / np.sqrt(((d / a) ** 2).sum(1))           # 타원체
    # 낮은 차수 굴곡: 무작위 방향 둘레의 넓은 혹·움푹 패임(폭 25~60°, 크기 ±6~12%)
    for _ in range(14):
        c = rng.normal(size=3); c /= np.linalg.norm(c)
        w = np.radians(rng.uniform(25, 60)); amp = rng.uniform(0.06, 0.12) * rng.choice([-1, 1])
        ang = np.arccos(np.clip(d @ c, -1, 1))
        r *= 1 + amp * np.exp(-(ang / w) ** 2)
    m = outward(trimesh.Trimesh(d * r[:, None], faces, process=False))
    m.vertices -= m.center_mass
    m.vertices *= radius / (3 * m.volume / 4 / np.pi) ** (1 / 3)
    return m


def main():
    out = {}
    v, f = read_wrl(ROOT / '원본' / '67p' / 'cg_dlr_spg_shap4s_050k.wrl')
    out['churyumov'] = outward(trimesh.Trimesh(v, f, process=False))
    out['halley'] = halley()
    for k, (rad, ax, seed) in APPROX.items():
        out[k] = approx(rad, ax, seed)
    for k, m in out.items():
        report(k, m)
        r = np.linalg.norm(m.vertices, axis=1).max()
        print(f'  부피 같은 구 반지름 {(3 * m.volume / 4 / np.pi) ** (1 / 3):.3f}km · 가장 먼 점 {r:.3f}km(src/shapes.js SHAPE_REACH와 맞출 것)')
        if not m.is_watertight or m.volume <= 0:
            sys.exit(f'{k}: 닫히지 않았거나 면 방향이 안쪽')
    for k, m in out.items():
        write_bin(ROOT / 'textures' / f'{k}_shape.bin', m.vertices, m.faces)


if __name__ == '__main__':
    main()
