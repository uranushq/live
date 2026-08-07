/**
 * Shared "velocity smoothing" default for path generation.
 *
 * This is a single global default (NOT a per-path setting): every path-planner
 * generation request (PathGeneratorModal, FormationBuilderModal) reads the same
 * value and sends it to the backend as `velocity_smoothing`. Adjusting it from
 * any of those places updates the one shared default, which is persisted to
 * localStorage so it survives restarts.
 *
 * Meaning of the value (0..1), matching the path-planner backend:
 *   0   → old behaviour: constant velocity, abrupt start/stop at every waypoint.
 *   >0  → speed ramps smoothly to/from zero at the start, end and every hold.
 *   →1  → additionally slows down more at direction-change corners
 *         (1 = full stop at each corner). The flight path (geometry) is
 *         unchanged; only the speed profile along it changes.
 */

export const VELOCITY_SMOOTHING_STORAGE_KEY = 'pathPlanner.velocitySmoothing';
export const DEFAULT_VELOCITY_SMOOTHING = 1.0;

const clamp01 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VELOCITY_SMOOTHING;
  return Math.min(1, Math.max(0, n));
};

/** Return the current global velocity-smoothing default (0..1). */
export const getVelocitySmoothing = () => {
  try {
    const raw = window.localStorage.getItem(VELOCITY_SMOOTHING_STORAGE_KEY);
    if (raw == null) return DEFAULT_VELOCITY_SMOOTHING;
    return clamp01(raw);
  } catch {
    return DEFAULT_VELOCITY_SMOOTHING;
  }
};

// 같은 값을 보여주는 UI가 여러 곳(재생바, formation 탭, 모달들)이라
// setter가 저장 후 구독자에게 알린다 — localStorage 'storage' 이벤트는
// 같은 탭 안에서는 발화하지 않으므로 자체 알림이 필요하다.
const knobListeners = new Set();

const notifyKnobListeners = () => {
  for (const listener of [...knobListeners]) {
    try {
      listener();
    } catch {
      // ignore: one broken listener must not block the others
    }
  }
};

/**
 * 스무딩/곡률 값이 어디서든 바뀔 때 호출될 리스너를 등록한다.
 * 해제 함수를 반환한다.
 */
export const subscribeSmoothingKnobs = (listener) => {
  knobListeners.add(listener);
  return () => knobListeners.delete(listener);
};

/** Persist a new global velocity-smoothing default (clamped to 0..1). */
export const setVelocitySmoothing = (value) => {
  const clamped = clamp01(value);
  try {
    window.localStorage.setItem(VELOCITY_SMOOTHING_STORAGE_KEY, String(clamped));
  } catch {
    // ignore: storage may be unavailable; the in-memory value still applies
  }
  notifyKnobListeners();
  return clamped;
};

/**
 * 관성 프로파일 램프 곡률 (exp 가속 / log 감속) 전역 기본값.
 * 백엔드의 `profile_exp` / `profile_log`와 1:1 대응하며, 스무딩과 같은
 * 방식으로 localStorage에 저장되어 모든 생성 요청이 공유한다.
 * 범위는 converter._THICKNESS_MIN/MAX와 일치해야 한다.
 */
export const PROFILE_EXP_STORAGE_KEY = 'pathPlanner.profileExp';
export const PROFILE_LOG_STORAGE_KEY = 'pathPlanner.profileLog';
export const PROFILE_THICKNESS_MIN = 0.05;
export const PROFILE_THICKNESS_MAX = 4.0;
export const DEFAULT_PROFILE_EXP = 2.0;
export const DEFAULT_PROFILE_LOG = 2.0;

const clampThickness = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(PROFILE_THICKNESS_MAX, Math.max(PROFILE_THICKNESS_MIN, n));
};

const readThickness = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return clampThickness(raw, fallback);
  } catch {
    return fallback;
  }
};

const writeThickness = (key, value, fallback) => {
  const clamped = clampThickness(value, fallback);
  try {
    window.localStorage.setItem(key, String(clamped));
  } catch {
    // ignore
  }
  notifyKnobListeners();
  return clamped;
};

export const getProfileExp = () =>
  readThickness(PROFILE_EXP_STORAGE_KEY, DEFAULT_PROFILE_EXP);
export const setProfileExp = (value) =>
  writeThickness(PROFILE_EXP_STORAGE_KEY, value, DEFAULT_PROFILE_EXP);
export const getProfileLog = () =>
  readThickness(PROFILE_LOG_STORAGE_KEY, DEFAULT_PROFILE_LOG);
export const setProfileLog = (value) =>
  writeThickness(PROFILE_LOG_STORAGE_KEY, value, DEFAULT_PROFILE_LOG);
