/**
 * @file 3D 뷰와 같은 방향을 쓰는 등축(isometric) 투영.
 *
 * "그리드로 Phase 추가"와 "드론 추가" 편집기가 공유한다 — 두 화면이 같은
 * 좌표계·같은 시선으로 보여야 실제 3D 뷰에 놓일 위치를 그대로 읽을 수 있다.
 * 방향 규약은 3D 뷰와 동일: +Y가 화면 오른쪽, +X가 왼쪽·아래, +Z가 위.
 */

const RAD = (deg) => (deg * Math.PI) / 180;

export const COS30 = Math.cos(RAD(30));

/** 월드 좌표 → 투영 평면의 (u, v)와 정렬용 depth. */
export const isoRaw = (x, y, z, yawDeg) => {
  const c = Math.cos(RAD(yawDeg));
  const s = Math.sin(RAD(yawDeg));
  const rx = x * c - y * s;
  const ry = x * s + y * c;
  return { u: (ry - rx) * COS30, v: (rx + ry) * 0.5 - z, depth: rx + ry };
};

/**
 * isoRaw의 역변환 — z가 정해진 수평면 위의 (x, y)를 돌려준다.
 * (u, v)는 (x, y)에 대해 선형이고 행렬식이 항상 -cos30이라 특이점이 없다.
 */
export const isoInverseOnZ = (u, v, z, yawDeg) => {
  const c = Math.cos(RAD(yawDeg));
  const s = Math.sin(RAD(yawDeg));
  const diff = u / COS30; // ry - rx
  const sum = 2 * (v + z); // rx + ry
  const rx = (sum - diff) / 2;
  const ry = (sum + diff) / 2;
  return { x: rx * c + ry * s, y: -rx * s + ry * c };
};

/**
 * 주어진 점들이 (패딩을 뺀) 화면 안에 들어가도록 배율과 원점을 계산한다.
 * 반환값은 `px = ox + u * s`, `py = oy + v * s`로 쓴다.
 */
export const fitIsoView = ({
  points,
  yaw,
  zoom = 1,
  width,
  height,
  padX = 54,
  padTop = 48,
  padBottom = 110,
  pan = { x: 0, y: 0 },
}) => {
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;

  for (const p of points) {
    const r = isoRaw(p.x, p.y, p.z, yaw);
    if (r.u < uMin) uMin = r.u;
    if (r.u > uMax) uMax = r.u;
    if (r.v < vMin) vMin = r.v;
    if (r.v > vMax) vMax = r.v;
  }

  const w = Math.max(120, width - padX * 2);
  const h = Math.max(120, height - padTop - padBottom);
  const du = Math.max(1, uMax - uMin);
  const dv = Math.max(1, vMax - vMin);
  const s = Math.min(w / du, h / dv) * zoom;
  const cu = (uMin + uMax) / 2;
  const cv = (vMin + vMax) / 2;

  return {
    s,
    ox: width / 2 - cu * s + pan.x,
    oy: padTop + h / 2 - cv * s + pan.y,
  };
};
