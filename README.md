# 태양계

COSMIC TRAIL(다른 선생님 작품)의 **태양계 부분만** 떼어 새로 구현하는 3D 웹앱. 수업용(학생이 직접 조작).
원본 분석과 범위는 `원본분석.md`. 원본 사본은 `참고/`(git 제외, 참고용 — 코드·그림을 옮기지 않는다).

## 지금 상태

완료·화면 승인 (2026-11-21~23). 테스트 548개 통과(`npm test`). 수치 대조는 각 테스트와 `textures/출처.md`. 저장소 `chan7881/solar_system`(공개).

- **화면 틀:** 실제 비율 · 행성 8 · 시간 조작(1800~2050) · 이름표 · 날아가기 · 왼쪽 사이드바 · 레이어 창 · 별자리 · 「전체 보기」
- **자세:** 전 천체 IAU 2015 + 계별 주기 항. 모두 Horizons 직하점과 대조 테스트(히페리온만 보기용 회전)
- **지도·모양:** 행성·달·위성·왜행성·혜성 핵 지도/모양 완료(천왕성·해왕성 띠만·태양 표면은 단색)
- **토성 고리:** Cassini 자료로 비침·그림자 (`src/rings_glsl.js`)
- **위성 22개 · 소천체:** 달은 ELP, 나머지는 Horizons 맞춘 식. 왜행성·혜성·점 무리(소행성대·힐다·트로이·카이퍼대·오르트)
- **혜성:** 활동량·이온·먼지 꼬리·코마 (`src/comets.js`). 한계: 고리는 혜성 꼬리를 가리지 않는다
- **도구:** 「도구」 단추 → 거리 재기 · 크기 비교 · 궤도 보기 · 최소·최대 거리
- **지구:** 밤 불빛 · 대기 가장자리 빛 · 구름(2026-11-23 완료, 「대기」 스위치와 연동)
- **해왕성 대흑점(2026-11-23 완료):** 1989년 모습 고정 무늬 레이어(`src/main.js`·`textures/neptune_gds_2k.png`, `tools/make_neptune_gds.py`). 테스트 545개 통과
- **그림자 레이어(2026-11-23):** 레이어 창 「표시」에 「그림자」 체크(처음 켬). 끄면 토성 그림자(고리 위)·고리 그림자(토성 위)가 없어지고 **모든 천체의 밤면이 N·L=0.5 밝기까지 밝아진다**(`main.js` `uShadowOn`·`flatU`, 몸체 공통 패치와 지구 구름 껍질). 지구 구름 그림자는 건드리지 않음(사용자 결정). 토성·지구에서 켬/끔 화면 비교 확인. 커밋 `c66c09f`
- **궤도 보기 주기(2026-11-23 완료·화면 승인):** 이심률 줄에 공전 주기 — 1년 이상 년, 1년 미만 일, 1일 미만 시간(소수점 넷째). 케플러 제3법칙, 태양 둘레는 태양+행성계 GM(`orbit.js` `orbitPeriodYears`·`periodText`). 관측 항성 공전 주기 35개와 대조 테스트(`tests/orbit.test.mjs`, 허용 오차 0.01~1.2%), 테스트 548개 통과
- **태양 렌즈 효과 · 햇빛 노출:** 후광·유령·베일, 1/r² 노출(초점 천체 기준). 행성 여러 개가 한 화면에 든 장면은 아직 안 봄

## 남은 일

기능 항목은 시안·계획을 승인받은 뒤 진행한다. 해왕성 대흑점은 4-1~4-3 모두 완료(아래 4번은 기록).

1. **왜행성 세부 묘사:** 하우메아·마케마케·에리스(단색). 관측 논문 확인 후 밝기·색으로 근사 — 시안부터
2. **세부 묘사 후보:** 태양 가장자리 어두워짐(문헌 계수 또는 JSOC FITS) · 히페리온 지도 여부 · 이아페투스 명암 보정 · 천왕성 위성 북반구·트리톤 북쪽(자료 한계) · 세레스 색(자료 없음)
3. **하지 않기로 함(사용자 결정):** 천왕성 세부 묘사
4. **해왕성 대흑점(2026-11-23 결정 변경 · 승인 내역 확정):** PIA00046(Voyager 2, 1989)의 GDS-89를 띠 지도 위에 얹는 무늬 레이어로. 경도는 사진에서 보이는 위치 그대로, 1989년 모습으로 고정. 위도 약 −22°(17~27°S), 크기 약 13,000×6,600km. 1996년 이전에 사라짐(NASA APOD 1996).
   - 4-1 **사진에서 무늬 뽑기:** ✅ 만듦·**위치 확인 그림 승인 대기**. `tools/make_neptune_gds.py` → `textures/neptune_gds_2k.png`(RGBA 2048×1024, 띠 지도와 같은 배치, 86KB). 사진 가운데 경도 = 동경 −76.4°(Horizons 서경 76.4°, 1989-08-20 08:00 UT — 사진 설명 「근접 통과 4일 20시간 전」에서, ±1시간이면 ±22°). 뽑힌 대흑점: 위도 −11~−25°(중심 −18°, 구면 기준)·동경 −135~−101°(중심 −117°) = 서경 약 243° · 크기 약 13,500×6,000km(문헌 13,000×6,600km과 맞음). 문헌 중심 −22°보다 약 3° 북쪽(범위 17~27°S 안). 창은 동경 −150~−88°·위도 −32~−4°(가장자리 부드럽게) — 오른쪽 흰 줄무늬는 창 끝에서 잘림. 확인 그림 `원본/neptune/check_gds.png`(사진 | 띠 지도+무늬 | 띠 지도만, 같은 시점)
   - 4-2 **레이어 붙이기:** `src/main.js` 해왕성 구에 무늬 레이어 추가. 띠 지도는 그대로 둔다 — ✅ 붙임(4-1 승인 2026-11-23). `main.js` 「해왕성 대흑점 무늬 레이어」: 해왕성 재질 `onBeforeCompile`에서 `map_fragment` 뒤에 `mix(띠 색, 무늬 색, 알파)`. 시각 고정이라 시간을 돌려도 같은 자리. 앱에서 1989-08-20 08:00 UT에 보는 위도·경도 방향으로 맞춰 보니 사진과 같은 자리·같은 기울기로 뜸. 레이어 창 스위치는 아직 없음(요청 시)
   - 4-3 **검사:** 무늬 위치가 사진과 맞는지 테스트·확인 그림. 변이 검사(무늬 위치를 틀리게 했을 때 실패하는지) 포함 — ✅ `tests/neptune_gds.test.mjs`(+`gds_check.mjs`·`horizons_neptune_gds.txt`): 무늬의 대흑점을 사진 투영 화소로 바꿔 사진에서 직접 잰 자리(313.6, 462.5)와 12화소 안, 크기(6600×13000km 둘레), 창 밖 알파 0. 변이 검사 — 경도·위도 ±5~30° 옮긴 복제본·동경 부호 뒤집기가 실패함. 한계: 셰이더(`main.js`)는 테스트 밖 — 앱 화면은 1989-08-20 08:00 UT 시점에서 눈으로 확인

## 얼개

| 파일 | 무엇 |
|---|---|
| `index.html` · `src/style.css` | 화면 틀. three.js는 `vendor/three/`(r170, 받아 둔 사본 — 인터넷 없이 돈다) |
| `src/ephemeris.js` | 행성 위치(Standish 궤도 요소, 1800~2050) · 반지름 · 궤도선 점 · 자세(IAU 2015, NAIF pck00011). three.js 없는 순수 함수 |
| `src/main.js` | 장면 · 카메라 날아가기(물러나기→옮겨가기→다가가기) · 이름표 · 시간 조작 · 토성 고리 셰이더 |
| `src/tools.js` | 거리·빛 시간·지름·배율 문구, 크기 비교 배치(`compareLayout`), 선 위 글자 자리(`visibleMid`) — 순수 함수(`tests/tools.test.mjs`). 화면은 `main.js` 「도구」 |
| `src/extremes.js` · `src/extremes_worker.js` | 두 천체 최소·최대 거리와 그때 위치(1800~2050). `absPos`는 `main.js updatePositions`와 같은 식이라 한쪽을 고치면 둘 다 |
| `src/orbit.js` · `tools/fetch_orbit_check.py` | 궤도 보기 — 그 시각 궤도·장반경·단반경·근점·원점·카메라 방향·화면 맞추기(순수 함수). 대조 자료 `tests/horizons_orbit.json`은 스크립트가 받는다(원본 `원본/orbit/`, git 밖). 화면은 `main.js` 「궤도 보기」 |
| `src/atmosphere.js` · `tools/make_nightlights.py` | 지구 밤 불빛 세기(`nightWeight`)·대기 가장자리 빛(`rimGlow`)과 같은 식의 GLSL, 시험용 `sunMu`. 질감 `textures/earth_night_2k.jpg`(원본 `원본/nightlights/`, git 밖). 화면은 `main.js` 「지구 밤 불빛·대기」 |
| `src/nav.js` | 사이드바 분류(태양·행성+위성·기타)·시간 빠르기 칸·문구·레이어 목록과 천체 표시 판정 — 순수 함수(`tests/nav.test.mjs`) |
| `tools/make_constellations.py` | 별자리 선·이름(d3-celestial, BSD-3) → `textures/constellations.json`. 원본은 `원본/const/`(git 밖, 주소는 스크립트 머리) |
| `src/moons.js` · `src/moon_fits.js` | 위성 목록·위치(달은 ELP 주요 항, 나머지는 맞춘 식)·질량중심 보정. `moon_fits.js`는 `tools/fit_moons.py`가 만든다(손으로 고치지 않음) |
| `tools/fetch_moons.py` · `tools/fit_moons.py` | Horizons 위성 자료 받기(`원본/moons/`, git 밖 · 서버가 자주 끊겨 `rev`로 두 벌 병렬) → 평균 궤도 식 맞추기(따로 둔 반 칸 밀린 자료로 오차 보고 · `python tools/fit_moons.py 607`처럼 ID를 주면 그 위성만 다시 맞춤 — 히페리온 약 3분) |
| `src/shapes.js` · `tools/make_shapes.py` | 포보스·데이모스·히페리온 모양 파일(`textures/<이름>_shape.bin`) 읽기 — 천체 고정 (x,y,z) → 몸체 (x,z,−y). 카메라 근접 한계·이름표 가림은 평균 반지름이 아니라 `SHAPE_REACH`(가장 먼 점, 모양을 다시 뽑으면 맞출 것). 원본 OBJ는 `원본/phobos`·`원본/deimos`(git 밖) |
| `src/smallbodies.js` · `src/sb_elements.js` · `tools/fetch_smallbodies.py` | 왜행성·혜성 위치(Horizons 요소 1년 간격, `sb_elements.js`는 스크립트가 만든다) · 점 무리(`textures/small_bodies.bin`, SBDB) 위치와 공명 무리 처리 · 오르트 구름 모형. 다시 받기: `python tools/fetch_smallbodies.py [points] [elements] [check]` |
| `src/rings.js` · `tools/make_rings.py` | 고리 단면(`textures/saturn_rings.json`)·밝기·비침·그림자·밉맵의 순수 함수. 원본 엄폐 자료는 `원본/rings/`(git 밖) |
| `src/rings_glsl.js` | 고리 셰이더 식(GLSL 문자열) — `rings.js`와 같은 식. 스칼라 연산·vec 생성자·dot·length·.x/.y/.z만 써야 테스트가 JS로 옮겨 대조한다(벡터 사칙연산을 쓰면 테스트가 깨진다) |
| `textures/` · `tools/make_textures.py` · `tools/make_saturn.py` · `tools/make_venus.py` · `tools/make_titan.py` | 표면 지도 2K JPG와 출처(`textures/출처.md`). 원본(수백 MB)은 git 밖 — 주소는 출처.md, 줄이기는 스크립트 |
| `src/comets.js` · `tools/make_comets.py` | 혜성 활동량·이온 꼬리 방향·먼지 알갱이(케플러)·코마 크기 — 순수 함수(`tests/comets.test.mjs`), 화면은 `main.js` 「혜성 코마·꼬리」. 핵 모양 파일(원본 `원본/67p`·`원본/halley`, git 밖) |
| `tools/make_saturnmoons.py` | 토성 위성 6개 지도(원본은 `원본/saturnmoons/`, git 밖 · `check` 인자로 분화구 겹친 확인 그림) |
| `tools/make_galilean.py` | 갈릴레이 위성 지도(원본은 `원본/galilean/`, git 밖 · 주소는 `textures/출처.md` · 지도마다 왼쪽 끝 경도를 지형으로 확인한 값) |
| `tools/make_smallworlds.py` · `tools/make_neptune.py` · `tools/fetch_rot_smallworlds.py` | 세레스·트리톤·천왕성 위성 5개 지도(원본 `원본/ceres`·`triton`·`uranusmoons`, git 밖 · 경도 배치 확인은 스크립트 머리) · 해왕성 위도 띠(`원본/neptune`) · 이들의 자세 검사 기준값을 Horizons에서 받기(`tests/smallworlds_rot.test.mjs`) |
| `tools/make_pluto.py` | 명왕성·카론 지도(원본은 `원본/pluto/`, git 밖 · 주소는 `textures/출처.md`) |
| `tests/` | `npm test` — 토성 위성 자세(`horizons_saturnmoons_rot.txt`·`_vec.txt`, 태양·토성 중심) · 갈릴레이 위성 자세(`horizons_galilean_rot.txt`·`_vec.txt`, 태양·목성 중심) · 명왕성·카론 자세·마주 보는 점(`horizons_pluto_rot.txt`·`_vec.txt`) · — 포보스·데이모스 자세는 Horizons 직하점(`horizons_marsmoons_rot.txt`·`_vec.txt`), 모양은 부피·축·스티크니 자리(`shapes.test.mjs`) · 달 자세는 Horizons 원판 가운데·태양 직하점(`horizons_moon_rot.txt`) · JPL Horizons 값(`horizons_raw.txt`, 8행성×4날짜)과 방향·거리·z 부호, 공전 방향, 좌표 변환 · 위성은 Horizons(`horizons_moons.txt`, 20개×4날짜)·지구-질량중심 거리·공전 방향(트리톤만 역행) · 타이탄 자세는 Horizons 원판 가운데·태양 직하점(`horizons_titan_rot.txt`)과 Horizons 위치(`horizons_titan_vec.txt`) · 자세는 Horizons 태양 직하점(`horizons_subsolar.txt`), 자전 방향, 자전축 기울기, 토성 고리면 통과 |

- **카메라가 늘 원점을 보는 것은 아니다** — 궤도 보기가 `controls.target`(바라보는 점)과 `camera.up`을 옮긴다. 거리는 `camera.position.distanceTo(controls.target)`으로 잰다. `camera.up`을 바꾸면 OrbitControls의 `_quat`도 함께 고친다(`setUp`).
- 실행: 폴더에서 `python serve.py`(캐시를 꺼서 브라우저가 옛 모듈을 붙잡지 않는다) → `http://127.0.0.1:8731/` (파일을 직접 열면 모듈이 안 뜬다)
- 단위는 km, **초점 천체가 원점**. 위치는 JS 배정밀도로 계산해 그리기 직전에 초점 위치를 뺀다. 궤도선은 행성 기준 상대 좌표.
- 자동 확인용 `window.__app`(state · step · draw · flyTo · camera · bodies).

## 결정된 것

- 원본 코드·그림을 복사하지 않는다 — 다른 선생님 작품이라서. 수치·그림은 1차 출처(JPL·NASA)에서.
- **크기·거리는 늘 실제 비율** — 「보기 좋은 크기」 모드를 두지 않는다(Eyes 방식, 2026-11-21 사용자 결정). 작은 천체는 이름표·동그라미로 찾는다.
- **별 배경은 넣지 않는다**(2026-11-21 사용자 결정).
- **딸린 활동(퀴즈·몸무게 계산 등)은 넣지 않는다** — 태양계의 모습을 보이는 시뮬레이션에만 집중(2026-11-21 사용자 결정).

## 함정

- **IAU 북극 ≠ 자전 벡터.** IAU 북극은 불변면 북쪽에 있는 극이라 금성·천왕성은 자전 벡터(오른손)와 반대다. 자전축 기울기(천왕성 97.8°)는 자전 벡터로 잰다.
- Horizons 직하점은 **측지 위도**이고 경도는 순행 천체가 서경+(타이탄도), 금성·지구·천왕성·달은 동경+ — 받은 파일 머리글의 `{West-longitude positive}`를 본다. 태양에서 보면 광행시만큼 앞선 행성이다.
- 지도는 **가운데 = 경도 0°, 동쪽이 오른쪽**이어야 그대로 맞는다. **USGS 라벨의 경도 방향·가운데 경도를 믿지 말고 지형으로 확인한다**(타이탄 라벨은 서경+·가운데 180°인데 실제 배치는 왼쪽 끝 0°·동쪽이 오른쪽 · 명왕성 300m 모자이크는 태그가 가운데 0°인데 실제는 가운데 180°). 목성 PIA07782는 축 눈금이 서경(180…0…330…180)이지만 배치는 같다. 다른 규약의 원본은 `make_textures.py`에서 돌려 맞춘다.
- 구의 방향: SphereGeometry는 u=0.5가 +X, u가 커지면 −Z 쪽이다 → +X=경도 0°, −Z=동경 90°, +Y=북극(three.js로 확인함).

- 먼 천체는 투영한 z가 반올림돼 정확히 1이 된다 → 「카메라 앞인가」를 `z < 1`로 보면 이름표가 다 사라진다. 카메라 좌표의 z 부호로 본다.
- 고리 τ 질감을 GPU 자동 밉맵에 맡기면 안 된다 — τ를 그대로 평균해 간극이 메워지고, R16F는 모바일에서 자동 생성이 실패해 고리가 조용히 사라질 수 있다. 투과율로 평균한 단계를 CPU에서 넣는다.
- **JPL 위성 평균 궤도 요소표(sats/elem)는 쓰지 마라** — 주기 자릿수가 모자라고 공명 흔들림(미마스 ±43°, 70.7년)이 없어 수십 년이면 수십° 틀린다. 궤도면이 도는 주기가 자료 기간(250년)보다 긴 위성(트리톤·타이탄·이아페투스·칼리스토)은 FFT로 안 잡혀 `fit_complex`에서 낮은 주파수를 직접 훑는다.
- Horizons 트리톤 자료는 1800-01-02부터, 카론(명왕성 중심)은 01-04부터다(`fetch_moons.py` 첫 구간을 늦춤). `fit_moons.py` 전체가 약 37분 걸린다.
- **Horizons의 3축 타원체 천체(포보스·데이모스) 위도**는 「중심 방향 광선이 3축 타원체와 만나는 점의, 회전 타원체(a,a,c) 기준 측지 위도(고도 포함)」다 — 경도는 중심 경도 그대로. 납작해서 반복 계산이 천천히 모인다(30번이면 0.0008° 남음). 화성 중심에서 본 값에는 화성 공전 속도의 광행차(약 0.005°)가 들어 있다.
- **지구-화성 최소 거리는 앱 안에서 2003년이 아니라 1924년이 나온다** — Standish 요소로 2003-08-27이 5,580만km(Horizons 5,576만km, 약 3.8만km 큼)라 1924-08-22(5,576만km)가 근소하게 앞선다. 계산 방법이 아니라 행성 위치 정밀도 문제.
- 해왕성은 Standish 오차가 공표값(10″)보다 크게 나온다(실측 최대 45″). 테스트 허용치는 실측의 약 2배.
- **공명 소천체(트로이·힐다)를 접촉 궤도 요소의 평균 운동으로 돌리면 수십 년 만에 무리가 흩어진다** — 접촉 a가 공명 둘레로 흔들려 평균 운동이 최대 7~9% 다르다. 목성 평균 운동(트로이 1배·힐다 3/2배)으로 돌린다.
- Horizons 혜성은 `DES=1P; CAP;`처럼 지금에 가장 가까운 궤도 해를 고른다. 이 해로 1800~2050년을 적분한 요소를 쓴다(핼리 1835·1910 근일점도 0.11° 안).
