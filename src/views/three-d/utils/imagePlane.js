/**
 * @file 이미지 점 배치를 놓을 "평면"의 방향.
 *
 * `imageToDots`의 배치 계산은 언제나 정면 벽 기준의 로컬 좌표로 나온다:
 * `y` = 그림의 가로, `z` = 그림의 세로, `x` = 법선 방향 깊이(릴리프).
 * 여기서 그 로컬 좌표를 고른 평면의 월드 좌표로 돌린다 — 계산부는 그대로
 * 두고 "어느 벽에 거느냐"만 바꿀 수 있게 하기 위해서다.
 */

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
 * `assignDotsToDrones`의 평면 방향 버전이다 — 정렬 기준도 화면에서 보이는
 * 대로 아래→위·왼쪽→오른쪽(로컬 z 오름차순, 그다음 y)이라 어느 벽에 걸든
 * 드론 순번이 같은 규칙을 따른다.
 */
export const assignPlanePointsToDrones = (
  points,
  droneIds,
  orientation,
  { offset = 0, shift = 0 } = {}
) => {
  const sorted = points
    .map((point, index) => ({ point, index }))
    .sort(
      (a, b) => a.point.z - b.point.z || a.point.y - b.point.y || a.index - b.index
    );
  const result = {};
  const count = Math.min(sorted.length, droneIds.length);
  for (let i = 0; i < count; i++) {
    const source = sorted[i].point;
    const world = localToWorld(source, orientation, offset, shift);
    const entry = {
      x: Math.round(world.x * 10000) / 10000,
      y: Math.round(world.y * 10000) / 10000,
      z: Math.round(world.z * 10000) / 10000,
      yaw: 0,
    };
    if (Array.isArray(source.color) && source.color.length === 3) {
      entry.color = source.color.map((c) =>
        Math.max(0, Math.min(255, Math.round(Number(c) || 0)))
      );
    }
    result[String(droneIds[i])] = entry;
  }
  return result;
};
