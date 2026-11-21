"""Horizons 위성 자료(원본/moons/<id>.txt, tools/fetch_moons.py)에 맞춘 평균 궤도 식을 src/moon_fits.js 로 낸다.

방법(위성마다):
 1. 기준면 = 250년 동안 궤도 각운동량 방향의 평균(평균 궤도면). x축은 그 면이 J2000 황도와 만나는 승교점 쪽.
 2. 표본마다 순간 궤도 요소 → 평균 황경 L, 이심률 벡터 K = e·exp(iϖ), 기울기 벡터 H = sin(i)·exp(iΩ).
 3. 느린 변화만 맞춘다(표본 간격 3.14일보다 짧은 흔들림은 잡음으로 둔다).
    L = L0 + n·t + c·t² + Σ 주기항,  K·H = Σ 복소 주기항(상수 포함). 주기항은 잔차의 주기 분석으로 하나씩 더한다.
 4. a는 위치 반지름에 맞춘다(행성 편평도 때문에 순간 a와 실제 궤도 반지름이 조금 다르다).
 5. 간격 절반만큼 민 표본(<id>_check.txt)으로 오차를 잰다 — 맞출 때 안 쓴 자료.

실행: python tools/fit_moons.py   (출력: src/moon_fits.js, 오차 요약은 화면에)
"""
import json
from pathlib import Path
import numpy as np
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / '원본' / 'moons'
J2000 = 2451545.0
OBL = np.radians(84381.448 / 3600)
# 행성+위성 GM(km³/s²) — 순간 궤도 요소용(정확할 필요는 없다: a는 4단계에서 다시 맞춘다)
GM = {499: 42828.37, 599: 126686531.9 + 26229.7, 699: 37931206.2 + 9376, 799: 5793951.3 + 605, 899: 6835099.5 + 1428.5}
MOONS = {401: ('phobos', 499), 402: ('deimos', 499), 501: ('io', 599), 502: ('europa', 599), 503: ('ganymede', 599),
         504: ('callisto', 599), 601: ('mimas', 699), 602: ('enceladus', 699), 603: ('tethys', 699), 604: ('dione', 699),
         605: ('rhea', 699), 606: ('titan', 699), 608: ('iapetus', 699), 701: ('ariel', 799), 702: ('umbriel', 799),
         703: ('titania', 799), 704: ('oberon', 799), 705: ('miranda', 799), 801: ('triton', 899)}
N_L, N_K, N_H = 8, 5, 5  # 주기항 최대 개수
TOL = np.radians(0.01)  # 잔차가 이보다 작으면 그만(평균 황경 0.01° · 이심률·기울기 벡터도 같은 크기의 위치 오차)


def load(path):
    a = np.loadtxt(path)
    return a[:, 0] - J2000, a[:, 1:4], a[:, 4:7]


def plane_frame(r, v):
    h = np.cross(r, v)
    p = (h / np.linalg.norm(h, axis=1)[:, None]).mean(0)
    p /= np.linalg.norm(p)
    z = np.array([0, 0, 1.0])
    x = np.cross(z, p)  # 평균 궤도면과 황도의 승교점 방향
    x = x / np.linalg.norm(x) if np.linalg.norm(x) > 1e-9 else np.array([1.0, 0, 0])
    y = np.cross(p, x)
    return np.array([x, y, p])  # 행: 기준면 좌표축(황도 좌표)


def osculating(r, v, mu):
    h = np.cross(r, v)
    hn = np.linalg.norm(h, axis=1)
    rn = np.linalg.norm(r, axis=1)
    inc = np.arccos(np.clip(h[:, 2] / hn, -1, 1))
    node = np.arctan2(h[:, 0], -h[:, 1])
    ev = np.cross(v, h) / mu - r / rn[:, None]
    e = np.linalg.norm(ev, axis=1)
    # 승교점 방향 N, 궤도면 안에서 N에 수직인 방향 Q
    N = np.stack([np.cos(node), np.sin(node), np.zeros_like(node)], 1)
    Q = np.cross(h / hn[:, None], N)
    w_peri = np.arctan2((ev * Q).sum(1), (ev * N).sum(1))  # ω
    u = np.arctan2((r * Q).sum(1), (r * N).sum(1))  # 위도 인수
    nu = u - w_peri
    E = 2 * np.arctan2(np.sqrt(1 - e) * np.sin(nu / 2), np.sqrt(1 + e) * np.cos(nu / 2))
    M = E - e * np.sin(E)
    varpi = node + w_peri
    a = 1 / (2 / rn - (v * v).sum(1) / mu)
    return dict(a=a, e=e, inc=inc, node=node, varpi=varpi, L=varpi + M)


def unwrap_L(t, L, n_guess):
    out = np.empty_like(L)
    out[0] = L[0]
    for k in range(1, len(L)):
        pred = out[k - 1] + n_guess * (t[k] - t[k - 1])
        out[k] = L[k] + 2 * np.pi * np.round((pred - L[k]) / (2 * np.pi))
    return out


def best_freq(t, y, fmax, complex_=False, exclude=()):
    # 표본이 거의 고른 간격이라 격자에 올려 FFT(8배 덧대기)로 봉우리를 찾는다 — 마지막에 최소제곱으로 다듬는다
    dt = np.median(np.diff(t))
    idx = np.round((t - t[0]) / dt).astype(int)
    n = 8 * (idx[-1] + 1)
    g = np.zeros(n, complex)
    g[idx] = y
    P = np.abs(np.fft.fft(g)) ** 2
    f = np.fft.fftfreq(n, dt) * 2 * np.pi  # numpy FFT는 exp(-i…) — exp(+i f t) 신호가 +f에 선다
    lo = 2 * np.pi / (t[-1] - t[0])
    ok = (np.abs(f) < fmax) & ((np.abs(f) > lo) if not complex_ else (np.abs(f) > lo * 0.5))
    if not complex_:
        ok &= f > 0
    for g in exclude:  # 이미 있는 항 곁의 봉우리(옆띠) — 겹치면 계수가 서로 상쇄하며 커진다
        ok &= np.abs(f - g) > 1.5 * RES(t)
    k = np.flatnonzero(ok)[P[ok].argmax()]
    return f[k]


def RES(t):
    return 2 * np.pi / (t.max() - t.min())  # 주파수 분해능(rad/일)


def fit_real(t, y, base_cols, nterms, fmax, tol):
    """y ≈ base_cols·b + Σ (A cos ft + B sin ft) — 주파수는 하나씩 찾고 마지막에 함께 다듬는다."""
    freqs = []
    def design(fr):
        cols = list(base_cols) + [g(t * w) for w in fr for g in (np.cos, np.sin)]
        return np.stack(cols, 1)
    def solve(fr):
        A = design(fr)
        c, *_ = np.linalg.lstsq(A, y, rcond=None)
        return c, y - A @ c
    c, res = solve(freqs)
    for _ in range(nterms):
        if np.std(res) < tol:  # 이미 충분히 맞으면 항을 더하지 않는다
            break
        f = best_freq(t, res, fmax, exclude=freqs)
        trial = freqs + [f]
        c2, res2 = solve(trial)
        if np.std(res2) > 0.97 * np.std(res):  # 3%도 안 줄면 그만
            break
        freqs, c, res = trial, c2, res2
    if freqs:
        def r(fr):
            return solve(list(fr))[1]
        f0 = np.array(freqs)
        freqs = list(least_squares(r, f0, bounds=(f0 - 0.5 * RES(t), f0 + 0.5 * RES(t))).x)
        c, res = solve(freqs)
    return freqs, c, res


def fit_complex(t, z, nterms, fmax, tol):
    """z ≈ Σ C exp(i f t) (상수항 f=0 포함)."""
    freqs = [0.0]
    def solve(fr):
        A = np.exp(1j * np.outer(t, fr))
        c, *_ = np.linalg.lstsq(A, z, rcond=None)
        return c, z - A @ c
    c, res = solve(freqs)
    # 자료 기간(250년)보다 긴 주기(궤도면·근점이 수백~수천 년에 한 바퀴)는 FFT 봉우리로 안 잡힌다 — 낮은 주파수를 직접 훑는다
    lo = RES(t)
    best = None
    for f in np.linspace(-3 * lo, 3 * lo, 601):
        if abs(f) < 1e-3 * lo:
            continue
        c2, res2 = solve([0.0, f])
        nr = np.linalg.norm(res2)
        if best is None or nr < best[0]:
            best = (nr, f)
    if best and best[0] < 0.97 * np.linalg.norm(res):
        freqs = [0.0, best[1]]
        c, res = solve(freqs)
    for _ in range(nterms):
        if np.sqrt(np.mean(np.abs(res) ** 2)) < tol:
            break
        f = best_freq(t, res, fmax, complex_=True, exclude=freqs)
        trial = freqs + [f]
        c2, res2 = solve(trial)
        if np.linalg.norm(res2) > 0.97 * np.linalg.norm(res):
            break
        freqs, c, res = trial, c2, res2
    if len(freqs) > 1:
        def r(fr):
            rr = solve([0.0] + list(fr))[1]
            return np.concatenate([rr.real, rr.imag])
        f0 = np.array(freqs[1:])
        freqs = [0.0] + list(least_squares(r, f0, bounds=(f0 - 0.5 * RES(t), f0 + 0.5 * RES(t))).x)
        c, res = solve(freqs)
    return freqs, c, res


def kepler(M, e):
    E = M + e * np.sin(M)
    for _ in range(30):
        E -= (E - e * np.sin(E) - M) / (1 - e * np.cos(E))
    return E


def evaluate(model, t):
    """맞춘 식 → 황도 좌표 위치(km). src/moons.js 와 같은 식."""
    L = model['L0'] + model['n'] * t + model['c2'] * t * t
    for f, A, B in model['Lterms']:
        L = L + A * np.cos(f * t) + B * np.sin(f * t)
    K = sum((re + 1j * im) * np.exp(1j * f * t) for f, re, im in model['Kterms'])
    H = sum((re + 1j * im) * np.exp(1j * f * t) for f, re, im in model['Hterms'])
    e, varpi = np.abs(K), np.angle(K)
    inc, node = np.arcsin(np.clip(np.abs(H), 0, 1)), np.angle(H)
    E = kepler(L - varpi, e)
    a = model['a']
    xp, yp = a * (np.cos(E) - e), a * np.sqrt(1 - e * e) * np.sin(E)
    w = varpi - node
    cw, sw, cO, sO, ci, si = np.cos(w), np.sin(w), np.cos(node), np.sin(node), np.cos(inc), np.sin(inc)
    X = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp
    Y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp
    Z = (sw * si) * xp + (cw * si) * yp
    F = np.array(model['frame'])
    return np.stack([X, Y, Z], 1) @ F


def angle_err(p, r):
    c = (p * r).sum(1) / np.linalg.norm(p, axis=1) / np.linalg.norm(r, axis=1)
    return np.degrees(np.arccos(np.clip(c, -1, 1)))


def fit_one(mid, center):
    t, r, v = load(SRC / f'{mid}.txt')
    F = plane_frame(r, v)
    rl, vl = r @ F.T, v @ F.T
    o = osculating(rl, vl, GM[center])
    span = t.max() - t.min()
    fmax = np.pi / 3.1416 * 0.8  # 표본 간격의 나이퀴스트보다 낮게
    # 평균 운동 첫 어림: 순간 a의 중앙값과 케플러 법칙
    n0 = np.sqrt(GM[center] / np.median(o['a']) ** 3) * 86400
    L = unwrap_L(t, o['L'], n0)
    # 첫 어림이 틀려 한 바퀴씩 밀렸으면 기울기로 다시 풀기
    n1 = np.polyfit(t, L, 1)[0]
    L = unwrap_L(t, o['L'], n1)
    tau = t / 36525
    Lf, Lc, Lres = fit_real(t, L, [np.ones_like(t), tau, tau * tau], N_L, fmax, TOL)
    K = o['e'] * np.exp(1j * o['varpi'])
    Kf, Kc, _ = fit_complex(t, K, N_K, fmax, TOL)
    H = np.sin(o['inc']) * np.exp(1j * o['node'])
    Hf, Hc, _ = fit_complex(t, H, N_H, fmax, TOL)
    model = dict(frame=F.tolist(), a=1.0, L0=Lc[0], n=Lc[1] / 36525, c2=Lc[2] / 36525 ** 2,
                 Lterms=[[f, Lc[3 + 2 * k], Lc[4 + 2 * k]] for k, f in enumerate(Lf)],
                 Kterms=[[f, c.real, c.imag] for f, c in zip(Kf, Kc)],
                 Hterms=[[f, c.real, c.imag] for f, c in zip(Hf, Hc)])
    # a: 모형 위치(단위 a)와 관측 위치의 반지름 비
    p = evaluate(model, t)
    model['a'] = float(np.sum(np.linalg.norm(p, axis=1) * np.linalg.norm(r, axis=1)) / np.sum(np.linalg.norm(p, axis=1) ** 2))
    p = evaluate(model, t)
    err_fit = angle_err(p, r)
    tc, rc, _ = load(SRC / f'{mid}_check.txt')
    pc = evaluate(model, tc)
    err = angle_err(pc, rc)
    drc = np.abs(np.linalg.norm(pc, axis=1) / np.linalg.norm(rc, axis=1) - 1)
    return model, dict(fit_max=err_fit.max(), check_rms=np.sqrt((err ** 2).mean()), check_max=err.max(),
                       check_dr_max=drc.max(), nL=len(Lf), nK=len(Kf) - 1, nH=len(Hf) - 1)


def main():
    out = {}
    for mid, (key, center) in MOONS.items():
        model, s = fit_one(mid, center)
        out[key] = model
        print(f"{key:10s} 맞춘 자료 최대 {s['fit_max']:.3f}° · 따로 둔 자료 RMS {s['check_rms']:.3f}° 최대 {s['check_max']:.3f}° "
              f"· 거리 최대 {s['check_dr_max'] * 100:.2f}% · 항 L{s['nL']} K{s['nK']} H{s['nH']}")
    # JSON 크기를 줄이려고 유효숫자를 자른다(각은 1e-9 rad 수준이면 충분)
    def rnd(x):
        if isinstance(x, list):
            return [rnd(y) for y in x]
        return float(f'{x:.12g}')
    (ROOT / 'src' / 'moon_fits.js').write_text(
        '// tools/fit_moons.py 가 만든 파일 — 손으로 고치지 않는다. 식은 src/moons.js moonPosition.' + chr(10) +
        '// 시간 t: J2000 TDB부터 날. 각: 라디안. frame: 평균 궤도면 좌표축 3개(J2000 황도 좌표의 행)' + chr(10) +
        'export default ' + json.dumps({k: {kk: rnd(vv) for kk, vv in m.items()} for k, m in out.items()}, separators=(',', ':')) + ';' + chr(10),
        encoding='utf-8')


if __name__ == '__main__':
    main()
