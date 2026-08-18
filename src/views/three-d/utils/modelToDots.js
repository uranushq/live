/**
 * 3D 모델 → 대표 점(dot) 추출.
 *
 * "이미지 → 3D → 점" 파이프라인의 3D 구간: 생성형 AI(Meshy, Tripo 등)로
 * 이미지에서 만든 GLB/GLTF/OBJ 모델을 올리면,
 *
 *   1. 메시 표면을 면적 가중으로 균일 샘플링해 점군을 얻고 (수만 점),
 *   2. 3D k-means(고정 시드)로 드론 수만큼의 대표 점으로 압축한 뒤,
 *   3. 쇼 좌표계(NWU)로 스케일·배치하고 3축 체비셰프 최소 간격을 강제한다.
 *
 * 좌표 매핑 (남쪽에서 +x/북쪽을 바라보는 관객 기준):
 *   모델 +y(위)   → 쇼 +z (상하)
 *   모델 +x(우)   → 쇼 -y (관객이 보는 오른쪽 = 동쪽)
 *   모델 +z(정면) → 쇼 -x (관객 쪽)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

import { DOWNWASH_SAFE_VERTICAL_SEP } from './imageToDots';

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
 * 모델 파일에서 표면 점군을 샘플링한다.
 *
 * @param file  File (.glb/.gltf/.obj)
 * @returns Promise<Float32Array> — [x0,y0,z0, x1,y1,z1, ...] 모델 좌표
 */
export async function loadModelPoints(file, { samples = 20000 } = {}) {
  const name = String(file.name || '').toLowerCase();
  const buffer = await file.arrayBuffer();

  let root;
  if (name.endsWith('.obj')) {
    const text = new TextDecoder().decode(buffer);
    root = new OBJLoader().parse(text);
  } else {
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    root = gltf.scene || gltf.scenes?.[0];
  }
  if (!root) {
    throw new Error('모델을 읽을 수 없습니다');
  }

  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((node) => {
    if (node.isMesh && node.geometry) {
      meshes.push(node);
    }
  });
  if (!meshes.length) {
    throw new Error('모델에 메시가 없습니다');
  }

  // 메시별 표면적으로 샘플 수를 배분해 전체 표면을 균일하게 덮는다.
  const samplers = [];
  let totalArea = 0;
  for (const mesh of meshes) {
    try {
      const sampler = new MeshSurfaceSampler(mesh).build();
      // 근사 면적: 지오메트리 바운딩 스피어 기반 대신 sampler의 누적 분포
      // 마지막 값을 쓴다 (빌드 내부의 삼각형 면적 합).
      const area =
        sampler.distribution && sampler.distribution.length
          ? sampler.distribution[sampler.distribution.length - 1]
          : 1;
      samplers.push({ mesh, sampler, area });
      totalArea += area;
    } catch {
      // 샘플링 불가능한 지오메트리는 건너뛴다
    }
  }
  if (!samplers.length || totalArea <= 0) {
    throw new Error('모델 표면을 샘플링할 수 없습니다');
  }

  const points = new Float32Array(samples * 3);
  const position = new THREE.Vector3();
  let cursor = 0;
  for (let s = 0; s < samplers.length; s++) {
    const { mesh, sampler, area } = samplers[s];
    const count =
      s === samplers.length - 1
        ? samples - cursor
        : Math.round((area / totalArea) * samples);
    for (let i = 0; i < count && cursor < samples; i++) {
      sampler.sample(position);
      position.applyMatrix4(mesh.matrixWorld);
      points[cursor * 3] = position.x;
      points[cursor * 3 + 1] = position.y;
      points[cursor * 3 + 2] = position.z;
      cursor++;
    }
  }
  return points.subarray(0, cursor * 3);
}

/**
 * 드론 수·모델 정면 투영 점유율에 맞는 권장 폭(m)을 계산한다.
 *
 * 정면(관객) 투영 = 모델 x(→쇼 y) × 모델 y(→쇼 z) 평면. 표면 점군을
 * 그리드에 투영해 실루엣 점유율 f 를 재고, 필요한 면적
 * N × sepY × sepZ × 여유가 f × 폭 × 높이에 들어가도록 폭을 역산한다.
 */
export function suggestModelWidth(
  points,
  count,
  { minSeparation = 1.45, spacingFactor = 1.4, headroom = 1.35 } = {}
) {
  const n = Math.floor(points.length / 3);
  const sepY =
    Math.max(1.45, minSeparation) * Math.max(1, Number(spacingFactor) || 1);
  const sepZ = Math.max(sepY, DOWNWASH_SAFE_VERTICAL_SEP);
  const needed = Math.max(1, count) * sepY * sepZ * headroom;
  if (!n) return Math.sqrt(needed);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = points[i * 3];
    const y = points[i * 3 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);

  const GRID = 48;
  const occupied = new Uint8Array(GRID * GRID);
  for (let i = 0; i < n; i++) {
    const gx = Math.min(
      GRID - 1,
      Math.floor(((points[i * 3] - minX) / spanX) * GRID)
    );
    const gy = Math.min(
      GRID - 1,
      Math.floor(((points[i * 3 + 1] - minY) / spanY) * GRID)
    );
    occupied[gy * GRID + gx] = 1;
  }
  let content = 0;
  for (let i = 0; i < occupied.length; i++) content += occupied[i];
  const f = Math.max(0.03, content / (GRID * GRID));
  const aspect = spanX / spanY;
  return Math.sqrt((needed / f) * aspect);
}

/**
 * 점군을 3D k-means로 count개의 대표 점으로 압축한다 (고정 시드).
 *
 * @returns [{x, y, z}] — 모델 좌표계
 */
export function kmeans3D(points, count, { seed = 20260802, iterations = 20 } = {}) {
  const n = Math.floor(points.length / 3);
  if (!n || count <= 0) return [];

  const rand = mulberry32(seed);
  const cx = new Float64Array(count);
  const cy = new Float64Array(count);
  const cz = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const i = Math.floor(rand() * n);
    cx[k] = points[i * 3];
    cy[k] = points[i * 3 + 1];
    cz[k] = points[i * 3 + 2];
  }

  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  const sumZ = new Float64Array(count);
  const num = new Float64Array(count);
  for (let iter = 0; iter < iterations; iter++) {
    sumX.fill(0);
    sumY.fill(0);
    sumZ.fill(0);
    num.fill(0);
    for (let i = 0; i < n; i++) {
      const x = points[i * 3];
      const y = points[i * 3 + 1];
      const z = points[i * 3 + 2];
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < count; k++) {
        const dx = x - cx[k];
        const dy = y - cy[k];
        const dz = z - cz[k];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      sumX[best] += x;
      sumY[best] += y;
      sumZ[best] += z;
      num[best]++;
    }
    for (let k = 0; k < count; k++) {
      if (num[k] > 0) {
        cx[k] = sumX[k] / num[k];
        cy[k] = sumY[k] / num[k];
        cz[k] = sumZ[k] / num[k];
      } else {
        const i = Math.floor(rand() * n);
        cx[k] = points[i * 3];
        cy[k] = points[i * 3 + 1];
        cz[k] = points[i * 3 + 2];
      }
    }
  }

  const dots = [];
  for (let k = 0; k < count; k++) {
    dots.push({ x: cx[k], y: cy[k], z: cz[k] });
  }
  return dots;
}

/**
 * 3축 체비셰프 최소 간격 강제 (반복 밀어내기 + 부족 시 전체 확대).
 * 수직(z)은 다운워시 회피 기둥 때문에 수평보다 넓은 간격이 필요하다.
 */
function enforceSeparation3D(pts, sep, sepZ = sep, relaxIterations = 120) {
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
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (const p of pts) {
      mx += p.x;
      my += p.y;
      mz += p.z;
    }
    mx /= pts.length;
    my /= pts.length;
    mz /= pts.length;
    for (const p of pts) {
      p.x = mx + (p.x - mx) * factor;
      p.y = my + (p.y - my) * factor;
      p.z = mz + (p.z - mz) * factor;
    }
  }
  return scaledUp;
}

/**
 * 모델 좌표의 대표 점들을 쇼 좌표(NWU)로 배치.
 *
 * @returns {points: [{x,y,z}], widthM, heightM, depthSpanM, scaledUp}
 */
export function layoutModelDots(
  modelDots,
  {
    widthM = 20,
    bottomZ = 5,
    planeX = 0,
    minSeparation = 1.45,
    spacingFactor = 1.4,
    // 세로 간격 하한 (m) — 바닥 평면처럼 "세로"가 고도가 아니면 0을 넘긴다.
    verticalSeparation = DOWNWASH_SAFE_VERTICAL_SEP,
  }
) {
  if (!modelDots.length) {
    return { points: [], widthM, heightM: 0, depthSpanM: 0, scaledUp: false };
  }

  // 모델 바운드
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const d of modelDots) {
    if (d.x < minX) minX = d.x;
    if (d.x > maxX) maxX = d.x;
    if (d.y < minY) minY = d.y;
    if (d.y > maxY) maxY = d.y;
    if (d.z < minZ) minZ = d.z;
    if (d.z > maxZ) maxZ = d.z;
  }
  const extentX = Math.max(1e-6, maxX - minX);
  const scale = widthM / extentX;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  // 모델 → 쇼 축 매핑: y(위)→z, x(우)→-y, z(정면)→-x
  const pts = modelDots.map((d) => ({
    x: planeX - (d.z - centerZ) * scale,
    y: -(d.x - centerX) * scale,
    z: bottomZ + (d.y - minY) * scale,
  }));

  const sep =
    Math.max(1.45, minSeparation) * Math.max(1, Number(spacingFactor) || 1);
  const scaledUp = enforceSeparation3D(
    pts,
    sep,
    Math.max(sep, verticalSeparation)
  );

  let loX = Infinity, hiX = -Infinity;
  let loY = Infinity, hiY = -Infinity;
  let loZ = Infinity, hiZ = -Infinity;
  for (const p of pts) {
    if (p.x < loX) loX = p.x;
    if (p.x > hiX) hiX = p.x;
    if (p.y < loY) loY = p.y;
    if (p.y > hiY) hiY = p.y;
    if (p.z < loZ) loZ = p.z;
    if (p.z > hiZ) hiZ = p.z;
  }
  if (loZ < bottomZ) {
    const lift = bottomZ - loZ;
    for (const p of pts) p.z += lift;
    hiZ += lift;
    loZ = bottomZ;
  }

  return {
    points: pts,
    widthM: hiY - loY,
    heightM: hiZ - loZ,
    depthSpanM: hiX - loX,
    scaledUp,
  };
}
