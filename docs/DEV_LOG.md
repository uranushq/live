# DEV LOG — 커밋별 진행 분석

> 커밋이 발생할 때마다 `.claude/hooks/commit-report.py`가 Claude(Opus)로 diff를
> 분석해 이 파일에 최신 항목을 맨 위에 추가합니다.
> 프로젝트 개요는 [PROJECT_STATUS.md](./PROJECT_STATUS.md)를 참조합니다.
> 아래 HTML 주석 마커 바로 다음 줄에 새 항목이 삽입되므로 마커는 지우지 마세요.

<!-- ENTRIES -->

## 2026-08-10 16:54:36 +0900 — `d9606b76` grid formation

_branch: dev · author: directorBae <bjw020615@gmail.com>_

**요약**: 3D 시뮬레이션 뷰에서 위성사진 바닥·다중 선택(Ctrl/Shift 클릭)과 이전 phase 위치를 참고로 보여주는 격자 배치(Grid Formation) 기능을 통합했다.

**주요 변경점**:
- `click-pick.js`: 선택 상태를 외부(ThreeDView)가 소유하는 `externalSelection` 모드 추가. 클릭 시 어떤 드론을 맞췄는지와 modifier(Ctrl/Cmd/Shift) 여부만 이벤트(`additive`)로 알리고, 하이라이트·토글 판단은 소유자가 처리. 토글 클릭 중 빈 곳을 눌러도 전체 선택이 날아가지 않도록 보정.
- `DroneSphereMarkers.jsx`: `selectedIds` prop을 받아 선택 드론을 빨간색(`SELECTED_BODY_COLOR`)으로 칠하고, 색상 캐시 key에 선택 상태를 반영. 구체 자체 레이캐스트에도 다중 선택(`additive`) 규칙 적용.
- `FormationGridModal.jsx`: 격자 편집 모달에 이전 phase(또는 현재 위치)를 회색 점(ghost dots)으로 깔아 이동 전/후를 시각화(라벨은 40대까지). 3D 뷰와 동일한 위성 사진 바닥(`GridSatelliteGround`) 렌더링.
- 신규 파일 `GridSatelliteGround.jsx`, `utils/satelliteTiles.js` 추가 및 `SatelliteMapGround.jsx` 리팩터링(153→상당 축소, 타일 로직 공용화 추정).
- `ThreeDView.jsx` 대폭 확장(+325줄): 선택 상태 소유·격자 배치 기능 배선.
- `DroneSelectPanel.jsx`: 패널 선택과 3D 뷰 클릭 선택이 동일 상태임을 안내(Ctrl·Shift 추가/해제) 문구 추가.

**의미/영향**: 앞선 `daeced48`(InstancedMesh 구 마커·시뮬레이션 최적화)에 이어, 시뮬레이션/Create 모드의 상호작용을 실제 편집 워크플로우로 완성하는 커밋이다. 다중 선택·기즈모 이동·격자 배치가 하나의 선택 상태로 묶이고, 위성사진 바닥·ghost 참고 레이어로 야외 쇼 배치의 공간감이 크게 개선된다. 위성 타일 로직을 유틸로 분리·공용화해 3D 뷰와 격자 모달이 같은 베이스맵을 공유하도록 정리한 점도 유지보수 측면에서 긍정적이다.

**주의/리스크**: 선택 소유권이 컴포넌트 로컬(live view)과 외부(ThreeDView Create 모드)로 이원화되어, 두 경로의 하이라이트/해제 규칙이 어긋나면 선택 상태 불일치가 생길 수 있다. 위성 타일 로드는 외부 타일 서버 의존·네트워크 비용이 있어 오프라인/타일 실패 시 폴백 처리가 필요하다. 이 diff만으로는 `SatelliteMapGround.jsx` 리팩터링이 기존 동작을 그대로 보존하는지, 격자 모달과 3D 뷰의 좌표 투영(`proj`)이 완전히 일치하는지는 확인 불가.

---


## 2026-08-07 22:09:25 +0900 — `daeced48` 최적화

_branch: dev · author: directorBae <bjw020615@gmail.com>_

**요약**: 시뮬레이션 3D 뷰의 드론 렌더링을 InstancedMesh 구(sphere)로 최적화하고, 관성 속도 프로파일 시각화 차트를 추가했다.

**주요 변경점**:
- `DroneSphereMarkers.jsx`: 시뮬레이션 모드에서 드론별 OBJ 모델 대신 하나의 InstancedMesh(구) + 단일 드로우콜로 렌더링해 100+ 대도 성능 유지. 구 색상은 LED 쇼 프레임(`computePlaybackFrame`)에서 파생되어 이미지 임포트 색을 반영하며, 플레이헤드/쇼 변경 시에만 갱신.
- `VelocityProfileChart.jsx`: chart.js(react-chartjs-2) 기반으로 관성 모델의 속도 프로파일(지수 ease-in / 로그 ease-out)을 smoothing 값에 따라 실시간으로 그리는 인터랙티브 차트 추가.
- `utils/velocityProfile.js`: 속도 프로파일 샘플링·두께(k) 계산 등 차트의 수식 유틸.
- 세 파일 모두 신규 추가(총 489줄), 기존 코드 수정·삭제는 없음.

**의미/영향**: 대규모 드론 스웜 시뮬레이션에서 per-drone OBJ 모델·포인트 라이트로 인한 렌더링 부하를 인스턴싱으로 크게 낮춰, 3D 뷰의 실시간성과 확장성을 개선한다. 기존 저작(authoring) 모드는 OBJ 마커를 그대로 쓰고 시뮬레이션 모드에서만 구 마커를 사용하므로 기존 워크플로우와 병존한다. LED 쇼·속도 프로파일과의 연동으로 3D 시각화(three-d)와 LED 에디터 기능이 한층 통합되는 방향을 이어간다.

**주의/리스크**: 구 마커는 `MeshBasicMaterial`(무조명) 기반이라 기존 OBJ 모델과 음영·외형이 달라 시각적 표현이 단순화된다. LED 상태를 `store.subscribe`로 매번 검사하므로 구독 콜백 비용이 있으나 key 비교로 실제 갱신은 최소화했다. 신규 파일만 추가되어 실제 뷰에 배선(연결)되었는지, chart.js 의존성이 번들에 포함되는지는 이 diff만으로는 확인 불가.

---


## 2026-08-07 15:50:38 +0900 — `85b993e6` Merge branch 'dev' of https://github.com/uranushq/live into dev

_branch: dev · author: directorBae <bjw020615@gmail.com>_

**요약**: dev 브랜치 병합 커밋으로, 드론 그룹 관리·가상 UAV·3D 대형 배치(이미지/모델→점군)·파라미터 뷰어·쇼 시작 제어 등 다수 신규 기능이 한꺼번에 통합됐다.

**주요 변경점**:
- **drone-groups 신규 모듈**: 명명된 UAV 그룹 편집 다이얼로그 + slice/actions/selectors/types 추가 (드론 그룹화·선택 체계 도입)
- **virtual-uavs 신규 모듈**: 가상 UAV 제어 패널·헤더 버튼·유틸(`virtualUavs.ts`) 추가 (실기체 없이 시뮬레이션/테스트 지원 추정)
- **3D 대형 배치 강화**: `FormationGridModal`(2039줄), `ImageToDotsModal`(729줄), `imageToDots.js`/`modelToDots.js` 추가로 이미지·3D 모델을 드론 점군 대형으로 변환
- **파라미터 뷰어 확장**: `ParameterViewerPanel` 대폭 개편(다기체 비교·mismatch/편집 표시·검색·필터·일괄 쓰기), 관련 i18n 키 대량 추가
- **쇼 시작 제어 개편**: `ShowStartReadinessUpdater`, `ShowStartPermissionDialog`, `DroneSelectionButtons`, `PreflightStartStrip`/`ShowTimerOverlay`/`LargeControlButtonGroup` 재작업
- **드론 시각화 정리**: `drone-flock`·UAV 소스/모델(`uav.ts`) 손질, 구형 카메라 마우스 패치 제거, 영/한 번역 갱신

**의미/영향**: 개요의 "드론 배치(Formation)"·"드론 명령 강화"·"쇼 기능" 방향을 크게 진전시킨 병합으로, 3D 대형 생성과 다기체 파라미터 운용, 그룹 기반 선택이라는 실운용 편의 기능이 대거 들어왔다. 약 8,700줄 추가 규모로 여러 feature 브랜치가 dev에 통합된 대형 마일스톤 성격이며, 가상 UAV 도입은 실기체 없는 개발·데모 검증 여건을 넓힌다.

**주의/리스크**: 단일 병합에 대형 신규 파일(2000줄대 모달 등)이 다수 포함돼 리뷰·회귀 테스트 부담이 크고, 쇼 시작 제어·프리플라이트 흐름이 광범위하게 재작업되어 실제 비행 개시 로직의 검증이 필요하다.

---


## 2026-08-07 15:29:41 +0900 — `bf4010f7` live path directing

_branch: dev · author: directorBae <bjw020615@gmail.com>_

**요약**: 소스 코드 변경 없이 이전 커밋(`e090d963`)에 대한 개발 로그 항목을 `docs/DEV_LOG.md`에 추가한 문서 전용 커밋이다.

**주요 변경점**:
- `docs/DEV_LOG.md`에 `e090d963 "live path directing"` 커밋 분석 항목 18줄 추가(요약·주요 변경점·의미·리스크 형식)
- 추가된 내용은 파라미터 뷰어(parameterViewerDialog) 영어 번역 키 대량 삭제 및 Toolbox `paramViewer` 메뉴 제거 이력을 기록
- 기능·UI 코드는 일절 변경 없음(문서 1개 파일, +18줄)

**의미/영향**: 커밋별 개발 이력을 자동/반자동으로 축적하는 DEV_LOG 워크플로가 실제로 돌아가고 있음을 보여주는 이력 관리성 커밋이다. 프로젝트 기능 자체에는 영향이 없으며, 직전에 이루어진 "파라미터 조회·비교" 기능 정리(번역/진입점 제거) 작업의 흔적을 문서로 남긴 것에 불과하다. 개요의 "거의 매일 커밋" 상태를 유지하는 루틴한 문서 갱신에 해당한다.

**주의/리스크**: 커밋 메시지 "live path directing"이 실제 diff 내용(개발 로그 추가)과 무관해, 여러 커밋에 동일·모호한 메시지가 반복되면 이력 추적이 어려워질 수 있으므로 메시지 규칙 정비를 권장한다. 또한 로그에 기록된 대로 삭제된 번역 키(`columnName`, `matchedToast` 등)를 코드가 여전히 `t()`로 참조하는지, ko.json 등 타 로케일과의 키 정합성은 실제 소스에서 별도 확인이 필요하다.

---


## 2026-08-07 15:29:07 +0900 — `e090d963` live path directing

_branch: dev · author: directorBae <bjw020615@gmail.com>_

**요약**: 파라미터 뷰어(parameterViewerDialog)의 영어 번역 키를 title 하나만 남기고 대량 삭제한 정리성 커밋.

**주요 변경점**:
- `parameterViewerDialog` 하위 번역 키 ~40개 제거(컬럼명, 필터, 토스트, 상태문구 등), `title`만 유지
- Toolbox 메뉴의 `paramViewer`("Parameter viewer") 항목 제거
- `en.json` 단일 파일만 변경(1줄 추가, 40줄 삭제)

**의미/영향**: 최근 추가되던 "파라미터 조회·비교(Parameter viewer)" 기능(직전 커밋 40df2099 계열)의 UI 진입점과 번역 리소스를 걷어낸 것으로, 해당 기능을 롤백/비활성화하거나 재작업하기 위한 정리로 보인다. 커밋 메시지 "live path directing"과 실제 변경 내용(파라미터 뷰어 번역 제거)이 일치하지 않아, 다른 작업 중 함께 정리된 부수 변경일 가능성이 높다.

**주의/리스크**: 코드에서 여전히 삭제된 키(`columnName`, `matchedToast` 등)를 `t()`로 참조 중이라면 런타임에 번역 누락(raw key 노출)이 발생할 수 있음. 또한 en.json만 수정되어 ko.json 등 다른 로케일과의 키 정합성 점검 필요. 커밋 메시지와 diff 불일치도 이력 추적 관점에서 확인 권장.

---


## 2026-07-03 17:02:30 +0900 — `0be314b2` commit report mailing 기능

_branch: dev · author: directorBae <bjw020615@gmail.com>_

**요약**: git 커밋마다 diff를 Claude(Opus)로 분석하고 결과를 메일로 발송 + DEV_LOG.md에 누적하는 커밋 리포트 자동화 훅을 도입했다.

**주요 변경점**:
- `.claude/hooks/commit-report.py`(286줄) 신설 — post-commit(git-hook) 및 Claude Code hook 두 모드 지원, git으로 커밋한 모든 경우를 커버
- SMTP로 커밋 요약 메일 발송, `COMMIT_ANALYZE` 옵션 시 Claude 헤드리스(`claude -p`)로 diff를 분석해 마크다운 리포트 생성
- 비밀정보는 `.claude/commit-report.env`(gitignore 처리)에서 로드, 커밋 가능한 예시 파일 `commit-report.env.example` 제공
- 분석 결과를 `docs/DEV_LOG.md`의 `<!-- ENTRIES -->` 마커 아래에 최신순으로 누적, 프로젝트 기준 문서 `docs/PROJECT_STATUS.md` 신설

**의미/영향**: 제품 코드(src/)가 아닌 개발 프로세스·문서화 인프라를 강화한 커밋으로, 활발한 매일 커밋 흐름에서 진행 이력을 자동으로 기록·공유하는 체계를 마련했다. PROJECT_STATUS.md와 DEV_LOG.md 도입으로 프로젝트 현황 추적과 커밋별 맥락 파악이 표준화된다.

**주의/리스크**: `__pycache__/*.pyc` 바이너리가 함께 커밋되어 gitignore 대상으로 정리하는 편이 좋다. 또한 훅이 커밋마다 Claude(Opus) 분석(최대 240초)과 외부 메일 발송을 수행하므로 지연·비용이 발생할 수 있으나, 모든 실패 경로에서 exit 0으로 커밋 흐름을 막지 않도록 안전하게 설계되어 있다.

---


## 2026-07-02 18:10:06 +0900 — `ed34d35a` 관성 path

_branch: dev · author: directorBae <bjw020615@gmail.com>_

**요약**: 3D 뷰의 경로 애니메이션에 속도 스무딩(가감속) 옵션을 추가하고, 일시정지 시 드론이 제자리에서 멈추도록 개선했다.

**주요 변경점**:
- `pathSmoothing.js` 유틸 신설 — 속도 스무딩 값을 localStorage에 영속화하고 여러 모달·패널이 공통으로 공유(get/setVelocitySmoothing)
- `PathControlPanel`, `PathGeneratorModal`, `FormationBuilderModal` 세 곳에 스무딩 조절 UI(슬라이더+숫자입력) 추가, 경로 요청 페이로드에 `velocity_smoothing` 파라미터 전달
- `drone-move-bridge.js`에 `drone-path-stop` 이벤트 핸들러 추가 — 일시정지 시 진행 중인 경로/요(yaw) 애니메이션을 취소해 드론을 현재 위치에 고정
- 세그먼트 애니메이션 이징을 `easeInOutQuad` → `linear`로 변경(경로 자체의 속도 프로파일이 이미 가감속을 포함하므로 중복 이징으로 인한 끊김 제거)
- `skycExportUtils.js`에 스무딩/관성 관련 로직 대폭 보강(+169줄)

**의미/영향**: 기존 3D 그리드 배치(Formation)·경로 생성 기능 위에 "관성/가감속" 제어 레이어를 얹어, 등속 이동뿐 아니라 코너에서 감속하거나 부드럽게 출발·정지하는 현실적인 비행 궤적을 시뮬레이션할 수 있게 됐다. 특히 진행바(React 시계)와 A-Frame 애니메이션 간 불일치로 일시정지해도 드론이 계속 움직이던 버그를 잡아, 3D 프리뷰의 재생 제어 정확도가 높아졌다. 쇼 편집 워크플로에서 skyc 익스포트까지 스무딩이 반영되는 방향으로 확장되는 흐름이다.

**주의/리스크**: 스무딩 값이 localStorage 전역 공유·기본값이므로 한 화면에서 바꾼 설정이 다른 경로 생성에도 일괄 적용되어 사용자가 의도치 않은 값으로 경로를 만들 수 있다. 또한 `velocity_smoothing` 파라미터를 서버(path-planner) API가 실제로 해석해야 효과가 나므로 백엔드 지원 여부에 의존한다.

---
