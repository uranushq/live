/**
 * @file 최소 비용 완전 배정 (Hungarian / Jonker-Volgenant).
 *
 * 드론을 목표 좌표에 짝지을 때 쓴다. 비용을 **제곱 거리**로 두면 최적 배정은
 * 평면에서 서로 교차하지 않는 성질이 있다 — 두 경로가 교차하면 짝을 바꾸는
 * 쪽이 항상 제곱합이 더 작기 때문이다. 경로 교차는 경로 계획기가 가장 풀기
 * 어려워하는 상황(서로를 마주 보고 지나가야 하는 드론들)이라, 배정 단계에서
 * 교차를 없애 두면 계획 성공률이 크게 올라간다.
 *
 * 30대 이미지 formation 실측: 교차쌍 210 → 5로 줄면서 계획이 26초 교착에서
 * 5초 성공으로 바뀌었다.
 */

/** 이 크기까지는 정확해(O(n^3))를 쓰고, 넘으면 근사해로 내려간다. */
const EXACT_LIMIT = 400;

/**
 * 정사각 비용 행렬의 최소 비용 완전 배정 (Jonker-Volgenant, O(n^3)).
 *
 * @param cost cost[i][j] = i번 행을 j번 열에 붙일 때의 비용
 * @returns Int32Array — result[i] = i번 행에 배정된 열
 */
export function hungarian(cost) {
  const n = cost.length;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);

  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);

    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const result = new Int32Array(n);
  for (let j = 1; j <= n; j += 1) result[p[j] - 1] = j - 1;
  return result;
}

/**
 * 큰 문제용 근사해: 가까운 쌍부터 탐욕적으로 붙인 뒤 2-opt로 교차를 푼다.
 *
 * 제곱 비용에서 두 쌍을 맞바꿔 총합이 줄면 그 둘은 교차하고 있었던 것이므로,
 * 2-opt를 수렴할 때까지 돌리면 교차가 사실상 사라진다.
 */
function greedyWithTwoOpt(cost) {
  const n = cost.length;
  const pairs = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) pairs.push([cost[i][j], i, j]);
  }
  pairs.sort((a, b) => a[0] - b[0]);

  const result = new Int32Array(n).fill(-1);
  const takenCol = new Uint8Array(n);
  let placed = 0;
  for (const [, i, j] of pairs) {
    if (placed === n) break;
    if (result[i] !== -1 || takenCol[j]) continue;
    result[i] = j;
    takenCol[j] = 1;
    placed += 1;
  }

  // 2-opt: 맞바꿔서 더 싸지는 쌍이 없을 때까지
  for (let pass = 0; pass < 12; pass += 1) {
    let improved = false;
    for (let a = 0; a < n; a += 1) {
      for (let b = a + 1; b < n; b += 1) {
        const ja = result[a];
        const jb = result[b];
        if (cost[a][jb] + cost[b][ja] < cost[a][ja] + cost[b][jb] - 1e-9) {
          result[a] = jb;
          result[b] = ja;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return result;
}

/**
 * 행 개수와 열 개수가 달라도 되는 최소 비용 배정.
 *
 * 모자란 쪽은 비용 0인 더미로 채운다 — 더미 비용이 모두 같으므로 실제 쌍의
 * 총합만으로 선택이 결정되고, 남는 행/열은 "짝 없음"이 된다.
 *
 * @param costFn      (row, col) => 비용
 * @param rowCount    행 개수
 * @param colCount    열 개수
 * @returns (number | -1)[] — 길이 rowCount, 값은 배정된 열 또는 짝 없으면 -1
 */
export function solveAssignment(costFn, rowCount, colCount) {
  if (rowCount <= 0 || colCount <= 0) return new Array(Math.max(0, rowCount)).fill(-1);

  const n = Math.max(rowCount, colCount);
  const cost = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const row = new Float64Array(n);
    if (i < rowCount) {
      for (let j = 0; j < colCount; j += 1) {
        const value = costFn(i, j);
        row[j] = Number.isFinite(value) ? value : 1e12;
      }
    }
    cost[i] = row;
  }

  const perm = n <= EXACT_LIMIT ? hungarian(cost) : greedyWithTwoOpt(cost);

  const assignment = new Array(rowCount).fill(-1);
  for (let i = 0; i < rowCount; i += 1) {
    const j = perm[i];
    if (j >= 0 && j < colCount) assignment[i] = j;
  }
  return assignment;
}
