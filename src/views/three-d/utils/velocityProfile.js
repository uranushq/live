/**
 * Exponential-in / plateau / logarithmic-out (trapezoid) velocity profile.
 *
 * This is a faithful JS port of the path-planner backend
 * (`src/flockwave/server/ext/path_planner/converter.py`, the `_log_profile`
 * block). Keeping it in sync matters so the in-app velocity-profile GRAPH
 * renders the real flown speed curve.
 *
 * Model (normalized segment time τ ∈ [0, 1], entry speed v0, exit speed v1,
 * ramp fraction a per side, curvatures kₑ / kₗ > 0):
 *
 *     v(τ) = v0 + (vc − v0)·E(τ/a; kₑ)        τ ∈ [0, a]      (exp ramp)
 *          = vc                                τ ∈ [a, 1−a]    (plateau)
 *          = v1 + (vc − v1)·L((1−τ)/a; kₗ)    τ ∈ [1−a, 1]    (log ramp)
 *
 *     E(u; k) = (e^{k·u} − 1)/(e^{k} − 1)
 *     L(u; k) = ln(1 + (e^{k} − 1)·u)/k
 *
 * The plateau speed vc is solved in closed form so arc(1) == length exactly
 * (knot times never move). There is no pointy apex: the profile's maximum IS
 * the constant plateau. Rest-to-rest with equal curvatures: vc = v_avg/(1−a).
 */

// Ramp fraction of the segment per side, scaled by the smoothing knob.
// Matches converter._RAMP_HALF_MIN / _RAMP_HALF_MAX.
export const RAMP_HALF_MIN = 0.1;
export const RAMP_HALF_MAX = 0.4;

// Curvature (thickness) bounds. Matches converter._THICKNESS_MIN / MAX.
export const THICKNESS_MIN = 0.05;
export const THICKNESS_MAX = 4.0;

// Default ramp curvatures. Matches converter.DEFAULT_PROFILE_EXP / LOG.
export const DEFAULT_PROFILE_EXP = 2.0;
export const DEFAULT_PROFILE_LOG = 2.0;

/** Map the smoothing knob in [0, 1] to the per-side ramp fraction. */
export const rampFromSmoothing = (smoothing) => {
  const s = Math.min(1, Math.max(0, Number(smoothing) || 0));
  return RAMP_HALF_MIN + s * (RAMP_HALF_MAX - RAMP_HALF_MIN);
};

/** Clamp a ramp curvature knob into the supported range. */
export const clampThickness = (k) =>
  Math.max(THICKNESS_MIN, Math.min(THICKNESS_MAX, Number(k) || THICKNESS_MIN));

/** Exponential ease-in basis: 0 → 1, convex (gentle start). */
export const easeInExp = (u, k) => Math.expm1(k * u) / Math.expm1(k);

/** Logarithmic ease-out basis: 0 → 1, concave (gentle finish). */
export const easeOutLog = (u, k) => Math.log1p(Math.expm1(k) * u) / k;

/** ∫₀^x E(u; k) du in closed form. */
export const easeInExpIntegral = (x, k) =>
  (Math.expm1(k * x) / k - x) / Math.expm1(k);

/** ∫₀^x L(u; k) du in closed form. */
export const easeOutLogIntegral = (x, k) => {
  const c = Math.expm1(k);
  const cx = c * x;
  return (((1 + cx) * Math.log1p(cx)) / c - x) / k;
};

/** Closed-form plateau speed vc making the profile cover `avg` exactly. */
export const plateauSpeed = (v0, v1, avg, ramp, kExp, kLog) => {
  const a = ramp;
  const b = ramp;
  const ie = easeInExpIntegral(1, kExp);
  const il = easeOutLogIntegral(1, kLog);
  const denom = a * ie + (1 - a - b) + b * il;
  return (avg - a * v0 * (1 - ie) - b * v1 * (1 - il)) / denom;
};

/**
 * Speed and arc-length functions of one eased (trapezoid) segment over
 * τ ∈ [0, 1]. `arc(1) === length` exactly.
 */
export const logProfile = (v0, v1, length, dt, kExp, kLog, ramp) => {
  const avg = length / dt;
  const a = ramp;
  const b = ramp;
  const vc = plateauSpeed(v0, v1, avg, ramp, kExp, kLog);
  const ie = easeInExpIntegral(1, kExp);
  const il = easeOutLogIntegral(1, kLog);
  const areaA = a * (v0 + (vc - v0) * ie);

  const speed = (tau) => {
    if (tau <= 0) return v0;
    if (tau < a) return v0 + (vc - v0) * easeInExp(tau / a, kExp);
    if (tau <= 1 - b) return vc;
    if (tau < 1) return v1 + (vc - v1) * easeOutLog((1 - tau) / b, kLog);
    return v1;
  };

  const arc = (tau) => {
    if (tau <= 0) return 0;
    if (tau >= 1) return length;
    let s;
    if (tau < a) {
      s = v0 * tau + (vc - v0) * a * easeInExpIntegral(tau / a, kExp);
    } else if (tau <= 1 - b) {
      s = areaA + vc * (tau - a);
    } else {
      s =
        areaA +
        vc * (1 - a - b) +
        v1 * (tau - (1 - b)) +
        (vc - v1) * b * (il - easeOutLogIntegral((1 - tau) / b, kLog));
    }
    return s * dt;
  };

  return { speed, arc };
};

/** Peak speed of the profile (ramps are monotone → closed form). */
export const logProfilePeak = (v0, v1, length, dt, kExp, kLog, ramp) => {
  const vc = plateauSpeed(v0, v1, length / dt, ramp, kExp, kLog);
  return Math.max(Math.abs(v0), Math.abs(v1), Math.abs(vc));
};

/**
 * Peak/average ratio of a rest-to-rest eased segment (the plateau factor).
 * Matches converter._ease_peak_factor.
 */
export const peakFactor = (smoothing, kExp, kLog) => {
  if (!(smoothing > 0)) return 1;
  return plateauSpeed(0, 0, 1, rampFromSmoothing(smoothing), kExp, kLog);
};

/**
 * Sample the *normalized* speed profile (v_avg == 1) for plotting. Returns
 * `nSamples + 1` points `{ t, v }` with t ∈ [0, 1]. `v0`/`v1` are given as
 * fractions of cruise (0 = rest); the default 0 → 0 case is a rest-to-rest
 * move whose maximum is the flat plateau.
 */
export const sampleProfile = (
  smoothing,
  kExp,
  kLog,
  { v0 = 0, v1 = 0, nSamples = 120 } = {}
) => {
  const ramp = rampFromSmoothing(smoothing);
  const { speed } = logProfile(
    v0,
    v1,
    1,
    1,
    clampThickness(kExp),
    clampThickness(kLog),
    ramp
  );
  const out = [];
  for (let i = 0; i <= nSamples; i += 1) {
    const t = i / nSamples;
    out.push({ t, v: speed(t) });
  }
  return out;
};
