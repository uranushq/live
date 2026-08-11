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

import {
  DEFAULT_ACCEL_SHAPE,
  DEFAULT_DECEL_SHAPE,
  clampShape,
  clampWidth,
  makeProfile,
  rampFromSmoothing,
} from './velocityProfile';

export const VELOCITY_SMOOTHING_STORAGE_KEY = 'pathPlanner.velocitySmoothing';
export const DEFAULT_VELOCITY_SMOOTHING = 1.0;

// 두 램프 폭의 합이 사실상 1이면 plateau가 사라진 것으로 본다.
const PLATEAU_EPSILON = 1e-6;

export { DEFAULT_ACCEL_SHAPE, DEFAULT_DECEL_SHAPE };

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

/**
 * 램프 모양(shape)과 폭(width) 전역 기본값.
 *
 * 백엔드의 `profile_accel_*` / `profile_decel_*`와 1:1 대응한다. 폭은 저장된
 * 값이 없으면 `null`로 두고 스무딩에서 유도한다 — 즉 슬라이더를 한 번도 만지지
 * 않은 사용자는 예전과 완전히 동일한 대칭 램프를 계속 쓴다. 슬라이더를 움직이는
 * 순간부터 그 값이 고정된다 (`resetProfileWidths()`로 다시 연동 상태로 돌아감).
 *
 * plateau(등속 유지) 폭은 따로 저장하지 않는다. 남는 값 `1 - a - b`가 곧
 * plateau이므로 폭 두 개가 단일 진실의 원천이다.
 */
export const PROFILE_ACCEL_SHAPE_STORAGE_KEY = 'pathPlanner.profileAccelShape';
export const PROFILE_DECEL_SHAPE_STORAGE_KEY = 'pathPlanner.profileDecelShape';
export const PROFILE_ACCEL_WIDTH_STORAGE_KEY = 'pathPlanner.profileAccelWidth';
export const PROFILE_DECEL_WIDTH_STORAGE_KEY = 'pathPlanner.profileDecelWidth';

const readRaw = (key) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeRaw = (key, value) => {
  try {
    if (value == null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, String(value));
    }
  } catch {
    // ignore: storage may be unavailable; the in-memory value still applies
  }
  notifyKnobListeners();
};

const readShape = (key, fallback) => clampShape(readRaw(key), fallback);

export const getProfileAccelShape = () =>
  readShape(PROFILE_ACCEL_SHAPE_STORAGE_KEY, DEFAULT_ACCEL_SHAPE);
export const getProfileDecelShape = () =>
  readShape(PROFILE_DECEL_SHAPE_STORAGE_KEY, DEFAULT_DECEL_SHAPE);

export const setProfileAccelShape = (value) => {
  const shape = clampShape(value, DEFAULT_ACCEL_SHAPE);
  writeRaw(PROFILE_ACCEL_SHAPE_STORAGE_KEY, shape);
  return shape;
};
export const setProfileDecelShape = (value) => {
  const shape = clampShape(value, DEFAULT_DECEL_SHAPE);
  writeRaw(PROFILE_DECEL_SHAPE_STORAGE_KEY, shape);
  return shape;
};

/** 저장된 폭이 없으면 스무딩에서 유도한다 (기존 동작 보존). */
const readWidth = (key) => {
  const raw = readRaw(key);
  if (raw == null || raw === '') return rampFromSmoothing(getVelocitySmoothing());
  return clampWidth(raw);
};

export const getProfileAccelWidth = () => readWidth(PROFILE_ACCEL_WIDTH_STORAGE_KEY);
export const getProfileDecelWidth = () => readWidth(PROFILE_DECEL_WIDTH_STORAGE_KEY);

/** 폭이 스무딩에 연동된 상태인지 (아직 직접 지정하지 않았는지) */
export const areProfileWidthsLinkedToSmoothing = () =>
  readRaw(PROFILE_ACCEL_WIDTH_STORAGE_KEY) == null &&
  readRaw(PROFILE_DECEL_WIDTH_STORAGE_KEY) == null;

/**
 * 한쪽 폭을 지정한다. 반대쪽이 아직 연동 상태였다면 현재 유도값으로 함께
 * 고정해서, 한쪽만 움직였는데 나머지가 나중에 슬그머니 바뀌는 일이 없게 한다.
 * 두 폭의 합은 1을 넘을 수 없으므로 반대쪽을 밀어내며 클램프한다.
 */
const setWidth = (key, otherKey, value) => {
  const clamped = clampWidth(value);
  if (readRaw(otherKey) == null) {
    writeRaw(otherKey, clampWidth(readWidth(otherKey)));
  }
  const other = clampWidth(readWidth(otherKey));
  if (clamped + other > 1) {
    writeRaw(otherKey, 1 - clamped);
  }
  writeRaw(key, clamped);
  return clamped;
};

export const setProfileAccelWidth = (value) =>
  setWidth(PROFILE_ACCEL_WIDTH_STORAGE_KEY, PROFILE_DECEL_WIDTH_STORAGE_KEY, value);
export const setProfileDecelWidth = (value) =>
  setWidth(PROFILE_DECEL_WIDTH_STORAGE_KEY, PROFILE_ACCEL_WIDTH_STORAGE_KEY, value);

/** 폭을 다시 스무딩 연동 상태로 되돌린다. */
export const resetProfileWidths = () => {
  writeRaw(PROFILE_ACCEL_WIDTH_STORAGE_KEY, null);
  writeRaw(PROFILE_DECEL_WIDTH_STORAGE_KEY, null);
};

/**
 * 현재 전역 노브에서 *실효* 프로파일을 만든다.
 *
 * plateau가 0으로 완전히 눌린 경우(양쪽 폭의 합이 1) 남는 등속 구간이 없으므로
 * 양쪽 램프를 `none`으로 고정한다 — 즉 구간 전체가 등속이 된다. 이 잠금 상태는
 * `plateauCollapsed`로 노출되어 UI가 shape/곡률 컨트롤을 비활성화할 수 있다.
 * 스무딩이 0인 경우도 같은 의미이므로 동일하게 처리한다.
 */
export const getVelocityProfile = () => {
  const smoothing = getVelocitySmoothing();
  const accelWidth = getProfileAccelWidth();
  const decelWidth = getProfileDecelWidth();
  const plateauCollapsed =
    smoothing <= 0 || accelWidth + decelWidth >= 1 - PLATEAU_EPSILON;

  const profile = plateauCollapsed
    ? makeProfile({ accelShape: 'none', decelShape: 'none' })
    : makeProfile({
        accelShape: getProfileAccelShape(),
        accelCurve: getProfileExp(),
        accelWidth,
        decelShape: getProfileDecelShape(),
        decelCurve: getProfileLog(),
        decelWidth,
      });

  return { ...profile, plateauCollapsed, smoothing };
};

/** 생성 요청 본문에 그대로 펼쳐 넣을 수 있는 프로파일 필드들. */
export const getVelocityProfileRequestFields = () => {
  const p = getVelocityProfile();
  return {
    velocity_smoothing: p.smoothing,
    profile_exp: getProfileExp(),
    profile_log: getProfileLog(),
    profile_accel_shape: p.accelShape,
    profile_accel_curve: p.accelCurve,
    profile_accel_width: p.accelWidth,
    profile_decel_shape: p.decelShape,
    profile_decel_curve: p.decelCurve,
    profile_decel_width: p.decelWidth,
  };
};
