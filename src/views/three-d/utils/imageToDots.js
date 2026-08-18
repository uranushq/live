/**
 * 이미지 → 대표 점(dot) 추출.
 *
 * 드론 쇼용 "이미지 formation" 파이프라인의 순수 계산부:
 *
 *   1. 중요도 맵 — 배경을 자동 감지(테두리 중앙값 휘도)하고, 배경과의
 *      휘도 차이 + Sobel 에지 강도를 합성해 "이미지의 내용/구조를 담은"
 *      픽셀에 높은 가중치를 준다. 알파 채널은 곱해서 투명 영역을 제외.
 *   2. 가중 k-means(로이드 반복) — 드론 수만큼의 클러스터 중심이 중요도
 *      가중 픽셀 분포 위에서 수렴 → 웨이티드 보로노이 스티플링의 근사.
 *      시드는 고정 PRNG로 뽑아 같은 이미지·같은 설정이면 항상 같은 결과.
 *   3. 정면 수직 평면 배치 — 남쪽에서 +x(북)를 바라보는 기준으로 y(좌우),
 *      z(상하)에 매핑하고, 반복 밀어내기 + 필요시 전체 확대를 통해 모든
 *      쌍이 최소 간격(체비셰프)을 만족하도록 보정한다.
 *
 * 모든 함수는 DOM 없이 동작한다 (ImageData 호환 {data,width,height}만 사용).
 */

/**
 * 수직(z) 최소 간격 하한 (m). 경로 계획기는 주차된 드론의 위·아래
 * ±2.5m를 다운워시 회피 기둥으로 막기 때문에, 이미지/모델 formation의
 * 수직 간격이 이보다 좁으면 진입 경로가 존재하지 않아 계획이 교착된다.
 * (100대 수직 벽 검증: 2.05m → 교착, 2.6m → 119스텝에 성공)
 */
export const DOWNWASH_SAFE_VERTICAL_SEP = 2.6;

/** 고정 시드 PRNG (mulberry32) — 결과 재현성 보장. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 중요도 맵 계산.
 *
 * @param image  {data: Uint8ClampedArray(RGBA), width, height}
 * @param mode   'auto'  — 배경(테두리 중앙값)과 다른 픽셀이 피사체
 *               'dark'  — 어두운 픽셀이 피사체 (흰 배경 스케치)
 *               'bright'— 밝은 픽셀이 피사체 (검은 배경 로고)
 * @returns Float32Array (width*height, 0..1)
 */
export function computeImportance(image, { mode = 'auto' } = {}) {
  const { data, width, height } = image;
  const n = width * height;
  const lum = new Float32Array(n);
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] =
      (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
    alpha[i] = data[o + 3] / 255;
  }

  // 배경 휘도 추정: 불투명한 테두리 픽셀의 중앙값
  const border = [];
  for (let x = 0; x < width; x++) {
    if (alpha[x] > 0.5) border.push(lum[x]);
    const b = (height - 1) * width + x;
    if (alpha[b] > 0.5) border.push(lum[b]);
  }
  for (let y = 0; y < height; y++) {
    const l = y * width;
    const r = y * width + width - 1;
    if (alpha[l] > 0.5) border.push(lum[l]);
    if (alpha[r] > 0.5) border.push(lum[r]);
  }
  border.sort((a, b) => a - b);
  const background = border.length
    ? border[Math.floor(border.length / 2)]
    : 1.0;

  // Sobel 에지 강도
  const edge = new Float32Array(n);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -lum[i - width - 1] - 2 * lum[i - 1] - lum[i + width - 1] +
        lum[i - width + 1] + 2 * lum[i + 1] + lum[i + width + 1];
      const gy =
        -lum[i - width - 1] - 2 * lum[i - width] - lum[i - width + 1] +
        lum[i + width - 1] + 2 * lum[i + width] + lum[i + width + 1];
      edge[i] = Math.min(1, Math.hypot(gx, gy));
    }
  }

  const weights = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let base;
    if (mode === 'dark') base = 1 - lum[i];
    else if (mode === 'bright') base = lum[i];
    else base = Math.min(1, Math.abs(lum[i] - background) * 1.6);
    // 내용(면적)과 구조(에지)를 함께 반영, 감마로 노이즈 억제
    const w = (0.65 * base + 0.35 * edge[i]) * alpha[i];
    weights[i] = w < 0.06 ? 0 : w ** 1.4;
  }
  return weights;
}

/**
 * 드론 수·이미지 내용량에 맞는 권장 평면 폭(m)을 계산한다.
 *
 * 점들은 이미지 사각형 전체가 아니라 "내용" 픽셀(중요도 > 0) 위에만
 * 놓이므로, 필요한 면적 N × sepY × sepZ × 여유가 내용 픽셀이 차지하는
 * 면적(점유율 f × 폭 × 높이)에 들어가도록 폭을 역산한다. 여기서
 * 시작하면 사후 전체 확대에 기대지 않고 드론 수에 맞는 크기로
 * 처음부터 펼쳐진다.
 */
export function suggestPlaneWidth(
  image,
  count,
  {
    imageAspect,
    minSeparation = 1.45,
    spacingFactor = 1.4,
    mode = 'auto',
    headroom = 1.35,
  } = {}
) {
  const sepY =
    Math.max(1.45, minSeparation) * Math.max(1, Number(spacingFactor) || 1);
  const sepZ = Math.max(sepY, DOWNWASH_SAFE_VERTICAL_SEP);
  const weights = computeImportance(image, { mode });
  let content = 0;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] > 0) content++;
  }
  const f = Math.max(0.03, content / Math.max(1, weights.length));
  const aspect = Math.max(1e-6, imageAspect || 1);
  const needed = Math.max(1, count) * sepY * sepZ * headroom;
  return Math.sqrt((needed / f) * aspect);
}

/**
 * 가중 k-means로 대표 점 count개 추출.
 *
 * @returns [{u, v}] — 정규화 이미지 좌표 (u: 0=왼쪽..1=오른쪽,
 *          v: 0=위..1=아래). 유효 가중치가 전무하면 빈 배열.
 */
export function extractDots(
  image,
  count,
  { mode = 'auto', seed = 20260802, iterations = 24 } = {}
) {
  const { width, height } = image;
  const weights = computeImportance(image, { mode });

  // 유효 픽셀 목록 + 누적 분포(가중 시드 샘플링용)
  const px = [];
  const cdf = [];
  let total = 0;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] > 0) {
      px.push(i);
      total += weights[i];
      cdf.push(total);
    }
  }
  if (!px.length || count <= 0) return [];

  const rand = mulberry32(seed);
  const cx = new Float64Array(count);
  const cy = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const r = rand() * total;
    // 이분 탐색으로 가중 샘플
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const i = px[lo];
    cx[k] = (i % width) + 0.5 + (rand() - 0.5) * 0.5;
    cy[k] = Math.floor(i / width) + 0.5 + (rand() - 0.5) * 0.5;
  }

  // 로이드 반복 (가중 최근접 재중심화)
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  const sumW = new Float64Array(count);
  for (let iter = 0; iter < iterations; iter++) {
    sumX.fill(0);
    sumY.fill(0);
    sumW.fill(0);
    for (let p = 0; p < px.length; p++) {
      const i = px[p];
      const x = (i % width) + 0.5;
      const y = Math.floor(i / width) + 0.5;
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < count; k++) {
        const dx = x - cx[k];
        const dy = y - cy[k];
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      const w = weights[i];
      sumX[best] += x * w;
      sumY[best] += y * w;
      sumW[best] += w;
    }
    for (let k = 0; k < count; k++) {
      if (sumW[k] > 0) {
        cx[k] = sumX[k] / sumW[k];
        cy[k] = sumY[k] / sumW[k];
      } else {
        // 빈 클러스터: 가중 재샘플로 되살린다
        const r = rand() * total;
        let lo = 0;
        let hi = cdf.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cdf[mid] < r) lo = mid + 1;
          else hi = mid;
        }
        const i = px[lo];
        cx[k] = (i % width) + 0.5;
        cy[k] = Math.floor(i / width) + 0.5;
      }
    }
  }

  // 클러스터별 가중 평균 색 — 각 점(=드론)의 LED 색으로 쓴다. 수렴한
  // 중심 기준 최근접 배정을 한 번 더 돌며 픽셀 색을 중요도 가중으로 누적.
  const sumR = new Float64Array(count);
  const sumG = new Float64Array(count);
  const sumB = new Float64Array(count);
  const sumC = new Float64Array(count);
  const { data } = image;
  for (let p = 0; p < px.length; p++) {
    const i = px[p];
    const x = (i % width) + 0.5;
    const y = Math.floor(i / width) + 0.5;
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < count; k++) {
      const dx = x - cx[k];
      const dy = y - cy[k];
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    const w = weights[i];
    const o = i * 4;
    sumR[best] += data[o] * w;
    sumG[best] += data[o + 1] * w;
    sumB[best] += data[o + 2] * w;
    sumC[best] += w;
  }

  const dots = [];
  for (let k = 0; k < count; k++) {
    const color =
      sumC[k] > 0
        ? [
            Math.round(sumR[k] / sumC[k]),
            Math.round(sumG[k] / sumC[k]),
            Math.round(sumB[k] / sumC[k]),
          ]
        : null;
    dots.push({ u: cx[k] / width, v: cy[k] / height, color });
  }
  return dots;
}

/**
 * 정규화 점들을 정면 수직 평면의 미터 좌표로 배치.
 *
 * 남쪽에서 +x(북쪽)를 바라보는 관객 기준: 이미지 오른쪽 → 동쪽(-y),
 * 이미지 위 → 높은 z. 모든 쌍이 최소 간격(체비셰프, y/z 평면)을
 * 만족하도록 반복 밀어내기 후, 그래도 부족하면 전체를 중심 기준으로
 * 확대한다.
 *
 * @returns {points: [{y, z}], widthM, heightM, scaledUp}
 */
export function layoutDotsOnPlane(
  dots,
  {
    imageAspect, // width / height
    widthM = 20,
    bottomZ = 5,
    minSeparation = 1.45,
    spacingFactor = 1.4,
    relaxIterations = 120,
    // 세로 간격 하한 (m). 벽면은 다운워시 회피를 위해 이 값을 지켜야 하지만,
    // 바닥 평면처럼 "세로"가 고도가 아닌 경우에는 0을 넘겨 끈다.
    verticalSeparation = DOWNWASH_SAFE_VERTICAL_SEP,
  }
) {
  if (!dots.length) {
    return { points: [], widthM, heightM: 0, scaledUp: false };
  }
  const heightM = widthM / Math.max(1e-6, imageAspect);
  const pts = dots.map((d) => ({
    y: (0.5 - d.u) * widthM,
    z: bottomZ + (1 - d.v) * heightM,
    color: d.color ?? null,
  }));

  const sep =
    Math.max(1.45, minSeparation) * Math.max(1, Number(spacingFactor) || 1);
  const sepZ = Math.max(sep, verticalSeparation);
  const eps = 1e-6;

  // 반복 밀어내기: 체비셰프 간격이 모자란 쌍을 큰 축 방향으로 벌린다
  for (let iter = 0; iter < relaxIterations; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dy = pts[j].y - pts[i].y;
        const dz = pts[j].z - pts[i].z;
        if (Math.abs(dy) >= sep || Math.abs(dz) >= sepZ) continue;
        moved = true;
        // 이동량이 덜 드는 축을 밀어 벌리는 게 형상 왜곡이 적다
        const needY = sep - Math.abs(dy);
        const needZ = sepZ - Math.abs(dz);
        if (needY <= needZ) {
          const need = needY / 2 + eps;
          const dir = dy >= 0 ? 1 : -1;
          pts[j].y += dir * need;
          pts[i].y -= dir * need;
        } else {
          const need = needZ / 2 + eps;
          const dir = dz >= 0 ? 1 : -1;
          pts[j].z += dir * need;
          pts[i].z -= dir * need;
        }
      }
    }
    if (!moved) break;
  }

  // 최종 검증: 축별 요구 간격 대비 최악 비율이 1 미만이면 중심 기준 전체 확대
  let worst = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const r = Math.max(
        Math.abs(pts[j].y - pts[i].y) / sep,
        Math.abs(pts[j].z - pts[i].z) / sepZ
      );
      if (r < worst) worst = r;
    }
  }
  let scaledUp = false;
  if (pts.length > 1 && worst < 1) {
    scaledUp = true;
    const factor = (1 / Math.max(worst, 1e-9)) * 1.001;
    let cy0 = 0;
    let cz0 = 0;
    for (const p of pts) {
      cy0 += p.y;
      cz0 += p.z;
    }
    cy0 /= pts.length;
    cz0 /= pts.length;
    for (const p of pts) {
      p.y = cy0 + (p.y - cy0) * factor;
      p.z = cz0 + (p.z - cz0) * factor;
    }
  }

  // 바닥 하한 보정 (밀어내기/확대로 bottomZ 아래로 내려간 점 방지)
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (minZ < bottomZ) {
    const lift = bottomZ - minZ;
    for (const p of pts) p.z += lift;
    maxZ += lift;
  }

  return {
    points: pts,
    widthM: maxY - minY,
    heightM: maxZ - (minZ < bottomZ ? bottomZ : minZ),
    scaledUp,
  };
}

/**
 * 각 점 위치의 깊이(0..1, 1 = 관객에 가장 가까움)를 추정한다.
 *
 * 단일 이미지에는 실제 깊이 정보가 없으므로 휴리스틱 소스를 쓴다:
 *   'bright' — 밝을수록 앞 (조명을 받은 부분이 튀어나온 사진/렌더에 적합)
 *   'dark'   — 어두울수록 앞 (진하게 그린 부분이 주제인 스케치에 적합)
 *   'bulge'  — 중심 볼록: 점 분포의 중심에 가까울수록 앞 (로고를 반구형
 *              볼륨으로 부풀릴 때 적합, 이미지 내용과 무관)
 */
export function sampleDepths(image, dots, { source = 'bright', radius = 2 } = {}) {
  const { data, width, height } = image;
  const depths = new Float32Array(dots.length);

  if (source === 'bulge') {
    let cu = 0;
    let cv = 0;
    for (const d of dots) {
      cu += d.u;
      cv += d.v;
    }
    cu /= dots.length || 1;
    cv /= dots.length || 1;
    let maxR = 1e-6;
    const rs = dots.map((d) => {
      const r = Math.hypot(d.u - cu, d.v - cv);
      if (r > maxR) maxR = r;
      return r;
    });
    for (let i = 0; i < dots.length; i++) {
      const rn = rs[i] / maxR;
      depths[i] = Math.sqrt(Math.max(0, 1 - rn * rn)); // 반구 단면
    }
    return depths;
  }

  for (let i = 0; i < dots.length; i++) {
    const px = Math.round(dots[i].u * width);
    const py = Math.round(dots[i].v * height);
    let sum = 0;
    let cnt = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const o = (y * width + x) * 4;
        if (data[o + 3] < 64) continue;
        sum +=
          (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) /
          255;
        cnt++;
      }
    }
    const lum = cnt ? sum / cnt : 0.5;
    depths[i] = source === 'dark' ? 1 - lum : lum;
  }

  // 대비 정규화: 실제 사용 범위를 0..1로 늘려 깊이감을 확보
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of depths) {
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  const span = hi - lo;
  if (span > 1e-6) {
    for (let i = 0; i < depths.length; i++) {
      depths[i] = (depths[i] - lo) / span;
    }
  }
  return depths;
}

/**
 * 점 + 깊이를 3D 볼륨으로 배치 (이미지 → 3D → 점).
 *
 * y/z 는 평면 배치와 동일한 정면 매핑, x 는 planeX 를 중심으로 깊이
 * 범위(depthM)만큼 앞뒤로 분포한다 (depth 1 → 관객 쪽 = -x 방향).
 * 최소 간격은 3축 체비셰프로 강제: 반복 밀어내기 후 부족하면 전체 확대.
 *
 * @returns {points: [{x, y, z}], widthM, heightM, depthSpanM, scaledUp}
 */
export function layoutDotsInVolume(
  dots,
  depths,
  {
    imageAspect,
    widthM = 20,
    depthM = 8,
    bottomZ = 5,
    planeX = 0,
    minSeparation = 1.45,
    spacingFactor = 1.4,
    relaxIterations = 120,
    verticalSeparation = DOWNWASH_SAFE_VERTICAL_SEP,
  }
) {
  if (!dots.length) {
    return { points: [], widthM, heightM: 0, depthSpanM: 0, scaledUp: false };
  }
  const heightM = widthM / Math.max(1e-6, imageAspect);
  const pts = dots.map((d, i) => ({
    x: planeX + (0.5 - (depths[i] ?? 0.5)) * depthM,
    y: (0.5 - d.u) * widthM,
    z: bottomZ + (1 - d.v) * heightM,
    color: d.color ?? null,
  }));

  const sep =
    Math.max(1.45, minSeparation) * Math.max(1, Number(spacingFactor) || 1);
  const sepZ = Math.max(sep, verticalSeparation);
  const eps = 1e-6;

  for (let iter = 0; iter < relaxIterations; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const dz = pts[j].z - pts[i].z;
        if (
          Math.abs(dx) >= sep ||
          Math.abs(dy) >= sep ||
          Math.abs(dz) >= sepZ
        ) {
          continue;
        }
        moved = true;
        // 세 축 중 이동량이 덜 드는 축을 밀어 왜곡을 최소화
        const needX = sep - Math.abs(dx);
        const needY = sep - Math.abs(dy);
        const needZ = sepZ - Math.abs(dz);
        if (needX <= needY && needX <= needZ) {
          const need = needX / 2 + eps;
          const dir = dx >= 0 ? 1 : -1;
          pts[j].x += dir * need;
          pts[i].x -= dir * need;
        } else if (needY <= needZ) {
          const need = needY / 2 + eps;
          const dir = dy >= 0 ? 1 : -1;
          pts[j].y += dir * need;
          pts[i].y -= dir * need;
        } else {
          const need = needZ / 2 + eps;
          const dir = dz >= 0 ? 1 : -1;
          pts[j].z += dir * need;
          pts[i].z -= dir * need;
        }
      }
    }
    if (!moved) break;
  }

  let worst = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const r = Math.max(
        Math.abs(pts[j].x - pts[i].x) / sep,
        Math.abs(pts[j].y - pts[i].y) / sep,
        Math.abs(pts[j].z - pts[i].z) / sepZ
      );
      if (r < worst) worst = r;
    }
  }
  let scaledUp = false;
  if (pts.length > 1 && worst < 1) {
    scaledUp = true;
    const factor = (1 / Math.max(worst, 1e-9)) * 1.001;
    let cx0 = 0;
    let cy0 = 0;
    let cz0 = 0;
    for (const p of pts) {
      cx0 += p.x;
      cy0 += p.y;
      cz0 += p.z;
    }
    cx0 /= pts.length;
    cy0 /= pts.length;
    cz0 /= pts.length;
    for (const p of pts) {
      p.x = cx0 + (p.x - cx0) * factor;
      p.y = cy0 + (p.y - cy0) * factor;
      p.z = cz0 + (p.z - cz0) * factor;
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  if (minZ < bottomZ) {
    const lift = bottomZ - minZ;
    for (const p of pts) p.z += lift;
    maxZ += lift;
    minZ = bottomZ;
  }

  return {
    points: pts,
    widthM: maxY - minY,
    heightM: maxZ - minZ,
    depthSpanM: maxX - minX,
    scaledUp,
  };
}

/**
 * 배치된 점들을 드론 id에 할당해 phase points 맵으로 변환.
 * 점을 (아래→위, 왼쪽→오른쪽) 순으로 정렬해 드론 순번과 짝지어
 * 결과가 결정론적이 되게 한다. 점에 x가 있으면(3D 배치) 그대로 쓰고,
 * 없으면(평면 배치) planeX를 적용한다.
 */
export function assignDotsToDrones(points, droneIds, { planeX = 0 } = {}) {
  const sorted = points
    .map((p, index) => ({ ...p, index }))
    .sort((a, b) => a.z - b.z || a.y - b.y);
  const result = {};
  const n = Math.min(sorted.length, droneIds.length);
  for (let i = 0; i < n; i++) {
    const x = Number.isFinite(sorted[i].x) ? sorted[i].x : planeX;
    const entry = {
      x: Math.round(x * 10000) / 10000,
      y: Math.round(sorted[i].y * 10000) / 10000,
      z: Math.round(sorted[i].z * 10000) / 10000,
      yaw: 0,
    };
    if (Array.isArray(sorted[i].color) && sorted[i].color.length === 3) {
      entry.color = sorted[i].color.map((c) =>
        Math.max(0, Math.min(255, Math.round(Number(c) || 0)))
      );
    }
    result[String(droneIds[i])] = entry;
  }
  return result;
}
