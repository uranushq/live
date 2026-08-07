/**
 * Exponential-in / logarithmic-out velocity profile.
 *
 * This is a faithful JS port of the path-planner backend
 * (`src/flockwave/server/ext/path_planner/converter.py`, the `_log_profile`
 * block). Keeping it in sync matters for two things:
 *
 *   1. the in-app velocity-profile GRAPH renders the real flown speed curve, and
 *   2. the local `.skyc` patch (`skycExportUtils.applyVelocitySmoothingToPoints`)
 *      produces the same Bézier keyframes the server would.
 *
 * Model (normalized segment time τ ∈ [0, 1], entry speed v0, exit speed v1,
 * thickness k > 0):
 *
 *     v(τ) = v0·(1−τ) + v1·τ + C·B(τ; k)
 *     B(τ; k) = E(2τ; k)       for τ ≤ ½   (exponential rise, gentle start)
 *             = L(2(1−τ); k)   for τ ≥ ½   (logarithmic fall, gentle finish)
 *     E(u; k) = (e^{k·u} − 1)/(e^{k} − 1)
 *     L(u; k) = ln(1 + (e^{k} − 1)·u)/k
 *     C       = 2·v_avg − (v0 + v1),   v_avg = length/dt
 *
 * E and L are inverse functions, so ∫₀¹ B dτ = ½ for every k. That makes
 * arc(1) == length exactly (knot times never move) and the rest-to-rest peak
 * exactly 2·v_avg, independent of the thickness.
 */

// Bézier pieces per eased segment when rendering the profile. Matches
// converter._LOG_SUBDIVISIONS.
export const LOG_SUBDIVISIONS = 4;

// Thickness (k) range. Matches converter._MAX_THICKNESS / _MIN_THICKNESS.
export const MAX_THICKNESS = 2.0;
const MIN_THICKNESS = 1e-3;

/** Map the smoothing knob in [0, 1] to the profile thickness k > 0. */
export const thicknessFromSmoothing = (smoothing) => {
  const s = Math.min(1, Math.max(0, Number(smoothing) || 0));
  return Math.max(MIN_THICKNESS, s * MAX_THICKNESS);
};

/** Exponential ease-in basis: 0 → 1, convex (gentle start). */
export const easeInExp = (u, k) => Math.expm1(k * u) / Math.expm1(k);

/** Logarithmic ease-out basis: 0 → 1, concave (gentle finish). */
export const easeOutLog = (u, k) => Math.log1p(Math.expm1(k) * u) / k;

/** Asymmetric speed bump: exp rise on [0, ½], log fall on [½, 1]. */
export const bump = (tau, k) =>
  tau <= 0.5 ? easeInExp(2 * tau, k) : easeOutLog(2 * (1 - tau), k);

/** Composite Simpson quadrature (deterministic). */
const simpson = (fn, lo, hi, intervals) => {
  const h = (hi - lo) / intervals;
  let total = fn(lo) + fn(hi);
  for (let i = 1; i < intervals; i += 1) {
    total += fn(lo + i * h) * (i % 2 ? 4 : 2);
  }
  return (total * h) / 3;
};

/** ∫₀^τ B(u; k) du — integrated per smooth half so the kink at ½ is a panel edge. */
const bumpIntegral = (tau, k) => {
  if (tau <= 0) return 0;
  if (tau <= 0.5) return simpson((u) => bump(u, k), 0, tau, 64);
  return (
    simpson((u) => bump(u, k), 0, 0.5, 64) +
    simpson((u) => bump(u, k), 0.5, tau, 64)
  );
};

/**
 * Speed and arc-length functions of one eased segment over τ ∈ [0, 1].
 * `arc(1) === length` exactly (bump area is ½ for every k).
 */
export const logProfile = (v0, v1, length, dt, k) => {
  const avg = length / dt;
  const c = 2 * avg - (v0 + v1);
  const speed = (tau) => v0 * (1 - tau) + v1 * tau + c * bump(tau, k);
  const arc = (tau) =>
    (v0 * (tau - 0.5 * tau * tau) +
      v1 * (0.5 * tau * tau) +
      c * bumpIntegral(tau, k)) *
    dt;
  return { speed, arc };
};

/** Peak speed of the profile (dense deterministic sampling). */
export const logProfilePeak = (v0, v1, length, dt, k, samples = 32) => {
  const { speed } = logProfile(v0, v1, length, dt, k);
  let peak = 0;
  for (let i = 0; i <= samples; i += 1) {
    peak = Math.max(peak, speed(i / samples));
  }
  return peak;
};

/**
 * Cubic-Bézier control distances along a sub-segment line encoding the
 * entry/exit speeds (matches converter._control_distances). Clamped monotonic.
 */
export const controlDistances = (v0, v1, length, dt) => {
  let d1 = (v0 * dt) / 3;
  let d2 = length - (v1 * dt) / 3;
  d1 = Math.max(0, Math.min(d1, length));
  d2 = Math.max(0, Math.min(d2, length));
  if (d2 < d1) {
    d1 = 0.5 * (d1 + d2);
    d2 = d1;
  }
  return [d1, d2];
};

/**
 * Sample the *normalized* speed profile (v_avg == 1) for plotting. Returns
 * `nSamples + 1` points `{ t, v }` with t ∈ [0, 1]. `v0`/`v1` are given as
 * fractions of cruise (0 = rest, 1 = cruise); the default 0 → 0 case is a
 * rest-to-rest move, whose peak is 2× the average.
 */
export const sampleProfile = (k, { v0 = 0, v1 = 0, nSamples = 120 } = {}) => {
  const { speed } = logProfile(v0, v1, 1, 1, k);
  const out = [];
  for (let i = 0; i <= nSamples; i += 1) {
    const t = i / nSamples;
    out.push({ t, v: speed(t) });
  }
  return out;
};
