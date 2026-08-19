/**
 * @file 이미지 점 배치를 놓을 "평면"의 방향.
 *
 * `imageToDots`의 배치 계산은 언제나 정면 벽 기준의 로컬 좌표로 나온다:
 * `y` = 그림의 가로, `z` = 그림의 세로, `x` = 법선 방향 깊이(릴리프).
 * 여기서 그 로컬 좌표를 고른 평면의 월드 좌표로 돌린다 — 계산부는 그대로
 * 두고 "어느 벽에 거느냐"만 바꿀 수 있게 하기 위해서다.
 */

import { solveAssignment } from './assignment';
import { DOWNWASH_SAFE_VERTICAL_SEP } from './imageToDots';

/**
 * 평면 방향 목록. `normal`이 평면이 마주보는 축이고, 나머지 두 축이 그림의
 * 가로(`hAxis`)·세로(`vAxis`)가 된다.
 *
 * `verticalIsAltitude`가 false인 바닥 평면은 그림의 세로가 실제 고도가
 * 아니라 남북 방향이므로, 다운워시 회피용 수직 간격 하한을 쓰지 않는다.
 */
export const PLANE_ORIENTATIONS = [
  {
    value: 'x',
    label: '정면 벽',
    hint: '남쪽에서 북쪽(+X)을 바라보는 관객 기준 — 기존 이미지 formation과 동일',
    normal: 'x',
    hAxis: 'y',
    vAxis: 'z',
    offsetLabel: '평면 x 위치 (m)',
    baseLabel: '하단 고도 z (m)',
    shiftLabel: '좌우 이동 y (m)',
    verticalIsAltitude: true,
  },
  {
    value: 'y',
    label: '측면 벽',
    hint: '서쪽에서 동쪽(+Y)을 바라보는 기준 — 그림의 가로가 X축을 따라간다',
    normal: 'y',
    hAxis: 'x',
    vAxis: 'z',
    offsetLabel: '평면 y 위치 (m)',
    baseLabel: '하단 고도 z (m)',
    shiftLabel: '앞뒤 이동 x (m)',
    verticalIsAltitude: true,
  },
  {
    value: 'z',
    label: '바닥 (수평)',
    hint: '위에서 내려다보는 기준 — 그림의 세로가 북쪽(+X), 가로가 동쪽(+Y)',
    normal: 'z',
    hAxis: 'y',
    vAxis: 'x',
    offsetLabel: '평면 고도 z (m)',
    baseLabel: '남쪽 끝 x (m)',
    shiftLabel: '좌우 이동 y (m)',
    verticalIsAltitude: false,
  },
];

export const orientationOf = (value) =>
  PLANE_ORIENTATIONS.find((o) => o.value === value) ?? PLANE_ORIENTATIONS[0];

/**
 * 이 방향에서 쓸 세로 최소 간격 하한.
 *
 * 벽면은 점들이 위아래로 겹치므로 다운워시 회피 간격을 지켜야 하지만,
 * 바닥 평면은 전원이 같은 고도라 그 하한이 의미가 없다 — 그대로 두면
 * 남북 방향만 필요 이상으로 늘어나 그림 비율이 깨진다.
 */
export const verticalSeparationFor = (orientation) =>
  orientation.verticalIsAltitude ? DOWNWASH_SAFE_VERTICAL_SEP : 0;

/**
 * 로컬 평면 좌표 → 월드 좌표.
 *
 * @param point       {y, z, x?} — x는 릴리프 깊이 (평면 중심 기준 오프셋)
 * @param orientation PLANE_ORIENTATIONS의 항목
 * @param offset      법선 축 위의 평면 위치 (m)
 * @param shift       평면 안에서 가로로 밀어 줄 양 (m)
 */
export const localToWorld = (point, orientation, offset = 0, shift = 0) => {
  const depth = Number.isFinite(point.x) ? point.x : 0;
  const h = point.y + shift;
  const v = point.z;
  switch (orientation.normal) {
    case 'y':
      return { x: h, y: offset + depth, z: v };
    case 'z':
      return { x: v, y: h, z: offset + depth };
    default:
      return { x: offset + depth, y: h, z: v };
  }
};

/**
 * 배치된 점들을 드론 id에 할당해 phase points 맵으로 변환.
 *
 * `origins`(각 드론이 이 phase를 시작할 때 있는 위치)를 주면 **제곱 거리
 * 최소 배정**으로 짝짓는다. 이게 중요한 이유: 점을 z·y 순으로 정렬해 드론
 * 번호대로 나눠 주면 왼쪽 끝 드론이 오른쪽 끝 점으로 가는 배정이 잔뜩 생기고,
 * 서로를 마주 보고 지나가야 하는 경로들이 경로 계획기를 교착시킨다. 제곱
 * 거리 최적 배정은 그런 교차가 생기지 않는다는 성질이 있다.
 *
 * (30대 별 formation 실측: 교차쌍 210 → 5, 계획 26초 교착 → 5초 성공.)
 *
 * `origins`가 없으면 예전처럼 아래→위·왼쪽→오른쪽 순서로 번호대로 짝짓는다.
 * 색은 점을 따라다니므로 배정이 바뀌어도 완성된 그림은 똑같다.
 */
export const assignPlanePointsToDrones = (
  points,
  droneIds,
  orientation,
  { offset = 0, shift = 0, origins = null } = {}
) => {
  const placed = points.map((point) => ({
    point,
    world: localToWorld(point, orientation, offset, shift),
  }));

  const toEntry = ({ point, world }) => {
    const entry = {
      x: Math.round(world.x * 10000) / 10000,
      y: Math.round(world.y * 10000) / 10000,
      z: Math.round(world.z * 10000) / 10000,
      yaw: 0,
    };
    if (Array.isArray(point.color) && point.color.length === 3) {
      entry.color = point.color.map((c) =>
        Math.max(0, Math.min(255, Math.round(Number(c) || 0)))
      );
    }
    return entry;
  };

  const hasOrigins =
    Array.isArray(origins) &&
    origins.length === droneIds.length &&
    origins.every(
      (o) =>
        o &&
        Number.isFinite(Number(o.x)) &&
        Number.isFinite(Number(o.y)) &&
        Number.isFinite(Number(o.z))
    );

  const result = {};

  if (hasOrigins) {
    const cost = (i, j) => {
      const from = origins[i];
      const to = placed[j].world;
      const dx = Number(from.x) - to.x;
      const dy = Number(from.y) - to.y;
      const dz = Number(from.z) - to.z;
      return dx * dx + dy * dy + dz * dz;
    };
    const assignment = solveAssignment(cost, droneIds.length, placed.length);
    for (let i = 0; i < droneIds.length; i++) {
      const j = assignment[i];
      if (j >= 0) result[String(droneIds[i])] = toEntry(placed[j]);
    }
    return result;
  }

  const sorted = placed
    .map((item, index) => ({ ...item, index }))
    .sort(
      (a, b) => a.point.z - b.point.z || a.point.y - b.point.y || a.index - b.index
    );
  const count = Math.min(sorted.length, droneIds.length);
  for (let i = 0; i < count; i++) {
    result[String(droneIds[i])] = toEntry(sorted[i]);
  }
  return result;
};
