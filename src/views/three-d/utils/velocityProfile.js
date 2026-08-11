/**
 * Ramp / plateau / ramp (trapezoid) velocity profile.
 *
 * This is a faithful JS port of the path-planner backend
 * (`src/flockwave/server/ext/path_planner/converter.py`, the `_speed_profile`
 * block). Keeping it in sync matters so the in-app velocity-profile GRAPH and
 * the local .skyc patch render the real flown speed curve.
 *
 * Model over normalized segment time τ ∈ [0, 1], entry speed v0, exit speed
 * v1, accel-ramp width a, decel-ramp width b:
 *
 *     v(τ) = v0 + (vc − v0)·A(τ/a; k_a)        τ ∈ [0, a]      (accel ramp)
 *          = vc                                 τ ∈ [a, 1−b]    (plateau)
 *          = v1 + (vc − v1)·D((1−τ)/b; k_d)    τ ∈ [1−b, 1]    (decel ramp)
 *
 * Each ramp picks its basis independently:
 *
 *     exp:    B(u; k) = (e^{k·u} − 1)/(e^{k} − 1)   convex, gentle at u=0
 *     log:    B(u; k) = ln(1 + (e^{k} − 1)·u)/k     concave, steep at u=0
 *     linear: B(u; k) = u
 *     none:   no ramp — the side's width is pinned to 0
 *
 * The decel ramp evaluates its basis at u = (1−τ)/b, i.e. u runs BACKWARDS in
 * time (u=0 is the arrival knot). So an "exp" decel ramp is gentle *at
 * arrival* while a "log" decel ramp brakes hardest at arrival.
 *
 * The plateau speed vc is solved in closed form so arc(1) === length exactly
 * (knot times never move) for any combination of shapes and widths. There is
 * no pointy apex: the profile's maximum IS the constant plateau.
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

// Selectable ramp shapes. Matches converter.RAMP_SHAPES.
export const RAMP_SHAPES = ['exp', 'log', 'linear', 'none'];

// Historical defaults: exponential acceleration, logarithmic deceleration.
export const DEFAULT_ACCEL_SHAPE = 'exp';
export const DEFAULT_DECEL_SHAPE = 'log';

/** Human-readable labels for the shape picker. */
export const RAMP_SHAPE_LABELS = {
  exp: '지수 (exp)',
  log: '로그 (log)',
  linear: '일차 (linear)',
  none: '없음 (등속)',
};

/** Map the smoothing knob in [0, 1] to the per-side ramp fraction. */
export const rampFromSmoothing = (smoothing) => {
  const s = Math.min(1, Math.max(0, Number(smoothing) || 0));
  return RAMP_HALF_MIN + s * (RAMP_HALF_MAX - RAMP_HALF_MIN);
};

/** Clamp a ramp curvature knob into the supported range. */
export const clampThickness = (k) =>
  Math.max(THICKNESS_MIN, Math.min(THICKNESS_MAX, Number(k) || THICKNESS_MIN));

/** Clamp one ramp's width fraction into [0, 1]. */
export const clampWidth = (w) => {
  const n = Number(w);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};

/** Normalize a ramp shape name, falling back on anything unrecognized. */
export const clampShape = (shape, fallback) => {
  const name = String(shape ?? '')
    .trim()
    .toLowerCase();
  return RAMP_SHAPES.includes(name) ? name : fallback;
};

// ── ramp bases ───────────────────────────────────────────────────────────

/** Exponential basis: 0 → 1, convex (gentle at u = 0). */
export const easeInExp = (u, k) => Math.expm1(k * u) / Math.expm1(k);

/** Logarithmic basis: 0 → 1, concave (steep at u = 0). */
export const easeOutLog = (u, k) => Math.log1p(Math.expm1(k) * u) / k;

/** Linear basis: 0 → 1, constant slope. `k` is ignored. */
export const easeLinear = (u) => u;

/** ∫₀^x E(u; k) du in closed form. */
export const easeInExpIntegral = (x, k) =>
  (Math.expm1(k * x) / k - x) / Math.expm1(k);

/** ∫₀^x L(u; k) du in closed form. */
export const easeOutLogIntegral = (x, k) => {
  const c = Math.expm1(k);
  const cx = c * x;
  return (((1 + cx) * Math.log1p(cx)) / c - x) / k;
};

/** ∫₀^x u du in closed form. `k` is ignored. */
export const easeLinearIntegral = (x) => 0.5 * x * x;

// Basis + closed-form integral per shape. `none` is never evaluated (its width
// is pinned to 0) but maps to the linear pair so a stray lookup cannot throw.
const RAMP_BASES = {
  exp: [easeInExp, easeInExpIntegral],
  log: [easeOutLog, easeOutLogIntegral],
  linear: [easeLinear, easeLinearIntegral],
  none: [easeLinear, easeLinearIntegral],
};

// ── profile ──────────────────────────────────────────────────────────────

/**
 * Normalize a profile description. Shapes fall back to the defaults if
 * unrecognized, curvatures clamp to [THICKNESS_MIN, THICKNESS_MAX], widths
 * clamp to [0, 1] and shrink proportionally if they would leave the plateau
 * negative. A shape of `none` pins its side's width to 0.
 *
 * Mirrors `VelocityProfile.__post_init__` on the backend.
 */
export const makeProfile = ({
  accelShape = DEFAULT_ACCEL_SHAPE,
  accelCurve = DEFAULT_PROFILE_EXP,
  accelWidth = RAMP_HALF_MAX,
  decelShape = DEFAULT_DECEL_SHAPE,
  decelCurve = DEFAULT_PROFILE_LOG,
  decelWidth = RAMP_HALF_MAX,
} = {}) => {
  const aShape = clampShape(accelShape, DEFAULT_ACCEL_SHAPE);
  const dShape = clampShape(decelShape, DEFAULT_DECEL_SHAPE);
  let a = aShape === 'none' ? 0 : clampWidth(accelWidth);
  let b = dShape === 'none' ? 0 : clampWidth(decelWidth);
  const total = a + b;
  if (total > 1) {
    a /= total;
    b /= total;
  }
  return {
    accelShape: aShape,
    accelCurve: clampThickness(accelCurve),
    accelWidth: a,
    decelShape: dShape,
    decelCurve: clampThickness(decelCurve),
    decelWidth: b,
    plateauWidth: Math.max(0, 1 - a - b),
    isConstant: a <= 0 && b <= 0,
  };
};

/**
 * Build a profile whose widths default to the smoothing knob — the
 * backward-compatible symmetric exp-in / log-out shape.
 */
export const profileFromSmoothing = (smoothing, overrides = {}) => {
  const ramp = rampFromSmoothing(smoothing);
  return makeProfile({ accelWidth: ramp, decelWidth: ramp, ...overrides });
};

/** Closed-form plateau speed vc making the profile cover `avg` exactly. */
export const plateauSpeedFor = (v0, v1, avg, profile) => {
  const { accelWidth: a, decelWidth: b } = profile;
  const ia = RAMP_BASES[profile.accelShape][1](1, profile.accelCurve);
  const id = RAMP_BASES[profile.decelShape][1](1, profile.decelCurve);
  const denom = a * ia + (1 - a - b) + b * id;
  if (denom <= 1e-12) return avg;
  return (avg - a * v0 * (1 - ia) - b * v1 * (1 - id)) / denom;
};

/**
 * Speed and arc-length functions of one eased segment over τ ∈ [0, 1].
 * `arc(1) === length` exactly. A zero-width side is skipped entirely: the
 * segment then starts (or ends) at the plateau speed instead of v0 (or v1).
 */
export const speedProfile = (v0, v1, length, dt, profile) => {
  const avg = length / dt;
  const { accelWidth: a, decelWidth: b } = profile;
  const [basisA, integralA] = RAMP_BASES[profile.accelShape];
  const [basisD, integralD] = RAMP_BASES[profile.decelShape];
  const ka = profile.accelCurve;
  const kd = profile.decelCurve;
  const vc = plateauSpeedFor(v0, v1, avg, profile);
  const ia = integralA(1, ka);
  const id = integralD(1, kd);
  const areaA = a * (v0 + (vc - v0) * ia);

  const speed = (tau) => {
    if (tau <= 0) return a > 0 ? v0 : vc;
    if (a > 0 && tau < a) return v0 + (vc - v0) * basisA(tau / a, ka);
    if (tau <= 1 - b) return vc;
    if (tau < 1) return v1 + (vc - v1) * basisD((1 - tau) / b, kd);
    return b > 0 ? v1 : vc;
  };

  const arc = (tau) => {
    if (tau <= 0) return 0;
    if (tau >= 1) return length;
    let s;
    if (a > 0 && tau < a) {
      s = v0 * tau + (vc - v0) * a * integralA(tau / a, ka);
    } else if (tau <= 1 - b) {
      s = areaA + vc * (tau - a);
    } else {
      s =
        areaA +
        vc * (1 - a - b) +
        v1 * (tau - (1 - b)) +
        (vc - v1) * b * (id - integralD((1 - tau) / b, kd));
    }
    return s * dt;
  };

  return { speed, arc };
};

/**
 * Peak speed of the profile (the ramps are monotone → closed form). Endpoint
 * speeds only count on sides that actually ramp.
 */
export const profilePeak = (v0, v1, length, dt, profile) => {
  let peak = Math.abs(plateauSpeedFor(v0, v1, length / dt, profile));
  if (profile.accelWidth > 0) peak = Math.max(peak, Math.abs(v0));
  if (profile.decelWidth > 0) peak = Math.max(peak, Math.abs(v1));
  return peak;
};

/** Peak/average ratio of a rest-to-rest eased segment (the plateau factor). */
export const profilePeakFactor = (profile) =>
  profile.isConstant ? 1 : plateauSpeedFor(0, 0, 1, profile);

/**
 * Sample the *normalized* speed profile (v_avg === 1) for plotting. Returns
 * `nSamples + 1` points `{ t, v }` with t ∈ [0, 1]. `v0`/`v1` are fractions of
 * cruise (0 = rest); the default rest-to-rest case peaks at the flat plateau.
 */
export const sampleProfileCurve = (
  profile,
  { v0 = 0, v1 = 0, nSamples = 140 } = {}
) => {
  const { speed } = speedProfile(v0, v1, 1, 1, profile);
  const out = [];
  for (let i = 0; i <= nSamples; i += 1) {
    const t = i / nSamples;
    out.push({ t, v: speed(t) });
  }
  return out;
};

// ── backward-compatible symmetric exp-in / log-out entry points ──────────
// Kept so callers that still speak (kExp, kLog, ramp) keep working unchanged.

const symmetricProfile = (kExp, kLog, ramp) =>
  makeProfile({
    accelShape: DEFAULT_ACCEL_SHAPE,
    accelCurve: kExp,
    accelWidth: ramp,
    decelShape: DEFAULT_DECEL_SHAPE,
    decelCurve: kLog,
    decelWidth: ramp,
  });

export const plateauSpeed = (v0, v1, avg, ramp, kExp, kLog) =>
  plateauSpeedFor(v0, v1, avg, symmetricProfile(kExp, kLog, ramp));

export const logProfile = (v0, v1, length, dt, kExp, kLog, ramp) =>
  speedProfile(v0, v1, length, dt, symmetricProfile(kExp, kLog, ramp));

export const logProfilePeak = (v0, v1, length, dt, kExp, kLog, ramp) =>
  profilePeak(v0, v1, length, dt, symmetricProfile(kExp, kLog, ramp));

export const peakFactor = (smoothing, kExp, kLog) => {
  if (!(smoothing > 0)) return 1;
  return profilePeakFactor(
    profileFromSmoothing(smoothing, { accelCurve: kExp, decelCurve: kLog })
  );
};

export const sampleProfile = (smoothing, kExp, kLog, opts = {}) =>
  sampleProfileCurve(
    profileFromSmoothing(smoothing, { accelCurve: kExp, decelCurve: kLog }),
    opts
  );
