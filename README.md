# 태양계

COSMIC TRAIL(다른 선생님 작품)의 **태양계 부분만** 떼어 새로 구현하는 3D 웹앱. 수업용(학생이 직접 조작).
원본 분석과 범위는 `원본분석.md`, 이력은 `이력.md`. 원본 사본은 `참고/`(git 제외, 참고용 — 코드·그림을 옮기지 않는다).

## 지금 상태

완료·화면 승인. 테스트 560개 통과(`npm test`). 수치 대조는 각 테스트와 `textures/출처.md`. 저장소 `chan7881/solar_system`(공개). 기능별 완료 기록과 잰 값은 `이력.md`.

- **화면 틀:** 실제 비율 · 행성 8 · 시간 조작(1800~2050) · 이름표 · 날아가기 · 사이드바 · 레이어 창 · 별자리 · 「전체 보기」
- **자세:** 전 천체 IAU 2015 + 계별 주기 항, Horizons 직하점 대조(히페리온만 보기용 회전)
- **지도·모양:** 행성·달·위성·왜행성·혜성 핵 완료(천왕성·해왕성 띠만·태양 표면 단색). 해왕성 대흑점은 1989년 고정 무늬 레이어
- **토성 고리 · 그림자:** Cassini 자료로 비침·그림자(`src/rings_glsl.js`). 레이어 「그림자」를 끄면 고리·토성 그림자가 없어지고 밤면이 밝아진다(지구 구름 그림자는 그대로 — 사용자 결정)
- **위성 22개 · 소천체 · 혜성:** 달은 ELP, 나머지는 Horizons 맞춘 식. 혜성 꼬리·코마(`src/comets.js`) — 한계: 고리는 혜성 꼬리를 가리지 않는다
- **도구:** 거리 재기 · 크기 비교 · 궤도 보기(공전 주기 포함) · 최소·최대 거리
- **왜행성:** 세 왜행성 색을 관측값으로, 하우메아 자세·고리(`src/dwarfs.js`). 한계: 고리→몸체 그림자 없음, 몸체 색에 pV를 램버트 반사율로 넣어 원판 평균이 실제의 약 2/3
- **지구 · 태양:** 밤 불빛 · 대기 빛 · 구름. 태양 렌즈 효과·1/r² 노출 — 행성 여러 개가 한 화면에 든 장면은 아직 안 봄
- **선형 합성(2026-11-27):** 본 장면을 `sceneRT`에 선형으로 그려 반투명이 빛 세기로 섞인다(토성·하우메아 고리 `on = L + T·off` 오차 0.0009·0.0017, `tools/check_blend.js`). 표시용 선·점은 예전 밝기 유지(`uiAlpha`), 구름 지도는 선형 분리로 다시 뽑음
- **구름 지도 끊김 수정(2026-11-27):** 햇빛 반사 띠는 NOAA21로 바꿈(띠 자리 구름값 초과 0.148→0.030) · 경도 180° 이음매는 다음 날 영상으로 165~180°를 서서히(양 끝 열 차이/이웃 열 차이 2.7→1.1) · 위도 62~70° 위는 이틀×두 위성 평균(밝기·눈얼음 거르기)으로 네모 조각 없앰(`tools/make_clouds.py`)

- **태양 가장자리 어두워짐·흑점(2026-11-27):** 주연감광 `src/sun.js`(Allen 550nm 2차식, 화면에서 0.9R 0.652·0.98R 0.480 — 식 0.662·0.476). 렌즈 효과 후광은 원반이 커지면 0까지(`flare.js` `BLOOM_NEAR_MIN`=0, 레이어는 켠 채 — 사용자 결정) → 기본 태양 보기(4.3R)에서 후광 0. 흑점은 SDO/HMI HMIIF 2024-04-27~05-23 매일 1장 합성 고정 무늬(`tools/make_sunspots.py` → `textures/sun_spots_2k.jpg`, 원본 `원본/sun/` git 밖). 배치 확인 `tools/check_sunspots.py`: 정면 띠 상관 흑점 있는 날 0.90~0.98, 좌우 뒤집은 변이 0.02. 밝기는 JPEG 영점 I0=0.2로 선형 복원 — 흑점은 실제 비율대로 회색 그대로 두고, 흑점 켜고 끄기 스위치는 만들지 않음(사용자 결정)

- **이아페투스 명암·정반사 끔(2026-11-27):** 지도를 명암이 남은 Cassini PIA18436 밝기로 바꿈(`tools/make_iapetus.py`) — 어두운 쪽 중심/밝은 쪽 반사율 비를 1차 출처 약 1/10에 맞춤(저장한 지도 0.101, 밝은 쪽 밝기는 예전 그대로). 모든 천체의 정반사(F0=0.04, 반사율과 상관없이 약 0.009를 더함)를 꺼 램버트만 남김(사용자 결정) — 화면 보름 위상 정중앙 비 0.117(지도 0.114), 켠 채로는 0.171. 밝은 천체는 약 6% 어두워짐

## 남은 일

기능 항목은 시안·계획을 승인받은 뒤 진행한다.

1. **목성형 행성 고리(추가):** 목성·천왕성·해왕성 고리. 하우메아처럼 τ·I/F를 1차 출처로 정하고 테스트로 되살린 뒤 화면 화소로 비침·밝기를 잰다. 너무 옅어 안 보이면 궤도 표시처럼 「고리 강조」 레이어 옵션 — 시안부터
2. **세부 묘사(승인됨 2026-11-27):** 히페리온 지도 여부 · 천왕성 위성 북반구·트리톤 북쪽(자료 한계) · 세레스 색(자료 없음)
3. **하지 않기로 함(사용자 결정):** 천왕성 세부 묘사

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
| `src/dwarfs.js` | 왜행성 색·하우메아 고리 값(순수 함수). 화면은 `main.js` 「하우메아 자세·고리」 |
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
| `tools/make_saturnmoons.py` | 토성 위성 5개 지도 — 이아페투스는 아래 `make_iapetus.py`(원본은 `원본/saturnmoons/`, git 밖 · `check` 인자로 분화구 겹친 확인 그림) |
| `tools/make_iapetus.py` | 이아페투스 지도 — PIA18436 밝기를 L = K·v^G로(어두운/밝은 비 0.10, 밝은 쪽은 예전 지도 값). 원본 `원본/saturnmoons/PIA18436.tif`(git 밖) · `check` 인자로 분화구 겹친 그림 |
| `tools/make_galilean.py` | 갈릴레이 위성 지도(원본은 `원본/galilean/`, git 밖 · 주소는 `textures/출처.md` · 지도마다 왼쪽 끝 경도를 지형으로 확인한 값) |
| `tools/make_smallworlds.py` · `tools/make_neptune.py` · `tools/fetch_rot_smallworlds.py` | 세레스·트리톤·천왕성 위성 5개 지도(원본 `원본/ceres`·`triton`·`uranusmoons`, git 밖 · 경도 배치 확인은 스크립트 머리) · 해왕성 위도 띠(`원본/neptune`) · 이들의 자세 검사 기준값을 Horizons에서 받기(`tests/smallworlds_rot.test.mjs`) |
| `tools/make_pluto.py` | 명왕성·카론 지도(원본은 `원본/pluto/`, git 밖 · 주소는 `textures/출처.md`) |
| `src/sun.js` · `tools/make_sunspots.py` · `tools/check_sunspots.py` | 태양 주연감광 식(JS·GLSL, `tests/sun.test.mjs`) · 흑점 지도 만들기(Horizons 정면 경도로 27장 합성)·되돌려 대조. 화면은 `main.js` `limbDarken`·흑점 지도 |
| `tests/` | `npm test` — Horizons·관측값 대조와 방향·부호. 대조 자료(`horizons_*.txt`·`.json`)와 기준은 각 테스트 파일 머리 |

- **카메라가 늘 원점을 보는 것은 아니다** — 궤도 보기가 `controls.target`(바라보는 점)과 `camera.up`을 옮긴다. 거리는 `camera.position.distanceTo(controls.target)`으로 잰다. `camera.up`을 바꾸면 OrbitControls의 `_quat`도 함께 고친다(`setUp`).
- 실행: 폴더에서 `python serve.py`(캐시를 꺼서 브라우저가 옛 모듈을 붙잡지 않는다) → `http://127.0.0.1:8731/` (파일을 직접 열면 모듈이 안 뜬다)
- 단위는 km, **초점 천체가 원점**. 위치는 JS 배정밀도로 계산해 그리기 직전에 초점 위치를 뺀다. 궤도선은 행성 기준 상대 좌표.
- 자동 확인용 `window.__app`(state · step · draw · flyTo · camera · bodies).

## 결정된 것

- 원본 코드·그림을 복사하지 않는다 — 다른 선생님 작품이라서. 수치·그림은 1차 출처(JPL·NASA)에서.
- **크기·거리는 늘 실제 비율** — 「보기 좋은 크기」 모드를 두지 않는다(Eyes 방식, 사용자 결정). 작은 천체는 이름표·동그라미로 찾는다.
- **별 배경은 넣지 않는다**(사용자 결정).
- **딸린 활동(퀴즈·몸무게 계산 등)은 넣지 않는다** — 태양계의 모습을 보이는 시뮬레이션에만 집중(사용자 결정).

## 함정

자세·위성·Horizons·고리 셰이더·카메라 좌표의 함정은 **`함정.md`** — 그 부분을 만지기 전에 Read.
