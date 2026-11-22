"""세레스·트리톤·천왕성 위성 5개 표면 지도 → textures/<이름>_2k.jpg (2048×1024).

원본은 git에 넣지 않는다(`원본/ceres`·`원본/triton`·`원본/uranusmoons`, 주소는 textures/출처.md).
쓰는 법: python tools/make_smallworlds.py <원본 폴더(=원본)> [ceres triton ariel umbriel titania oberon miranda]

경도 배치(2026-11-22 지형으로 확인):
  세레스 — 라벨 가운데 180°·왼쪽 끝 0°(동경+) → 반 바퀴 돌려 가운데 0°. Occator 밝은 점(동경 239.3°·북위 19.8°)이 모자이크 속 그 자리.
  트리톤 — 라벨대로 가운데 0°·동경+(Voyager 2 근접 때 트리톤 중심 시점 경도 0~5°와 고해상도 부분 위치가 같음).
  천왕성 위성 — JPL 질감 지도(USGS 자료로 만듦, 설명 없음)라 USGS 지명 자료의 지형(움브리엘 Wunda·티타니아 Messina Chasmata 등)을 겹쳐
  확인한 결과 가운데 0°·동경+ → 그대로. Voyager 2는 남반구(천왕성 쪽 겨울이 아닌 햇빛 받는 쪽)만 봤다 — 북쪽 약 60%는 관측 없음.
관측 없는 곳은 관측 평균 색으로 메운다(make_pluto.fill — 경계는 가까운 관측 색에서 평균 색으로 이어 어두운 띠 없음).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_pluto import empty_mask, fill, save  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
URA = {'ariel': 'ura1vuu2', 'umbriel': 'ura2vuu2', 'titania': 'ura3vuu2', 'oberon': 'ura4vuu2', 'miranda': 'ura5vuu2'}


def trim_edge(a, px):
    """관측 없는 곳과 닿은 가장자리 px 화소를 같이 빈 곳으로 — 모자이크 가장자리의 어두운 테두리 제거.
    빈 곳은 fill과 같은 판정(empty_mask)만 — 관측 안의 작은 어두운 점까지 키우면 fill이 메우지 않아 검게 남는다."""
    from scipy.ndimage import binary_dilation
    empty = empty_mask(a)
    out = a.copy()
    out[binary_dilation(empty, iterations=px) & ~empty] = 0
    return out


EDGE_BAND = 16  # 화소(1440폭에서 4°) — 천왕성 위성 원본은 관측 경계(명암 경계선 근처)를 따라 이 폭보다 넓게 어둡다


HOLE_REACH = 40  # 화소(10°) — 관측 경계 이만큼 안의 검정 점은 자료 없음(원본 관측 화소 중앙값 103~141)


def fill_holes(a, empty, reach):
    """관측 경계 reach 화소 안에 떨어져 있는 작은 검정(관측 없음) 점을 주변 관측 값으로 메운다."""
    from scipy.ndimage import distance_transform_edt, gaussian_filter
    from make_pluto import EMPTY
    hole = (a.mean(2) < EMPTY) & ~empty & (distance_transform_edt(~empty) <= reach)
    ok = (~hole & ~empty).astype(float)
    out = a.copy()
    for sig in (2, 4, 8, 16):  # 큰 구멍은 넓게 — 관측 화소만 평균
        w = gaussian_filter(ok, sig, mode=('nearest', 'wrap'))
        v = np.stack([gaussian_filter(a[..., c] * ok, sig, mode=('nearest', 'wrap')) for c in range(a.shape[2])], -1)
        put = hole & (w > 0.05)
        out[put] = (v / np.maximum(w, 1e-9)[..., None])[put]
        hole &= ~put
    return out


def soften_edge(a, empty, band):
    """관측 쪽 경계 안쪽 band 화소를 관측 평균 색으로 옮겨 간다(경계에서 평균 → band 안쪽에서 원래 값, smoothstep).
    fill 앞에 부른다 — 원본의 어두운 경계 띠가 메운 평균 색과 맞닿아 선으로 보이는 것을 없앤다. 빈 쪽(0)은 그대로."""
    from scipy.ndimage import distance_transform_edt
    d = distance_transform_edt(~empty)
    t = np.clip((d - 1) / band, 0, 1)
    t = (t * t * (3 - 2 * t))[..., None]
    mean = a[~empty].mean(0)
    return np.where(empty[..., None], a, mean + (a - mean) * t)


def ceres(root: Path):
    im = Image.open(root / 'ceres' / 'Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif')
    if im.mode != 'L':
        raise SystemExit(f'세레스: 8비트 흑백이 아님({im.mode})')
    a = np.asarray(im.resize((4096, 2048), Image.BOX), float)[..., None]
    a, frac = fill(a)
    a = np.roll(a, -a.shape[1] // 2, axis=1)
    print(f'세레스 {im.size} 메운 곳 {frac:.1%}')
    save(a[..., 0], 'ceres_2k.jpg')


def triton(root: Path):
    im = Image.open(root / 'triton' / 'Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif').convert('RGB')
    a = trim_edge(np.asarray(im.resize((4096, 2048), Image.BOX), float), 4)
    a, frac = fill(a)
    print(f'트리톤 {im.size} 메운 곳 {frac:.1%}')
    save(a, 'triton_2k.jpg')


def uranus_moon(root: Path, key: str):
    im = Image.open(root / 'uranusmoons' / (URA[key] + '.jpg'))
    if im.mode != 'L':
        raise SystemExit(f'{key}: 8비트 흑백이 아님({im.mode})')
    a = np.asarray(im, float)[..., None].copy()
    a[:, -1] = a[:, -2]  # 원본 5개 모두 맨 오른쪽 열이 이웃보다 26~36 어둡다 — 그대로 두면 경도 이음매에 세로선
    a = trim_edge(a, 3)
    a = fill_holes(a, empty_mask(a), HOLE_REACH)
    a = soften_edge(a, empty_mask(a), EDGE_BAND)
    a, frac = fill(a)
    print(f'{key} {im.size} 메운 곳 {frac:.1%}')
    # 1440×720 → 2048×1024 (원본보다 커지므로 부드럽게)
    big = Image.fromarray(np.clip(a[..., 0] + 0.5, 0, 255).astype(np.uint8)).resize((2048, 1024), Image.BICUBIC)
    from make_pluto import TEX
    big.convert('RGB').save(TEX / f'{key}_2k.jpg', quality=88, optimize=True, progressive=True)
    print(f'{key}_2k.jpg: {(TEX / (key + "_2k.jpg")).stat().st_size // 1024}KB')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    root = Path(sys.argv[1])
    keys = sys.argv[2:] or ['ceres', 'triton', *URA]
    for k in keys:
        if k == 'ceres':
            ceres(root)
        elif k == 'triton':
            triton(root)
        elif k in URA:
            uranus_moon(root, k)
        else:
            raise SystemExit(f'모르는 천체: {k}')
