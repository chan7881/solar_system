"""포보스·데이모스 모양 모형 → textures/<이름>_shape.bin

원본(git 밖, 원본/phobos·원본/deimos — 주소는 textures/출처.md):
  포보스 PHOBOS_K275_DLR_V02.OBJ — Willner et al. 2014(DLR, Mars Express HRSC), 꼭짓점 13.7만 · 면 27.5만
  데이모스 DEIMOS_K005_THO_V02.OBJ — Thomas(Viking), 꼭짓점 2522 · 면 5040
  둘 다 IAU_PHOBOS / IAU_DEIMOS 천체 고정 좌표(km, x = 경도 0°, z = 북극).

둘 다 가운데에서 정이십면체를 나눈 방향(꼭짓점 10242개)으로 빛살을 쏴 원본 면과 만나는 점을 꼭짓점으로 삼는다
(가운데에서 보면 겉면이 한 겹 — 별 모양 — 인지 검사한다). 포보스는 너무 촘촘해서 줄이는 것이고, 데이모스는 원본이
위도·경도 격자라 극에 가는 삼각형이 몰려 음영에 별 모양 자국이 생겨서(2026-11-21 화면 확인) 고르게 다시 뽑는 것이다.

파일 형식(little-endian): uint32 꼭짓점 수 n, uint32 면 수 m, float32 x,y,z × n(km, 천체 고정 좌표), uint32 i,j,k × m(바깥에서 보아 반시계)
"""
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parent.parent


def read_obj(path):
    v, f = [], []
    for line in open(path):
        p = line.split()
        if not p:
            continue
        if p[0] == 'v':
            v.append([float(x) for x in p[1:4]])
        elif p[0] == 'f':
            if len(p) != 4:
                sys.exit(f'{path}: 삼각형이 아닌 면(꼭짓점 {len(p) - 1}개) — 나눠 읽는 기능이 없다')
            f.append([int(x.split('/')[0]) - 1 for x in p[1:4]])
    return np.array(v), np.array(f)


def icosphere_dirs(level):
    s = trimesh.creation.icosphere(subdivisions=level, radius=1.0)
    return s.vertices.copy(), s.faces.copy()


def resample(mesh, level):
    """가운데에서 쏜 빛살과 면이 만나는 거리 — 면의 방향(가운데에서 본 단위 벡터)을 kd-tree로 골라 Möller–Trumbore로 잰다"""
    from scipy.spatial import cKDTree
    dirs, faces = icosphere_dirs(level)
    tri = mesh.vertices[mesh.faces]                      # (m, 3, 3)
    cen = tri.mean(1)
    cen /= np.linalg.norm(cen, axis=1)[:, None]
    vdir = tri / np.linalg.norm(tri, axis=2)[:, :, None]
    reach = np.linalg.norm(vdir - cen[:, None, :], axis=2).max() * 1.5  # 면 가운데 방향에서 꼭짓점 방향까지의 최대 거리(현) + 여유
    tree = cKDTree(cen)
    r = np.zeros(len(dirs))
    hits = np.zeros(len(dirs), int)
    e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    for i, d in enumerate(dirs):
        idx = np.array(tree.query_ball_point(d, reach), dtype=int)
        a, b, o = e1[idx], e2[idx], tri[idx, 0]
        p = np.cross(d, b)
        det = (a * p).sum(1)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
        s = -o
        u = (s * p).sum(1) * inv
        q = np.cross(s, a)
        v = (q @ d) * inv
        t = (b * q).sum(1) * inv
        hit = ok & (u >= -1e-9) & (v >= -1e-9) & (u + v <= 1 + 1e-9) & (t > 0)
        th = t[hit]
        if len(idx) and len(th):
            # 꼭짓점·모서리를 지나면 이웃 면 여럿이 같은 거리로 잡힌다(반올림으로 1m 차이 — 데이모스 남극) — 10m 안의 것은 한 번으로 센다
            th = np.sort(th)
            r[i], hits[i] = th.max(), 1 + int((np.diff(th) > 0.01).sum())
    if (hits == 0).any():
        sys.exit(f'빛살 {int((hits == 0).sum())}개가 겉면을 못 만남')
    multi = int((hits > 1).sum())
    if multi:
        sys.exit(f'빛살 {multi}개가 겉면을 두 번 이상 지남 — 가운데에서 본 별 모양이 아니다')
    return dirs * r[:, None], faces


def write_bin(path, v, f):
    with open(path, 'wb') as out:
        out.write(struct.pack('<II', len(v), len(f)))
        out.write(v.astype('<f4').tobytes())
        out.write(f.astype('<u4').tobytes())


def report(name, mesh):
    r = np.linalg.norm(mesh.vertices, axis=1)
    ext = mesh.vertices.max(0) - mesh.vertices.min(0)
    print(f'{name}: 꼭짓점 {len(mesh.vertices)} · 면 {len(mesh.faces)} · 닫힘 {mesh.is_watertight} · 부피 {mesh.volume:.1f}km³'
          f' · 부피 같은 구 반지름 {(3 * mesh.volume / 4 / np.pi) ** (1 / 3):.3f}km · 반지름 {r.min():.2f}~{r.max():.2f}'
          f' · 폭 x·y·z {ext[0]:.2f}·{ext[1]:.2f}·{ext[2]:.2f} · 질량 중심 {np.round(mesh.center_mass, 3)}')


def build(name, obj):
    v0, f0 = read_obj(ROOT / '원본' / name / obj)
    full = trimesh.Trimesh(v0, f0, process=False)
    report(f'{name} 원본', full)
    v, f = resample(full, 5)
    m = trimesh.Trimesh(v, f, process=False)
    report(f'{name} 다시 뽑음', m)
    print(f'  부피 차 {100 * (m.volume / full.volume - 1):+.2f}% · 가장 먼 점 {np.linalg.norm(v, axis=1).max():.3f}km(src/shapes.js SHAPE_REACH와 맞출 것)')
    if not m.is_watertight or m.volume <= 0:  # 쓰기 전에 막는다 — 깨진 파일이 남지 않게
        sys.exit(f'{name}: 닫히지 않았거나 면 방향이 안쪽(부피 {m.volume:.1f})')
    return v, f


def main():
    out = {n: build(n, o) for n, o in [('phobos', 'PHOBOS_K275_DLR_V02.OBJ'), ('deimos', 'DEIMOS_K005_THO_V02.OBJ')]}
    for n, (v, f) in out.items():
        write_bin(ROOT / 'textures' / f'{n}_shape.bin', v, f)


if __name__ == '__main__':
    main()
