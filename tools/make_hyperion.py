"""히페리온 표면 지도 — Cassini ISS 사진(CISSCAL I/F)을 Thomas 모양 모형에 투영해 textures/hyperion_2k.jpg 를 만든다.

히페리온은 혼돈 자전이라 자세 모형(IAU·SPICE)이 없다. 그래서 사진마다
  1) SPICE로 카메라 방향·탐사선→히페리온·히페리온→해 벡터를 구하고(geom)
  2) 히페리온 자세(몸체→J2000 회전)와 지향 오차(화소 이동)를 모양 모형 그림과 사진의 상관으로 맞춘 뒤(fit)
  3) 지도 칸마다 보이는 사진들의 반사율을 광도 모형으로 나눠 섞는다(map).
좌표: 모양 모형의 천체 고정 좌표(make_shapes.py와 같음 — x = 경도 0°, y = 동경 90°, z = 2005 근접 비행 때 자전축).

받기: python tools/fetch_hyperion.py   (사진·커널 → 원본/hyperion/, git 밖)
실행: python tools/make_hyperion.py geom | fit [사진 id…] | map | check
중간 결과: 원본/hyperion/work/ (geom.json · fit.json · 확인 그림)
"""
import json, sys, time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent / '원본' / 'hyperion'
ISS, SPICE, WORK = ROOT / 'iss', ROOT / 'spice', ROOT / 'work'
CAM = {'ISSNA': ('CASSINI_ISS_NAC', 2003.44), 'ISSWA': ('CASSINI_ISS_WAC', 200.77)}  # 초점 거리 mm(cas_iss_v10.ti), 화소 12µm


# ---------- 사진 ----------
def read_label(path):
    lab = {}
    for line in path.read_text(encoding='latin-1').splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            lab.setdefault(k.strip(), v.strip().strip('"\''))
    return lab


def read_image(stem):
    """CISSCAL 보정본(PC_REAL I/F) → (배열[line, sample], 라벨)"""
    lab = read_label(ISS / f'{stem}_CALIB.LBL')
    raw = (ISS / f'{stem}_CALIB.IMG').read_bytes()
    vic = dict(t.split('=', 1) for t in raw[:1024].decode('latin-1').split() if '=' in t)  # VICAR 머리말
    n_l, n_s, rec, nlb = int(vic['NL']), int(vic['NS']), int(vic['RECSIZE']), int(vic['NLB'])
    if vic['FORMAT'] != "'REAL'" or rec != 4 * n_s or int(vic['NBB']) != 0:
        raise ValueError(f'{stem}: 예상과 다른 VICAR 형식 {vic["FORMAT"]} RECSIZE {rec} NBB {vic["NBB"]}')
    # 영상은 라벨(LBLSIZE) 다음, 이진 머리 줄(NLB줄 — CAS-ISS3은 1줄) 다음부터
    a = np.frombuffer(raw, dtype='<f4', count=n_l * n_s, offset=int(vic['LBLSIZE']) + nlb * rec).reshape(n_l, n_s)
    return a.astype(np.float64), lab


def stems():
    return sorted(p.name[:-10] for p in ISS.glob('*_CALIB.LBL'))


# ---------- 기하(SPICE) ----------
def furnish():
    import os, spiceypy as sp
    here = os.getcwd()
    os.chdir(SPICE)  # CSPICE는 한글 경로를 못 연다 — 커널 폴더로 들어가 이름만으로 읽는다
    try:
        for n in json.loads(Path('kernels.json').read_text()):
            sp.furnsh(n)
    finally:
        os.chdir(here)
    return sp


def geom():
    sp = furnish()
    out = {}
    for s in stems():
        lab = read_label(ISS / f'{s}_CALIB.LBL')
        frame, focal = CAM[lab['INSTRUMENT_ID']]
        n = int(lab['LINES'])
        et = sp.str2et(lab['IMAGE_MID_TIME'])
        try:
            M = np.array(sp.pxform(frame, 'J2000', et))                       # 카메라 → J2000
            r, lt = sp.spkpos('HYPERION', et, 'J2000', 'LT+S', 'CASSINI')     # 탐사선 → 히페리온 중심
            sun, _ = sp.spkpos('SUN', et - lt, 'J2000', 'LT+S', 'HYPERION')   # 히페리온 → 해
        except Exception as e:
            print('  기하 없음', s, str(e).splitlines()[0][:80]); continue
        out[s] = {'et': et, 'time': lab['IMAGE_MID_TIME'], 'cam': lab['INSTRUMENT_ID'], 'n': n,
                  'ifov': 0.012 / focal * 1024 / n,  # rad/화소 — 합산 모드(512·256)는 그만큼 크게
                  'M': M.tolist(), 'r': list(r), 'sun': list(sun)}
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / 'geom.json').write_text(json.dumps(out, indent=0), encoding='utf-8')
    print('기하', len(out), '/', len(stems()))


# ---------- 모양 모형 그리기 ----------
_MESH = None


def mesh():
    """Thomas 판 모형 원본(꼭짓점 1.46만·면 2.93만, km) — 맞추기·투영은 앱의 다시 뽑은 모형이 아니라 이것으로.
    빛살은 embree 장면에 직접 쏜다(trimesh 감싼 함수보다 약 30배 빠르다)"""
    global _MESH
    if _MESH is None:
        import trimesh
        from embreex import rtcore_scene as rtcs
        from embreex.mesh_construction import TriangleMesh
        sys.path.insert(0, str(HERE))
        from make_shapes import read_plt
        v, f = read_plt(ROOT / 'hyperion_30k_plt.tab')
        _MESH = trimesh.Trimesh(v, f, process=False)
        _MESH.scene = rtcs.EmbreeScene()
        TriangleMesh(_MESH.scene, v[f].astype(np.float32))
    return _MESH


def cast(O, D):
    """빛살(시작점, 방향 — 둘 다 (n,3)) → (면 번호(-1 = 안 맞음), 거리)"""
    r = mesh().scene.run(np.ascontiguousarray(O, np.float32), np.ascontiguousarray(D, np.float32), output=1)
    return np.where(r['geomID'] >= 0, r['primID'], -1), r['tfar']


REACH = 185.0  # km — 가운데에서 가장 먼 점(src/shapes.js SHAPE_REACH 184.54)


def pix_dirs(g, s, l):
    """화소(0부터 센 sample, line) → 카메라 틀의 단위 방향. 화소 축은 카메라 틀과 반대: +X = sample 줄어드는 쪽, +Y = line 줄어드는 쪽
    (2026-11-28 확인 — 2005-06-10 사진 14장 모두 밝은 쪽 무게 중심이 이 규약의 해 방향과 맞고 반대 규약과는 정반대)"""
    c = (g['n'] - 1) / 2
    d = np.stack([-(s - c) * g['ifov'], -(l - c) * g['ifov'], np.ones_like(s, dtype=float)], -1)
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def center_pix(g):
    """히페리온 중심이 맺히는 화소(sample, line)"""
    v = np.array(g['M']).T @ np.array(g['r'])
    c = (g['n'] - 1) / 2
    return c - v[0] / v[2] / g['ifov'], c - v[1] / v[2] / g['ifov']


def lommel(mu0, mu):
    """Lommel–Seeliger: 어두운 표면(히페리온 pV 0.3)의 원반 밝기 분포. 위상 함수는 사진마다 하나의 배수로 흡수한다"""
    return np.where(mu0 > 0, mu0 / np.maximum(mu0 + mu, 1e-9), 0.0)


def render(g, Q, s, l, shadows=True):
    """Q: 몸체 → J2000 회전. 화소 배열(s, l)마다 (밝기 모형, 맞은 면 번호(-1 = 빈 하늘), 맞은 점(몸체 km), μ0, μ)"""
    m = mesh()
    d = pix_dirs(g, np.asarray(s, float), np.asarray(l, float)).reshape(-1, 3)
    dJ = d @ np.array(g['M']).T
    db = dJ @ Q                                # = Qᵀ·dJ (행 벡터)
    O = Q.T @ (-np.array(g['r']))
    S = Q.T @ (np.array(g['sun']) / np.linalg.norm(g['sun']))
    face, t = cast(np.repeat(O[None], len(db), 0), db)
    hitm = face >= 0
    P = np.where(hitm[:, None], O + db * t[:, None], 0)
    n = m.face_normals[np.maximum(face, 0)]
    mu0 = np.where(hitm, n @ S, 0)
    mu = np.where(hitm, -(n * db).sum(1), 0)
    lit = hitm & (mu0 > 0)
    if shadows and lit.any():
        idx = np.nonzero(lit)[0]
        f2, _ = cast(P[idx] + n[idx] * 0.05, np.repeat(S[None], len(idx), 0))
        mu0[idx[f2 >= 0]] = 0
    b = lommel(np.maximum(mu0, 0), np.maximum(mu, 1e-3)) * (face >= 0)
    shp = np.shape(s)
    return b.reshape(shp), face.reshape(shp), P.reshape(shp + (3,)), mu0.reshape(shp), mu.reshape(shp)


# ---------- 자세 맞추기 ----------
def coarse(g, k):
    """k×k 화소를 묶은 기하"""
    h = dict(g); h['n'] = g['n'] // k; h['ifov'] = g['ifov'] * k
    return h


def bin_image(a, k):
    n = a.shape[0] // k * k
    return a[:n, :n].reshape(n // k, k, n // k, k).mean((1, 3))


def body_px(g):
    return REACH / (np.linalg.norm(g['r']) * g['ifov'])


def template(g, Q, R):
    """예측 중심 둘레 (2R+1)² 칸의 모형 그림과 그 왼쪽 위 화소"""
    cs, cl = center_pix(g)
    s0, l0 = int(round(cs)) - R, int(round(cl)) - R
    ss, ll = np.meshgrid(np.arange(s0, s0 + 2 * R + 1), np.arange(l0, l0 + 2 * R + 1))
    b = render(g, Q, ss, ll)[0]
    return b, s0, l0


def score(img, b):
    """모형 그림 b를 사진 img 위에서 밀어 가며 정규 상관이 가장 큰 곳 → (상관, ds, dl)"""
    import cv2
    if b.std() == 0:
        return -1, 0, 0
    r = cv2.matchTemplate(img.astype(np.float32), b.astype(np.float32), cv2.TM_CCOEFF_NORMED)
    _, mx, _, loc = cv2.minMaxLoc(r)
    return mx, loc[0], loc[1]


def pad(img, R):
    """사진 둘레에 R칸 빈 하늘(0)을 덧대 — 몸체가 가장자리에 걸려도 모형을 밀어 볼 수 있게"""
    return np.pad(img, R)


def fit_one(stem, g, n_rand=1500, target_px=36, fine_px=110, Q0=None, seed=0):
    """사진 하나의 히페리온 자세. 돌려주는 것: Q(몸체→J2000), 상관, 지향 오차(원래 화소 ds, dl)"""
    from scipy.optimize import minimize
    from scipy.spatial.transform import Rotation as Rot
    img0, _ = read_image(stem)
    img0 = np.nan_to_num(img0)
    Rb = body_px(g)

    def stage(px, Qs, keep):
        k = max(1, int(Rb / px))
        h = coarse(g, k)
        img = bin_image(img0, k)
        R = int(np.ceil(body_px(h) * 1.05)) + 1
        big = pad(img, R)
        out = []
        for Q in Qs:
            b, s0, l0 = template(h, Q, R)
            c, x, y = score(big, b)
            out.append((c, Q, (x - R - s0) * k, (y - R - l0) * k))
        out.sort(key=lambda t: -t[0])
        return out[:keep], h, big, R, k

    if Q0 is None:
        Qs = Rot.random(n_rand, random_state=seed).as_matrix()
        best, *_ = stage(target_px, Qs, 4)
    else:
        best = [(0, Q0, 0, 0)]
    # 다듬기: 회전 벡터 3개를 Nelder–Mead로(밀기는 매번 상관 최대 자리)
    res = []
    for i, (c0, Q, _, _) in enumerate(best):
        for px in ((target_px, fine_px) if i == 0 or Q0 is None else (target_px,)):
            k = max(1, int(Rb / px)); h = coarse(g, k); big = pad(bin_image(img0, k), int(np.ceil(body_px(h) * 1.05)) + 1)
            R = int(np.ceil(body_px(h) * 1.05)) + 1

            def f(w, Q=Q):
                return -score(big, template(h, Rot.from_rotvec(w).as_matrix() @ Q, R)[0])[0]
            step = 0.15 if px == target_px else 0.04
            o = minimize(f, np.zeros(3), method='Nelder-Mead',
                         options={'initial_simplex': np.vstack([np.zeros(3), np.eye(3) * step]), 'xatol': 2e-3, 'fatol': 1e-4, 'maxiter': 150})
            Q = Rot.from_rotvec(o.x).as_matrix() @ Q
        b, s0, l0 = template(h, Q, R)
        c, x, y = score(big, b)
        res.append((c, Q, (x - R - s0) * k, (y - R - l0) * k))
        if Q0 is not None:
            break
    res.sort(key=lambda t: -t[0])
    return res[0], res


PHASE_MAX = 100.0  # ° — 이보다 큰 위상(가는 초승달)은 맞추기가 불안정하고(2010-11-27 118°에서 윤곽이 어긋남) 지도에 보태는 것도 적어 뺀다


def phase(g):
    return float(np.degrees(np.arccos(np.dot(-np.array(g['r']) / np.linalg.norm(g['r']), np.array(g['sun']) / np.linalg.norm(g['sun'])))))


def whole(g):
    """몸체가 사진 안에 다 드는가(예측 중심 기준 — 지향 오차 여유 10%)"""
    R, (cs, cl), n = body_px(g), center_pix(g), g['n']
    return R < 0.45 * n and min(cs, cl) > R * 0.9 and max(cs, cl) < n - R * 0.9


def fit(ids=None, out='fit.json'):
    """몸체가 다 든 사진마다 자세를 맞춘다. 두 시간 안에 맞춘 사진이 있으면 그 자세(몸체→J2000)에서 시작해 다듬고,
    상관이 0.9 아래면 무작위 탐색부터 다시"""
    from scipy.spatial.transform import Rotation as Rot
    G = json.loads((WORK / 'geom.json').read_text(encoding='utf-8'))
    out_p = WORK / out
    F = json.loads(out_p.read_text(encoding='utf-8')) if out_p.exists() else {}
    prev = None
    for s in sorted(ids or G, key=lambda k: G[k]['et']):
        g = G[s]
        if s in F or not whole(g) or phase(g) > PHASE_MAX:
            if s in F:
                prev = (g['et'], np.array(F[s]['Q']), F[s]['corr'])
            continue
        Rb = body_px(g)
        t = time.time()
        how = '탐색'
        res = None
        if prev and g['et'] - prev[0] < 7200:
            res, _ = fit_one(s, g, Q0=prev[1]); how = '이웃'
            if res[0] < min(0.9, prev[2] - 0.03):  # 앞 사진만큼 맞으면 받아들인다
                res = None
        if res is None:
            res, alts = fit_one(s, g); how = '탐색'
        c, Q, ds, dl = res
        F[s] = {'Q': Q.tolist(), 'corr': c, 'ds': ds, 'dl': dl, 'Rpx': Rb, 'how': how}
        prev = (g['et'], Q, c)
        print(f'{s} {g["time"][:17]} 몸체 {Rb:.0f}px 상관 {c:.3f} 밀림 ({ds:+.0f},{dl:+.0f}) {how} {time.time() - t:.0f}s', flush=True)
        out_p.write_text(json.dumps(F, indent=0), encoding='utf-8')


# ---------- 지도 투영 ----------
MU_MIN, MU0_MIN = 0.25, 0.3
WPOW = 4   # 이보다 비스듬히 보이거나 비치는 곳은 쓰지 않는다(그림자·늘어남)


def surface(W):
    """지도 칸(W×W/2, 단순 원통 — 가운데 경도 0°, 동경+, 위 = 북)마다 겉면 점·매끈한 법선(몸체 km)"""
    m = mesh()
    lon = (np.arange(W) + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (np.arange(W // 2) + 0.5) / (W // 2) * np.pi
    LO, LA = np.meshgrid(lon, lat)
    d = np.stack([np.cos(LA) * np.cos(LO), np.cos(LA) * np.sin(LO), np.sin(LA)], -1).reshape(-1, 3)
    r = m.scene.run(np.zeros_like(d, np.float32), d.astype(np.float32), output=1)  # 가운데에서 밖으로(별 모양 — make_shapes.py에서 확인)
    if (r['geomID'] < 0).any():
        raise RuntimeError('겉면을 못 만난 지도 칸')
    P = d * r['tfar'][:, None]
    vn = m.vertex_normals[m.faces[r['primID']]]          # 꼭짓점 법선을 무게 중심 좌표로 섞는다
    u, v = r['u'][:, None], r['v'][:, None]
    n = vn[:, 0] * (1 - u - v) + vn[:, 1] * u + vn[:, 2] * v
    return P, n / np.linalg.norm(n, axis=1, keepdims=True)


def sample(img, s, l):
    """쌍선형 표본(밖이면 NaN)"""
    n_l, n_s = img.shape
    ok = (s >= 0) & (l >= 0) & (s <= n_s - 1.001) & (l <= n_l - 1.001)
    s0, l0 = np.floor(np.where(ok, s, 0)).astype(int), np.floor(np.where(ok, l, 0)).astype(int)
    fs, fl = np.where(ok, s, 0) - s0, np.where(ok, l, 0) - l0
    v = (img[l0, s0] * (1 - fs) * (1 - fl) + img[l0, s0 + 1] * fs * (1 - fl)
         + img[l0 + 1, s0] * (1 - fs) * fl + img[l0 + 1, s0 + 1] * fs * fl)
    return np.where(ok, v, np.nan)


def project(stem, g, f, P, n):
    """사진 하나를 지도 칸에 → (칸 번호, 반사율 ∝ I/F ÷ Lommel–Seeliger, 무게)"""
    Q = np.array(f['Q']); M = np.array(g['M']); r = np.array(g['r'])
    O = Q.T @ (-r)                                  # 탐사선(몸체 좌표)
    S = Q.T @ (np.array(g['sun']) / np.linalg.norm(g['sun']))
    V = O - P; dist = np.linalg.norm(V, axis=1); V /= dist[:, None]
    mu, mu0 = (n * V).sum(1), n @ S
    idx = np.nonzero((mu > MU_MIN) & (mu0 > MU0_MIN))[0]
    # 가려짐: 탐사선에서 그 점으로 쏜 빛살이 먼저 다른 면에 맞으면 안 보인다 · 그림자: 그 점에서 해 쪽으로 쏜 빛살이 맞으면
    face, t = cast(np.repeat(O[None], len(idx), 0), -V[idx])
    idx = idx[t > dist[idx] - 0.5]
    f2, _ = cast(P[idx] + n[idx] * 0.05, np.repeat(S[None], len(idx), 0))
    idx = idx[f2 < 0]
    cam = (Q @ P[idx].T).T + r                      # 탐사선 → 점 (J2000)
    v = cam @ M                                     # 카메라 틀
    c = (g['n'] - 1) / 2
    s = c - v[:, 0] / v[:, 2] / g['ifov'] + f['ds']
    l = c - v[:, 1] / v[:, 2] / g['ifov'] + f['dl']
    img = np.nan_to_num(read_image(stem)[0], nan=np.nan)
    val = sample(img, s, l) / lommel(mu0[idx], mu[idx])
    res = np.linalg.norm(r) * g['ifov']             # km/화소
    w = (mu[idx] * mu0[idx] / res ** 2) ** WPOW   # 거듭제곱: 조명이 다른 사진끼리 고르게 섞여 흐려지지 않게 — 칸마다 가장 좋은 사진이 주로 남는다
    ok = np.isfinite(val) & (val > 0)
    idx, val, w, m0, m1 = idx[ok], val[ok], w[ok], mu0[idx][ok], mu[idx][ok]
    # 남은 광도 추세(위상·거칠기에 따라 Lommel–Seeliger와 어긋나는 몫)를 사진마다 log v = a + b·log μ0 + c·log μ로 맞춰 나눈다.
    # 히페리온은 큰 규모의 밝기 차가 작아(어두운 물질은 구덩이 바닥의 작은 규모) 큰 추세는 광도로 본다
    if len(val) > 500:
        A = np.stack([np.ones_like(val), np.log(m0), np.log(m1)], 1)
        coef, *_ = np.linalg.lstsq(A, np.log(val), rcond=None)
        val = val / np.exp(A[:, 1:] @ coef[1:])
        med = np.median(val)
        val = np.clip(val, 0.3 * med, 2.0 * med)   # 명암 경계·가장자리에서 튀는 값(나눗셈이 커지는 곳)을 자른다
    return idx, val, w


def load_fits(min_corr=0.9, refined=True):
    """맞춘 자세 — refined이면 가장 늦은 다듬기 회차의 것"""
    if refined:
        r = max([int(p.name.split('_')[1][1:]) for p in WORK.glob('refined_r*_*.json')], default=0)
        if r:
            return merged(r)
    F = {}
    for p in sorted(WORK.glob('fit_*.json')):
        F.update(json.loads(p.read_text(encoding='utf-8')))
    G = json.loads((WORK / 'geom.json').read_text(encoding='utf-8'))
    return {k: v for k, v in F.items() if v['corr'] >= min_corr and phase(G[k]) <= PHASE_MAX}


def mosaic(W, iters=4):
    """사진마다 배수(위상 함수·노출 차)를 겹친 곳의 중앙값 비로 맞추고 무게 평균 → (지도, 덮인 칸, 배수)"""
    G = json.loads((WORK / 'geom.json').read_text(encoding='utf-8'))
    F = load_fits()
    P, n = surface(W)
    proj = {k: project(k, G[k], F[k], P, n) for k in sorted(F)}
    gains = {k: 1.0 for k in proj}

    for it in range(iters):
        num = np.zeros(len(P)); den = np.zeros(len(P))
        for k, (i, v, w) in proj.items():
            np.add.at(num, i, w * v / gains[k]); np.add.at(den, i, w)
        new = {}
        for k, (i, v, w) in proj.items():
            # 자기를 뺀 나머지 사진들의 평균과 견준다 — 자기만 덮은 곳은 쓰지 않는다
            o_den = den[i] - w
            ok = o_den > 0.2 * den[i]
            new[k] = float(np.median(v[ok] / ((num[i][ok] - w[ok] * v[ok] / gains[k]) / o_den[ok]))) if ok.sum() > 200 else np.nan
        g0 = float(np.nanmedian(list(new.values())))
        gains = {k: (v / g0 if np.isfinite(v) else gains[k]) for k, v in new.items()}
    num = np.zeros(len(P)); den = np.zeros(len(P))
    for k, (i, v, w) in proj.items():
        np.add.at(num, i, w * v / gains[k]); np.add.at(den, i, w)
    mos = np.where(den > 0, num / np.maximum(den, 1e-30), np.nan).reshape(W // 2, W)
    return mos, den.reshape(W // 2, W) > 0, gains, proj


TINT = np.array([0x9c, 0x8b, 0x78]) / np.mean([0x9c, 0x8b, 0x78])  # 색: 예전 단색(사진을 보고 고른 근사)의 비 — 사진은 투명 필터라 색이 없다


def fill(mos, have):
    """관측 없는 칸: 경계에서 안쪽으로 번지게 메우고(멀수록 전체 평균에 가깝게) 이음매 없이 — 경도 방향은 감아서"""
    import cv2
    from scipy import ndimage
    H, W = mos.shape
    mean = float(np.nanmean(mos[have]))
    wide = np.concatenate([mos[:, -W // 4:], mos, mos[:, :W // 4]], 1)
    hv = np.concatenate([have[:, -W // 4:], have, have[:, :W // 4]], 1)
    out = np.where(hv, wide, mean)
    for it in range(200):  # 관측 칸은 고정, 빈 칸은 이웃 평균(확산)
        blur = cv2.blur(out, (5, 5))
        out = np.where(hv, wide, blur)
    d = ndimage.distance_transform_edt(~hv) / (W / 360)   # 관측 경계에서의 거리(경도 1° 단위)
    t = np.clip(d / 15, 0, 1)                              # 15° 넘게 떨어지면 평균
    out = np.where(hv, wide, out * (1 - t) + mean * t)
    return out[:, W // 4:W // 4 + W]


def make_map(W=2048):
    from PIL import Image
    mos, have, gains, proj = mosaic(W)
    cov = have.mean()
    # 덮인 넓이 비(위도 가중)
    lat = np.pi / 2 - (np.arange(W // 2) + 0.5) / (W // 2) * np.pi
    wl = np.cos(lat)[:, None] * np.ones((1, W))
    area = float((wl * have).sum() / wl.sum())
    lin = fill(mos, have)
    lin = lin / np.percentile(lin[have], 99.5) * 0.8          # 밝기 눈금은 앱이 반사율로 다시 맞춘다(albedo.js · map_stats.py)
    rgb = np.clip(lin[..., None] * TINT[None, None], 0, 1)
    srgb = np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * rgb ** (1 / 2.4) - 0.055)
    out = HERE.parent / 'textures' / 'hyperion_2k.jpg'
    Image.fromarray((srgb * 255 + 0.5).astype(np.uint8)).save(out, quality=90)
    np.save(WORK / 'have.npy', have)
    (WORK / 'gains.json').write_text(json.dumps(gains, indent=0), encoding='utf-8')
    print(f'사진 {len(proj)}장 · 덮인 칸 {100 * cov:.1f}% · 덮인 넓이 {100 * area:.1f}% · 배수 {min(gains.values()):.2f}~{max(gains.values()):.2f} → {out.name}')


def map_lookup(mos, X):
    """몸체 점 X(n,3)의 방향 경도·위도로 지도 mos(H×W, 단순 원통)를 쌍선형으로 읽는다 — 경도는 감는다"""
    H_, W_ = mos.shape
    lon = np.arctan2(X[:, 1], X[:, 0]); lat = np.arcsin(np.clip(X[:, 2] / np.linalg.norm(X, axis=1), -1, 1))
    x = (lon + np.pi) / (2 * np.pi) * W_ - 0.5
    y = (np.pi / 2 - lat) / np.pi * H_ - 0.5
    x0 = np.floor(x).astype(int); y0 = np.clip(np.floor(y).astype(int), 0, H_ - 2)
    fx, fy = x - x0, np.clip(y - y0, 0, 1)
    a = lambda yy, xx: mos[yy, xx % W_]
    return (a(y0, x0) * (1 - fx) * (1 - fy) + a(y0, x0 + 1) * fx * (1 - fy) + a(y0 + 1, x0) * (1 - fx) * fy + a(y0 + 1, x0 + 1) * fx * fy)


def refine_one(stem, g, f, mos, px=120):
    """자세 다듬기: 사진을 「다른 사진들로 만든 지도 × 광도」로 그린 예상 그림과 견줘 회전 3 + 밀림 2를 맞춘다(상관 최대)"""
    from scipy.optimize import minimize
    from scipy.spatial.transform import Rotation as Rot
    img0 = np.nan_to_num(read_image(stem)[0])
    k = max(1, int(body_px(g) / px)); h = coarse(g, k)
    img = bin_image(img0, k)
    R = int(np.ceil(body_px(h) * 1.05)) + 1
    Q0 = np.array(f['Q'])
    cs, cl = center_pix(h)
    ss, ll = np.meshgrid(np.arange(-R, R + 1), np.arange(-R, R + 1))
    base_s, base_l = int(round(cs + f['ds'] / k)), int(round(cl + f['dl'] / k))
    obs = sample(img, (ss + base_s).astype(float), (ll + base_l).astype(float))

    def predict(x):
        Q = Rot.from_rotvec(x[:3]).as_matrix() @ Q0
        # 사진 화소 (s, l)는 모형 화소 (s − 밀림)에 해당한다
        S = ss + base_s - (f['ds'] / k + x[3]); L = ll + base_l - (f['dl'] / k + x[4])
        b, face, X, mu0, mu = render(h, Q, S, L)
        alb = map_lookup(mos, X.reshape(-1, 3)).reshape(b.shape)
        return np.where(face >= 0, b * alb, 0.0)

    def corr(x):
        p = predict(x)
        ok = np.isfinite(p) & np.isfinite(obs)
        return np.corrcoef(p[ok], obs[ok])[0, 1]
    c0 = corr(np.zeros(5))
    o = minimize(lambda x: -corr(x), np.zeros(5), method='Nelder-Mead',
                 options={'initial_simplex': np.vstack([np.zeros(5), np.diag([0.01, 0.01, 0.01, 1.0, 1.0])]), 'xatol': 1e-4, 'fatol': 1e-5, 'maxiter': 250})
    x = o.x
    return {'Q': (Rot.from_rotvec(x[:3]).as_matrix() @ Q0).tolist(), 'ds': f['ds'] + x[3] * k, 'dl': f['dl'] + x[4] * k,
            'corr': f['corr'], 'corr_map0': c0, 'corr_map': -o.fun, 'Rpx': f.get('Rpx'), 'how': f.get('how', '') + '+다듬기'}


def merged(r):
    """r회 다듬기 결과(refined_r<r>_*.json)를 합친 것"""
    F = {}
    for p in sorted(WORK.glob(f'refined_r{r}_*.json')):
        F.update(json.loads(p.read_text(encoding='utf-8')))
    return F


def refine(r, part=0, parts=1, W=1024):
    """r회째 다듬기: (r−1)회 결과 전부로 지도를 만들고, 그중 part번째 몫(parts개로 나눔)의 사진마다
    자기를 뺀 지도로 자세를 다듬는다 → refined_r<r>_<part>.json. 여러 몫을 동시에 돌리고, 다 끝나면 r+1회"""
    G = json.loads((WORK / 'geom.json').read_text(encoding='utf-8'))
    F = load_fits(refined=False) if r == 1 else merged(r - 1)
    P, n = surface(W)
    proj = {k: project(k, G[k], F[k], P, n) for k in sorted(F)}
    num = np.zeros(len(P)); den = np.zeros(len(P))
    for k, (i, v, w) in proj.items():
        np.add.at(num, i, w * v); np.add.at(den, i, w)
    out_p = WORK / f'refined_r{r}_{part}.json'
    newF = json.loads(out_p.read_text(encoding='utf-8')) if out_p.exists() else {}
    for k in sorted(F)[part::parts]:
        if k in newF:
            continue
        i, v, w = proj[k]
        nn, dd = num.copy(), den.copy()
        np.subtract.at(nn, i, w * v); np.subtract.at(dd, i, w)
        mos = np.where(dd > 1e-12 * den.max(), nn / np.maximum(dd, 1e-30), np.nan).reshape(W // 2, W)
        t = time.time()
        newF[k] = refine_one(k, G[k], F[k], mos)
        print(f'{r}회 {k} 상관 {newF[k]["corr_map0"]:.3f} → {newF[k]["corr_map"]:.3f} 밀림 ({newF[k]["ds"]:+.1f},{newF[k]["dl"]:+.1f}) {time.time() - t:.0f}s', flush=True)
        out_p.write_text(json.dumps(newF, indent=0), encoding='utf-8')


def check(W=1024, shift_deg=3.0):
    """정합 확인: 날짜(촬영 묶음)별로 따로 만든 지도의 잔무늬(5° 흐림을 뺀 것)가 겹친 곳에서 얼마나 같은가.
    자세가 맞으면 서로 다른 날 사진끼리도 상관이 높고, 한쪽을 경도로 shift_deg만큼 밀면(변이) 떨어져야 한다"""
    import cv2
    G = json.loads((WORK / 'geom.json').read_text(encoding='utf-8'))
    F = load_fits()
    P, n = surface(W)
    groups = {}
    for k in sorted(F):
        groups.setdefault(G[k]['time'][:10], []).append(k)
    maps = {}
    for d, ks in groups.items():
        num = np.zeros(len(P)); den = np.zeros(len(P))
        for k in ks:
            i, v, w = project(k, G[k], F[k], P, n)
            np.add.at(num, i, w * v); np.add.at(den, i, w)
        m = np.where(den > 0, num / np.maximum(den, 1e-30), np.nan).reshape(W // 2, W)
        have = np.isfinite(m)
        f = np.where(have, m, 0)
        k5 = int(W / 360 * 5) | 1
        lo = cv2.GaussianBlur(f, (0, 0), k5 / 2) / np.maximum(cv2.GaussianBlur(have.astype(float), (0, 0), k5 / 2), 1e-9)
        maps[d] = (np.where(have, f / np.maximum(lo, 1e-9) - 1, np.nan), have)
    lat = np.pi / 2 - (np.arange(W // 2) + 0.5) / (W // 2) * np.pi
    band = (np.abs(lat) < np.radians(60))[:, None]
    sh = int(round(W / 360 * shift_deg))
    rows = []
    ds = sorted(maps)
    for a in range(len(ds)):
        for b in range(a + 1, len(ds)):
            A, ha = maps[ds[a]]; B, hb = maps[ds[b]]
            ov = ha & hb & band
            if ov.sum() < 2000:
                continue
            c0 = np.corrcoef(A[ov], B[ov])[0, 1]
            Bs, hbs = np.roll(B, sh, 1), np.roll(hb, sh, 1)
            ov2 = ha & hbs & band
            c1 = np.corrcoef(A[ov2], Bs[ov2])[0, 1]
            rows.append((ds[a], ds[b], int(ov.sum()), c0, c1))
            print(f'{ds[a]} × {ds[b]}  겹친 칸 {ov.sum():6d}  상관 {c0:.3f}  경도 {shift_deg:g}° 밀면 {c1:.3f}')
    return rows


def overlay(stem, g, Q, ds, dl, path, size=400):
    """사진 | 맞춘 모형 그림 | 겹침(빨강 = 사진, 초록 = 모형) — 확인용"""
    from PIL import Image
    img0 = np.nan_to_num(read_image(stem)[0])
    k = max(1, int(body_px(g) / 120)); h = coarse(g, k)
    img = bin_image(img0, k)
    R = int(np.ceil(body_px(h) * 1.05)) + 1
    b, s0, l0 = template(h, Q, R)
    s0 += int(round(ds / k)); l0 += int(round(dl / k))
    big = pad(img, R)
    crop = big[l0 + R:l0 + 3 * R + 1, s0 + R:s0 + 3 * R + 1]
    if crop.shape != b.shape:
        crop = np.zeros_like(b)
    nrm = lambda a: np.clip(a / max(np.percentile(a, 99.5), 1e-9), 0, 1)
    A, B = nrm(crop), nrm(b)
    rgb = np.stack([A, B, np.zeros_like(A)], -1)
    row = np.concatenate([np.stack([A] * 3, -1), np.stack([B] * 3, -1), rgb], 1)
    Image.fromarray((row ** 0.6 * 255).astype(np.uint8)).resize((size * 3, size)).save(path)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'fit':  # fit [날짜 앞부분(예: 2005-357) …] — 날짜별로 나눠 여러 개를 동시에 돌린다(결과는 fit_<첫 인자>.json)
        G = json.loads((WORK / 'geom.json').read_text(encoding='utf-8'))
        pre = sys.argv[2:]
        fit([k for k, g in G.items() if not pre or any(g['time'].startswith(p) for p in pre)], f'fit_{pre[0] if pre else "all"}.json')
    elif cmd == 'refine':  # refine <회차> <몫> <몫 수>
        refine(*map(int, sys.argv[2:5]))
    elif cmd == 'check':
        check()
    elif cmd == 'map':
        make_map()
    else:
        {'geom': geom}[cmd]()
