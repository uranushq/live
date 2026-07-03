# PROJECT STATUS — @skybrush/live (Uranushq fork)

> 이 문서는 **프로젝트의 정체성과 현황을 기록하는 기준 문서**입니다.
> 커밋 분석 시 Claude가 이 문서를 컨텍스트로 참조합니다.
> 커밋별 상세 개발 이력은 [DEV_LOG.md](./DEV_LOG.md)를 참조하세요.
>
> 개요·아키텍처처럼 잘 안 바뀌는 부분은 안정적으로 유지하고,
> "진행 현황" 섹션만 주기적으로 갱신합니다.

---

## 1. 개요

- **프로젝트명**: `@skybrush/live` (Skybrush Live)
- **정체**: 드론 떼(드론 스웜)를 지휘하는 전문 **GCS(지상 관제국) 프론트엔드**
- **베이스**: `github.com/skybrush-io/live` (CollMot Robotics, GPL-3.0) 를 포크한 `github.com/uranushq/live`
- **개발 주체**: Uranushq (국내 팀) — 활발히 개발 중, 커밋 메시지 대부분 한국어
- **배포 형태**: 브라우저 웹(HTTP/HTTPS) + Electron 데스크톱 앱

## 2. 기술 스택

| 영역 | 사용 기술 |
|---|---|
| UI | React 18 (JSX/TS), Material-UI 7 |
| 상태관리 | Redux Toolkit + Redux-Saga + Redux-Persist |
| 지도(2D) | OpenLayers 10 (+ Mapbox/Bing/Mapzen 프로바이더) |
| 3D 시각화 | A-Frame 1.7 + Three.js |
| 통신 프로토콜 | Flockwave (Skybrush 표준), MAVLink 부분 지원 |
| 데스크톱 | Electron 39 |
| 폼 | React Final Form, @rjsf (JSON Schema Form) |
| 국제화 | i18next / react-i18next (영어·한국어) |
| 빌드 | Webpack 5 (dev-server, HMR) |
| 레이아웃 | Golden Layout (workbench 패널 시스템) |

## 3. 디렉토리 구조 (핵심)

```
src/
├── aframe/        # A-Frame 3D 컴포넌트 (드론 시각화)
├── algorithms/    # 최적화 알고리즘 (헝가리안 등)
├── components/    # 재사용 UI 컴포넌트
├── desktop/       # Electron 관련
├── features/      # 기능 모듈 (~47개, Redux slice 단위)
├── flockwave/     # Flockwave 프로토콜 (메시지 빌더/파서)
├── model/         # 데이터 모델 (UAV, 배터리, 지리, 정렬)
├── sagas/         # Redux-Saga 부수효과
├── selectors/     # Redux selectors
├── views/         # 화면 뷰 (~23개, three-d 포함)
└── workers/       # Web Workers
```

## 4. 주요 기능 영역

- **비행/미션 제어**: `mission`, `show`, `show-configurator`, `uav-control`, `uavs`
- **통신/서버**: `connections`, `servers`, `session`, `messages`
- **지도/지리**: `map`, `map-features`, `map-caching`, `saved-locations`
- **3D 시각화**: `three-d`, `aframe`
- **안전/관리**: `safety`, `preflight`, `geofence`(mission), `parameters`
- **LED/하드웨어**: `led-editor`, `light-control`, `beacons`
- **입력/부가**: `jr-control`(조이스틱), `rtk`, `mavlink`, `hotkeys`, `field-notes`
- **UI 프레임워크**: `workbench`, `sidebar`, `docks`, `detachable-panels`, `perspectives`
- **시스템**: `alert`, `snackbar`, `settings`, `version-check`, `upload`, `firmware-update`

## 5. 아키텍처 특징

- Feature 단위로 독립된 slice(reducer)/actions/selectors → 신규 기능 추가 용이
- Redux-Persist(Electron store)로 상태 영속화
- Flockwave 프로토콜 전담 계층 (빌더·파서·검증 내장)
- A-Frame 기반 WebGL 3D 렌더링 (실시간 드론 위치/경로/LED)

## 6. 진행 현황 (최근 방향)

> _마지막 갱신: 2026-07-03_

- **UI/UX 개선**: 제어 패널 재구성, 3D 뷰 이동 문제 해결, 패널 배치 개선
- **드론 명령 강화**: ARMING UI 보강, 착륙 상태 표시, 드론명 표시
- **쇼 기능**: 쇼 시작시간/타이머, 쇼 정보 업로드
- **드론 배치**: 3D 그리드 배치(Formation) 기능
- **Geofence**: 울타리 업로드 분리/수정
- **JR 컨트롤**: 조이스틱 컨트롤러 통합
- **LED 에디터**: 라이트쇼 편집 기능 업데이트
- **국제화**: 영/한 번역 지속 갱신

## 7. 규모/상태

- 코드 약 18,700줄, Feature 모듈 ~47개, 커밋 3,300+
- 현재 브랜치: `dev` (feature-branch → dev merge 협업)
- 상태: **활발한 개발 중** (거의 매일 커밋)
