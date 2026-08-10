/**
 * @file 채우기 방향(1번 → 2번) 규칙 — "그리드로 Phase 추가"와 "드론 추가"가
 * 같은 방식으로 쓴다.
 *
 * 방향 토큰은 `'x+'`, `'y-'` 처럼 축 + 부호. 최대 2개를 고르며 축당 하나만
 * 고를 수 있다(같은 축의 반대 방향은 선택 불가). 첫 번째로 고른 방향이 가장
 * 빨리 진행하는 축(1번), 두 번째가 그다음(2번)이고, 고르지 않은 축은 주어진
 * 축 순서대로 오름차순 자동 배정된다.
 */

export const AXIS_LABEL = { x: 'X', y: 'Y', z: 'Z' };

/** 작업 평면(키 = 평면의 법선축)에 놓인 두 축 */
export const PLANE_AXES = { x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] };

export const dirAxis = (dir) => dir[0];
export const dirDescending = (dir) => dir[1] === '-';
export const dirSign = (dir) => (dirDescending(dir) ? -1 : 1);
export const dirLabel = (dir) => `${dir[1]}${AXIS_LABEL[dirAxis(dir)]}`;

/** 주어진 축들로 만들 수 있는 방향 버튼 목록 (+, − 순) */
export const axisDirections = (axes) =>
  axes.flatMap((axis) => [`${axis}+`, `${axis}-`]);

/**
 * 고른 방향 + 남은 축 → 빠른 축부터의 진행 순서.
 * 항상 `axes`의 모든 축을 정확히 한 번씩 담는다.
 */
export const resolveAxisOrder = (dirs, axes) => {
  const order = [];
  const pushAxis = (axis, descending) => {
    if (!order.some((entry) => entry.axis === axis)) {
      order.push({ axis, descending });
    }
  };

  for (const dir of dirs) {
    pushAxis(dirAxis(dir), dirDescending(dir));
  }

  for (const axis of axes) {
    pushAxis(axis, false);
  }

  return order;
};

/**
 * 방향 버튼 토글 결과. 이미 고른 방향을 누르면 그 뒤 선택까지 지우고, 같은
 * 축의 반대 방향이나 세 번째 방향은 무시한다.
 */
export const toggleFillDirection = (dirs, dir) => {
  const at = dirs.indexOf(dir);
  if (at >= 0) {
    return dirs.slice(0, at);
  }

  if (dirs.length >= 2 || dirs.some((d) => dirAxis(d) === dirAxis(dir))) {
    return dirs;
  }

  return [...dirs, dir];
};

/** 축 인덱스 배열 (오름차순 또는 내림차순) */
export const axisIndices = ({ descending }, count) => {
  const list = Array.from({ length: count }, (_, idx) => idx);
  return descending ? list.reverse() : list;
};
