"""토성 고리 단면 만들기 — Cassini RSS 전파 엄폐 관측(NASA PDS, 퍼블릭 도메인)의 수직 광학 깊이를 고르게 다시 뽑는다.

원본은 git에 넣지 않는다(5MB). 받는 주소는 textures/출처.md.
쓰는 법: python tools/make_rings.py <원본 TAU_10KM.TAB>
결과: textures/saturn_rings.json — { r0, r1, n, tau[n] } (반지름 r0~r1 km를 n칸으로 고르게 나눈 칸마다의 광학 깊이)

칸 하나에 원본 점(2.5km 간격)이 여럿 들어간다. 칸 평균은 광학 깊이가 아니라 투과율 exp(−τ)로 낸다
— 칸 안에 불투명한 띠와 빈틈이 섞여 있으면 빛은 빈틈으로 지나가므로(τ 평균은 칸을 너무 어둡게 만든다).
"""
import json
import math
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'textures' / 'saturn_rings.json'
R0, R1, N = 74000.0, 137500.0, 4096  # C고리 안쪽 끝(74,490km) ~ A고리 바깥 끝(136,770km). F고리는 먼지 고리라 3.6cm 전파에 거의 안 잡힌다(이 자료에서 τ<0.02)
TAU_MAX = 5.0  # 원본의 관측 상한(HIGHEST_DETECTABLE_OPACITY 5.06) — 더 큰 값은 「불투명」 이상의 뜻이 없다


def main(src: Path):
    rows = []
    for line in src.read_text().splitlines():
        f = line.split(',')
        if len(f) < 9:
            continue
        # 반지름 + 극 보정 + 시각 보정(라벨이 둘 다 더하라고 한다 — 합쳐 1km 남짓이라 칸 너비 16km에 비해 무시할 만하다)
        r = float(f[0]) + float(f[1]) + float(f[2])
        tau = min(TAU_MAX, max(0.0, float(f[6])))  # 잡음으로 음수가 나온 빈틈은 0
        rows.append((r, tau))
    if not rows:
        raise SystemExit('자료 줄이 없다')
    lo, hi = min(r for r, _ in rows), max(r for r, _ in rows)  # 진입 단면은 반지름이 줄어드는 순서라 양 끝이 아니라 최소·최대로
    if lo > R0 or hi < R1:
        raise SystemExit(f'원본 범위 {lo:.0f}~{hi:.0f}km가 {R0:.0f}~{R1:.0f}km를 덮지 못한다')
    dr = (R1 - R0) / N
    sumT = [0.0] * N
    cnt = [0] * N
    for r, tau in rows:
        k = math.floor((r - R0) / dr)
        if 0 <= k < N:
            sumT[k] += math.exp(-tau)
            cnt[k] += 1
    out = []
    for k in range(N):
        if cnt[k] == 0:
            raise SystemExit(f'빈 칸 {k} (r={R0 + (k + .5) * dr:.0f}km)')
        T = sumT[k] / cnt[k]
        out.append(round(min(TAU_MAX, -math.log(max(T, math.exp(-TAU_MAX)))), 3) + 0.0)  # -0.0 방지
    OUT.write_text(json.dumps({
        'source': 'Cassini RSS Rev007E X43 (2005-05-03), NASA PDS CORSS_8001 — 수직 광학 깊이, 파장 3.6cm',
        'r0': R0, 'r1': R1, 'n': N, 'tau': out,
    }, separators=(',', ':')), encoding='utf-8')
    print(f'{OUT.name}: 원본 {len(rows)}점 -> {N}칸({dr:.1f}km), {OUT.stat().st_size // 1024}KB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
