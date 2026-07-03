# DEV LOG — 커밋별 진행 분석

> 커밋이 발생할 때마다 `.claude/hooks/commit-report.py`가 Claude(Opus)로 diff를
> 분석해 이 파일에 최신 항목을 맨 위에 추가합니다.
> 프로젝트 개요는 [PROJECT_STATUS.md](./PROJECT_STATUS.md)를 참조합니다.
> 아래 HTML 주석 마커 바로 다음 줄에 새 항목이 삽입되므로 마커는 지우지 마세요.

<!-- ENTRIES -->

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
