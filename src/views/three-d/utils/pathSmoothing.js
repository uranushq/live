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

/** Persist a new global velocity-smoothing default (clamped to 0..1). */
export const setVelocitySmoothing = (value) => {
  const clamped = clamp01(value);
  try {
    window.localStorage.setItem(VELOCITY_SMOOTHING_STORAGE_KEY, String(clamped));
  } catch {
    // ignore: storage may be unavailable; the in-memory value still applies
  }
  return clamped;
};
