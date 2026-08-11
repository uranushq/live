import { Base64 } from 'js-base64';
import JSZip from 'jszip';

import { getVelocityProfile } from './pathSmoothing';
import { profilePeak, speedProfile } from './velocityProfile';
import { getPathPointArrivalTimesMs, toFiniteHoldMs } from './threeDViewUtils';

const MS_TO_SEC = 0.001;
const TIME_ROUND_DECIMALS = 6;

// Direction change above which a waypoint is treated as a "corner" where speed
// must ramp down. Mirrors CORNER_ANGLE_THRESHOLD_DEG in the path-planner backend.
const CORNER_ANGLE_THRESHOLD_DEG = 5.0;

// Hard velocity limits. Must match MAX_VELOCITY_XY / MAX_VELOCITY_Z in the
// path-planner backend, otherwise a locally patched .skyc could carry speeds
// the server would have refused.
const MAX_VELOCITY_XY = 8.0;
const MAX_VELOCITY_Z = 2.5;

const roundSeconds = (value) => {
  const factor = 10 ** TIME_ROUND_DECIMALS;
  return Math.round(value * factor) / factor;
};

const round4 = (value) => Math.round(value * 10000) / 10000;

const positionToXYZ = (pos) => {
  if (Array.isArray(pos)) {
    return [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0];
  }
  if (isObjectCoordinate(pos)) {
    return [Number(pos.x) || 0, Number(pos.y) || 0, Number(pos.z) || 0];
  }
  return [0, 0, 0];
};

// Build a control point in the same shape (array vs {x,y,z}) as the keyframe's
// position, so the patched trajectory keeps the file's existing convention.
const makeControlLike = (positionTemplate, xyz) => {
  const rounded = [round4(xyz[0]), round4(xyz[1]), round4(xyz[2])];
  if (isObjectCoordinate(positionTemplate)) {
    return { x: rounded[0], y: rounded[1], z: rounded[2] };
  }
  return rounded;
};

/**
 * Merge consecutive same-direction (collinear) segments into one. When A, B, C
 * are collinear and travelled the same way, the middle keyframe B is dropped so
 * A→C becomes a single straight segment (kept keyframes keep their timestamps,
 * so the run still spans the full A→C duration). This lets the smoothing ease
 * once over the whole straight run instead of per short sub-segment. Corners,
 * holds (zero-length segments) and the ends always break a run.
 */
const mergeCollinearRuns = (points, angleThresholdDeg = CORNER_ANGLE_THRESHOLD_DEG) => {
  const n = points.length;
  if (n < 3) return points;

  const unit = (a, b) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L <= 1e-9) return null;
    return [d[0] / L, d[1] / L, d[2] / L];
  };
  const cosThreshold = Math.cos((angleThresholdDeg * Math.PI) / 180);

  const result = [points[0]];
  for (let i = 1; i < n; i += 1) {
    if (result.length >= 2) {
      const a = positionToXYZ(result[result.length - 2][1]);
      const b = positionToXYZ(result[result.length - 1][1]);
      const c = positionToXYZ(points[i][1]);
      const u1 = unit(a, b);
      const u2 = unit(b, c);
      if (u1 && u2) {
        const dot = u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2];
        if (dot >= cosThreshold) {
          // collinear & same direction -> drop middle keyframe, extend run
          result[result.length - 1] = points[i];
          continue;
        }
      }
    }
    result.push(points[i]);
  }

  return result;
};

/** Control-point distances along the segment line; mirrors `_control_distances`. */
const controlDistances = (v0, v1, length, dt) => {
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

const applyVelocitySmoothingToPoints = (points, profile) => {
  const smoothing = Number(profile?.smoothing ?? 0);
  if (!profile || profile.isConstant || !(smoothing > 0) || points.length < 2) {
    // Disabled: make every segment linear (drop any stale control points).
    for (const p of points) p[2] = [];
    return points;
  }
  const s = Math.min(1, smoothing);

  // Merge collinear runs so A→B→C (same direction) becomes one A→C segment;
  // the ease then ramps up once at the run start and down once at its end.
  const merged = mergeCollinearRuns(points);
  const n = merged.length;

  const pos = merged.map((p) => positionToXYZ(p[1]));
  const time = merged.map((p) => Number(p[0]) || 0);

  const segDir = new Array(n).fill(null);
  const segLen = new Array(n).fill(0);
  const segDt = new Array(n).fill(0);
  const segCruise = new Array(n).fill(0);
  for (let k = 1; k < n; k += 1) {
    const a = pos[k - 1];
    const b = pos[k];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    const dt = time[k] - time[k - 1];
    segLen[k] = L;
    segDt[k] = dt;
    if (L > 1e-9 && dt > 1e-9) {
      segDir[k] = [d[0] / L, d[1] / L, d[2] / L];
      segCruise[k] = L / dt;
    }
  }

  const speedAt = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const prevDir = i >= 1 ? segDir[i] : null;
    const nextDir = i + 1 < n ? segDir[i + 1] : null;
    if (!prevDir || !nextDir) {
      speedAt[i] = 0; // start / end / next to a hold -> at rest
      continue;
    }
    let dot =
      prevDir[0] * nextDir[0] + prevDir[1] * nextDir[1] + prevDir[2] * nextDir[2];
    dot = Math.max(-1, Math.min(1, dot));
    const angleDeg = (Math.acos(dot) * 180) / Math.PI;
    const passThrough = Math.min(segCruise[i], segCruise[i + 1]);
    speedAt[i] =
      angleDeg > CORNER_ANGLE_THRESHOLD_DEG ? (1 - s) * passThrough : passThrough;
  }

  // Velocity safety, mirroring `apply_velocity_smoothing`: easing raises the
  // peak above cruise, so segments that would break a limit get their easing
  // relaxed toward cruise. Without this the local patch could emit a .skyc the
  // server would have clamped.
  const segLimit = new Array(n).fill(Infinity);
  for (let k = 1; k < n; k += 1) {
    const u = segDir[k];
    if (!u) continue;
    const hxy = Math.hypot(u[0], u[1]);
    const vz = Math.abs(u[2]);
    let limit = Infinity;
    if (hxy > 1e-9) limit = Math.min(limit, MAX_VELOCITY_XY / hxy);
    if (vz > 1e-9) limit = Math.min(limit, MAX_VELOCITY_Z / vz);
    segLimit[k] = limit;
    if (segCruise[k] > limit * (1 + 1e-6)) {
      // Even constant speed is unflyable at this timing; the server rejects
      // this outright, so leave the path un-eased and say so loudly.
      console.warn(
        `[skyc] segment ending at t=${time[k].toFixed(2)}s needs ` +
          `${segCruise[k].toFixed(2)} m/s, above the ${limit.toFixed(2)} m/s limit; ` +
          'exporting it without velocity smoothing.'
      );
      for (const p of points) p[2] = [];
      return points;
    }
  }

  const needsEasing = (k) =>
    Boolean(segDir[k]) &&
    (Math.abs(speedAt[k - 1] - segCruise[k]) > 1e-9 ||
      Math.abs(speedAt[k] - segCruise[k]) > 1e-9);

  for (let pass = 0; pass < 4; pass += 1) {
    let violated = false;
    for (let k = 1; k < n; k += 1) {
      if (!needsEasing(k)) continue;
      const peak = profilePeak(
        speedAt[k - 1],
        speedAt[k],
        segLen[k],
        segDt[k],
        profile
      );
      if (peak <= segLimit[k] * (1 + 1e-9)) continue;
      violated = true;
      const cruise = segCruise[k];
      const beta = Math.max(
        0,
        Math.min(1, (segLimit[k] - cruise) / Math.max(peak - cruise, 1e-9))
      );
      for (const endpoint of [k - 1, k]) {
        const current = speedAt[endpoint];
        const demanded = cruise + beta * (current - cruise);
        const bounds = [];
        if (endpoint >= 1 && segDir[endpoint]) bounds.push(segCruise[endpoint]);
        if (endpoint + 1 < n && segDir[endpoint + 1]) {
          bounds.push(segCruise[endpoint + 1]);
        }
        const bound = bounds.length ? Math.min(...bounds) : cruise;
        speedAt[endpoint] = Math.min(Math.max(current, demanded), bound);
      }
    }
    if (!violated) break;
  }

  // Still over a limit with easing? Fall back to constant speed everywhere.
  for (let k = 1; k < n; k += 1) {
    if (!needsEasing(k)) continue;
    const peak = profilePeak(speedAt[k - 1], speedAt[k], segLen[k], segDt[k], profile);
    if (peak > segLimit[k] * (1 + 1e-6)) {
      for (const p of points) p[2] = [];
      return points;
    }
  }

  // Sub-knots at the ramp boundaries, exactly as the backend renders them, so
  // the ramp SHAPE (not just its endpoint speeds) survives into the .skyc.
  const rampA = profile.accelWidth;
  const rampB = profile.decelWidth;
  const subTaus = [];
  for (const tau of [rampA * 0.5, rampA, 1 - rampB, 1 - rampB * 0.5]) {
    if (
      tau > 1e-9 &&
      tau < 1 - 1e-9 &&
      (subTaus.length === 0 || tau > subTaus[subTaus.length - 1] + 1e-9)
    ) {
      subTaus.push(tau);
    }
  }
  subTaus.push(1);

  const out = [[merged[0][0], merged[0][1], []]];
  for (let k = 1; k < n; k += 1) {
    const u = segDir[k];
    const template = merged[k][1];
    if (!u) {
      out.push([merged[k][0], template, []]); // hold / degenerate -> constant
      continue;
    }
    const a = pos[k - 1];
    const t0 = time[k - 1];
    const { speed, arc } = speedProfile(
      speedAt[k - 1],
      speedAt[k],
      segLen[k],
      segDt[k],
      profile
    );
    let prevTau = 0;
    let prevArc = 0;
    // A zero-width side never flies its knot speed; read both off the profile.
    let prevSpeed = Math.max(0, speed(0));
    const exitSpeed = Math.max(0, speed(1));
    for (let i = 0; i < subTaus.length; i += 1) {
      const tau = subTaus[i];
      const last = i === subTaus.length - 1;
      const sArc = last
        ? segLen[k]
        : Math.min(segLen[k], Math.max(prevArc, arc(tau)));
      const v = last ? exitSpeed : Math.max(0, speed(tau));
      const [d1, d2] = controlDistances(
        prevSpeed,
        v,
        sArc - prevArc,
        (tau - prevTau) * segDt[k]
      );
      const p1 = [0, 1, 2].map((j) => a[j] + u[j] * (prevArc + d1));
      const p2 = [0, 1, 2].map((j) => a[j] + u[j] * (prevArc + d2));
      const knotTime = last ? merged[k][0] : roundSeconds(t0 + tau * segDt[k]);
      const knotPos = last
        ? template
        : makeControlLike(
            template,
            [0, 1, 2].map((j) => a[j] + u[j] * sArc)
          );
      out.push([
        knotTime,
        knotPos,
        [makeControlLike(template, p1), makeControlLike(template, p2)],
      ]);
      prevTau = tau;
      prevArc = sArc;
      prevSpeed = v;
    }
  }

  return out;
};

const isObjectCoordinate = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeCoordinate = (coord, defaultZ = 0) => {
  if (isObjectCoordinate(coord)) {
    const x = Number(coord.x);
    const y = Number(coord.y);
    let z = Number(coord.z);
    if (!Number.isFinite(z)) {
      z = defaultZ;
    }
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return { x, y, z };
    }
    return null;
  }

  if (!Array.isArray(coord)) {
    return null;
  }

  const x = Number(coord[0]);
  const y = Number(coord[1]);
  let z = coord.length >= 3 ? Number(coord[2]) : defaultZ;
  if (!Number.isFinite(z)) {
    z = defaultZ;
  }
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y, z };
  }
  return null;
};

const formatCoordinate = (coord, template) => {
  if (!coord) return null;
  if (isObjectCoordinate(template)) {
    return { x: coord.x, y: coord.y, z: coord.z };
  }
  return [coord.x, coord.y, coord.z];
};

const isNumericTuple = (value) =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'number');

const normalizeControlPoints = (thirdElement, defaultZ, templateControlPoint) => {
  if (thirdElement == null) {
    return [];
  }

  if (!Array.isArray(thirdElement) || thirdElement.length === 0) {
    return [];
  }

  if (isNumericTuple(thirdElement)) {
    const single = normalizeCoordinate(thirdElement, defaultZ);
    return single ? [formatCoordinate(single, templateControlPoint)] : [];
  }

  return thirdElement
    .map((controlPoint) => {
      const parsed = normalizeCoordinate(controlPoint, defaultZ);
      return parsed ? formatCoordinate(parsed, templateControlPoint ?? controlPoint) : null;
    })
    .filter(Boolean);
};

const getPositionTemplate = (trajectory) => trajectory?.points?.[0]?.[1];

const getControlPointTemplate = (trajectory) => {
  const controls = trajectory?.points?.[0]?.[2];
  if (!Array.isArray(controls) || !controls.length) {
    return undefined;
  }
  if (isNumericTuple(controls)) {
    return controls;
  }
  return controls[0];
};

const pathPointToCoordinate = (point, template, defaultZ = 0) => {
  const fromPath = normalizeCoordinate(
    { x: point?.x, y: point?.y, z: point?.z },
    defaultZ
  );
  return fromPath ? formatCoordinate(fromPath, template) : null;
};

/**
 * Patches trajectory points/timing only, keeping formation-plan / path-planner shape:
 *   [time, [x,y,z], controlPoints]  (controlPoints is [] when unused)
 */
export const patchTrajectoryFromPath = (originalTrajectory, path) => {
  if (!originalTrajectory || !Array.isArray(path) || !path.length) {
    return null;
  }

  const originalPoints = Array.isArray(originalTrajectory.points) ? originalTrajectory.points : [];
  const takeoffTime = Math.max(0, Number(originalTrajectory.takeoffTime) || 0);
  const takeoffTimeMs = takeoffTime * 1000;
  const arrivalTimesMs = getPathPointArrivalTimesMs(path);
  const positionTemplate = getPositionTemplate(originalTrajectory);
  const controlTemplate = getControlPointTemplate(originalTrajectory);

  const lastIndex = path.length - 1;
  const landingTimeSec = roundSeconds(toFiniteHoldMs(path[lastIndex]?.holdMs, 0) * MS_TO_SEC);

  const points = [];
  for (let i = 0; i < path.length; i += 1) {
    const origKf = originalPoints[i];
    const pointTemplate = origKf?.[1] ?? positionTemplate;
    const defaultZ = normalizeCoordinate(pointTemplate)?.z ?? 0;
    const position = pathPointToCoordinate(path[i], pointTemplate, defaultZ);
    if (!position) continue;

    const timeSec = roundSeconds(
      Math.max(0, ((Number(arrivalTimesMs[i]) || 0) - takeoffTimeMs) * MS_TO_SEC)
    );

    const pointControlTemplate =
      (Array.isArray(origKf?.[2]) && !isNumericTuple(origKf[2]) ? origKf[2][0] : origKf?.[2]) ??
      controlTemplate;

    const controls = normalizeControlPoints(origKf?.[2], defaultZ, pointControlTemplate);

    points.push([timeSec, position, controls]);
  }

  if (!points.length) {
    return null;
  }

  for (let i = 1; i < points.length; i += 1) {
    if (points[i][0] <= points[i - 1][0]) {
      points[i][0] = roundSeconds(points[i - 1][0] + MS_TO_SEC);
    }
  }

  // Recompute the keyframes so the edited (straight) path gets the same speed
  // profile as the server-generated shows — same ramp shapes, widths and
  // curvatures. Collinear runs are merged into one segment and eased segments
  // are subdivided at the ramp boundaries, so the keyframe count changes.
  const smoothedPoints = applyVelocitySmoothingToPoints(points, getVelocityProfile());

  const patched = {
    ...originalTrajectory,
    version: originalTrajectory.version ?? 1,
    points: smoothedPoints,
  };

  if (takeoffTime > 0 || originalTrajectory.takeoffTime !== undefined) {
    patched.takeoffTime = takeoffTime;
  }
  if (landingTimeSec > 0 || originalTrajectory.landingTime !== undefined) {
    patched.landingTime = landingTimeSec;
  } else if ('landingTime' in originalTrajectory && landingTimeSec === 0) {
    delete patched.landingTime;
  }

  return patched;
};

const getTrajectoryRefPath = (drone) => {
  const trajectory = drone?.settings?.trajectory;
  if (trajectory && typeof trajectory.$ref === 'string') {
    const ref = trajectory.$ref.split('#')[0];
    return ref.replace(/^\.\//, '');
  }
  return null;
};

const findZipFile = (zip, path) => {
  if (!path) return null;
  const direct = zip.file(path);
  if (direct) return direct;
  const decoded = decodeURIComponent(path);
  if (decoded !== path) {
    return zip.file(decoded);
  }
  return null;
};

const loadOriginalTrajectory = async (zip, zipDrone, specDrone) => {
  const specTrajectory = specDrone?.settings?.trajectory;
  if (specTrajectory && Array.isArray(specTrajectory.points) && !specTrajectory.$ref) {
    return specTrajectory;
  }

  const refPath = getTrajectoryRefPath(zipDrone);
  if (refPath) {
    const refFile = findZipFile(zip, refPath);
    if (refFile) {
      return JSON.parse(await refFile.async('string'));
    }
  }

  const inline = zipDrone?.settings?.trajectory;
  if (inline && Array.isArray(inline.points) && !inline.$ref) {
    return inline;
  }

  return specTrajectory;
};

/**
 * Patches only trajectory JSON inside the original .skyc zip.
 * show.json fields (home, coordinateSystem, lights, geofence, cues) are left as-is.
 */
export const patchSkycZipWithTrajectories = async ({
  base64Blob,
  swarmDrones,
  editedDrones,
}) => {
  if (!base64Blob) {
    throw new Error('원본 .skyc 데이터가 없습니다. 파일을 다시 업로드해 주세요.');
  }

  const zip = await JSZip.loadAsync(Base64.toUint8Array(base64Blob));
  const showFile = zip.file('show.json');
  if (!showFile) {
    throw new Error('show.json을 찾을 수 없습니다.');
  }

  const showRoot = JSON.parse(await showFile.async('string'));
  const zipDrones = showRoot?.swarm?.drones;
  if (!Array.isArray(zipDrones) || !zipDrones.length) {
    throw new Error('show.json에 드론 swarm이 없습니다.');
  }

  const specDrones = Array.isArray(swarmDrones) ? swarmDrones : [];
  const pathsByIndex = Array.isArray(editedDrones) ? editedDrones : [];
  let patchedCount = 0;
  let showJsonTouched = false;

  for (let i = 0; i < zipDrones.length; i += 1) {
    const edited = pathsByIndex[i];
    if (!edited || !Array.isArray(edited.path) || !edited.path.length) {
      continue;
    }

    const zipDrone = zipDrones[i];
    const specDrone = specDrones[i];
    const refPath = getTrajectoryRefPath(zipDrone);
    const originalTrajectory = await loadOriginalTrajectory(zip, zipDrone, specDrone);
    const patchedTrajectory = patchTrajectoryFromPath(originalTrajectory, edited.path);

    if (!patchedTrajectory) {
      continue;
    }

    if (refPath) {
      const refFile = findZipFile(zip, refPath);
      if (!refFile) {
        throw new Error(`trajectory 파일을 찾을 수 없습니다: ${refPath}`);
      }
      zip.file(refPath, JSON.stringify(patchedTrajectory));
    } else if (zipDrone?.settings) {
      zipDrone.settings.trajectory = patchedTrajectory;
      showJsonTouched = true;
    }

    patchedCount += 1;
  }

  if (!patchedCount) {
    throw new Error('갱신할 유효한 경로가 없습니다.');
  }

  if (showJsonTouched) {
    zip.file('show.json', JSON.stringify(showRoot));
  }

  return zip.generateAsync({ type: 'blob' });
};

export const downloadBlobAsFile = (blob, filename) => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  if (anchor.parentNode === document.body) {
    try {
      document.body.removeChild(anchor);
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
  }
  URL.revokeObjectURL(objectUrl);
};

export const exportPatchedSkycFromShow = async ({
  base64Blob,
  swarmDrones,
  editedDrones,
  filename = 'updated-show.skyc',
}) => {
  const blob = await patchSkycZipWithTrajectories({
    base64Blob,
    swarmDrones,
    editedDrones,
  });
  downloadBlobAsFile(blob, filename);
  return blob;
};
