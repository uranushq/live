import AFrame from '@skybrush/aframe-components';
import PropTypes from 'prop-types';
import React from 'react';

import { UR9_TARGET_SIZE_M } from '~/aframe/components/fbx-model';
import { computePlaybackFrame } from '~/features/led-editor/utils';
import store from '~/store';

import { DEFAULT_DRONE_GROUND_POSITION } from './utils/threeDViewUtils';

const { THREE } = AFrame;

// Simulation render: draw all drones as one InstancedMesh of coloured spheres
// instead of a per-drone OBJ model, so 100+ drones stay fast (one draw call, no
// per-drone point light, no per-drone LED-panel meshes).
//
// IMPORTANT: only the VISUAL changes. Every drone still gets an invisible
// per-drone "proxy" a-entity carrying the exact same data-* attributes and
// position as the OBJ markers, so the whole existing event/data layer —
// drone-move-bridge (move/path/yaw/initial-pos events), the axis gizmo,
// position collection for formation payloads, hover/selection consumers —
// keeps working unchanged. A per-frame sync loop mirrors the proxies'
// positions into the instanced mesh, and clicking a sphere raycasts the
// instance and emits the same `drone-selected` event as click-pick.
const SPHERE_RADIUS = 0.5; // metres
const SPHERE_SEGMENTS_W = 10;
const SPHERE_SEGMENTS_H = 8;
// Lift the sphere to the drone body's mid-height (positions are at the model
// base, like the OBJ marker) so spheres sit where the drones would.
const SPHERE_CENTER_Z = UR9_TARGET_SIZE_M.z / 2;
// Default body colour when no LED show drives the colour (matches the flock's
// DRONE_BODY_COLOR orange).
const DEFAULT_BODY_COLOR = 0xff8c00;

// DroneShapeMarkers와 동일한 정규화 — 프록시 엔티티가 OBJ 마커와 같은
// 속성(data-*)을 노출해야 기존 소비자들이 차이를 못 느낀다.
function normalizeDrones(drones) {
  if (!Array.isArray(drones) || !drones.length) return [];

  return drones
    .map((d, index) => {
      const id =
        d.id !== undefined && d.id !== null && String(d.id).trim() !== ''
          ? String(d.id)
          : `drone-${index + 1}`;
      const name = d.name || id;
      const battery = Number.isFinite(Number(d.battery)) ? Number(d.battery) : 100;
      const status = d.status || 'Idle';
      const firstPathPoint = Array.isArray(d.path) && d.path.length ? d.path[0] : null;
      const fallbackPos =
        firstPathPoint &&
        Number.isFinite(Number(firstPathPoint.x)) &&
        Number.isFinite(Number(firstPathPoint.y)) &&
        Number.isFinite(Number(firstPathPoint.z))
          ? [Number(firstPathPoint.x), Number(firstPathPoint.y), Number(firstPathPoint.z)]
          : DEFAULT_DRONE_GROUND_POSITION;
      let initialPosArray = fallbackPos;
      if (Array.isArray(d.initialPos) && d.initialPos.length === 3) {
        initialPosArray = d.initialPos;
      } else if (Array.isArray(d.initial_position) && d.initial_position.length === 3) {
        initialPosArray = d.initial_position;
      }
      const posArray = firstPathPoint
        ? fallbackPos
        : Array.isArray(d.pos) && d.pos.length === 3
          ? d.pos
          : initialPosArray;
      const pathYaw =
        firstPathPoint && Number.isFinite(Number(firstPathPoint.yaw))
          ? Number(firstPathPoint.yaw)
          : null;
      const yaw = Number.isFinite(Number(d.yaw))
        ? Number(d.yaw)
        : Number.isFinite(Number(d.heading))
          ? Number(d.heading)
          : pathYaw ?? 0;

      return {
        id,
        name,
        battery,
        status,
        pos: posArray,
        initialPos: initialPosArray,
        path: Array.isArray(d.path) ? d.path : [],
        yaw,
      };
    })
    .filter((d) => d.id);
}

// Representative solid colour of an LED-show drone's k×k panel (the average of
// its non-black pixels), or null when the drone is dark / absent.
function representativeColor(pixels) {
  if (!Array.isArray(pixels) || !pixels.length) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let cnt = 0;
  for (const p of pixels) {
    if (!p) continue;
    if (p[0] || p[1] || p[2]) {
      r += p[0];
      g += p[1];
      b += p[2];
      cnt++;
    }
  }
  if (!cnt) return null;
  return [r / cnt / 255, g / cnt / 255, b / cnt / 255];
}

const DroneSphereMarkers = React.memo(({ drones }) => {
  const items = React.useMemo(() => normalizeDrones(drones), [drones]);
  const elRef = React.useRef(null);
  const meshRef = React.useRef(null);
  const proxyRefs = React.useRef(new Map()); // drone id -> a-entity

  const setProxyRef = React.useCallback((id) => {
    return (el) => {
      if (el) proxyRefs.current.set(id, el);
      else proxyRefs.current.delete(id);
    };
  }, []);

  // Build (and rebuild on count change) the instanced sphere mesh.
  React.useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;

    let disposed = false;

    const build = () => {
      if (disposed || !el.object3D) return;
      if (meshRef.current) {
        el.removeObject3D('sphere-flock');
        meshRef.current.geometry.dispose();
        meshRef.current.material.dispose();
        meshRef.current = null;
      }
      if (!items.length) return;

      const geometry = new THREE.SphereGeometry(
        SPHERE_RADIUS,
        SPHERE_SEGMENTS_W,
        SPHERE_SEGMENTS_H
      );
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mesh = new THREE.InstancedMesh(geometry, material, items.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      const m = new THREE.Matrix4();
      const color = new THREE.Color(DEFAULT_BODY_COLOR);
      for (let i = 0; i < items.length; i++) {
        const [x, y, z] = items[i].pos;
        m.makeTranslation(x, y, (Number(z) || 0) + SPHERE_CENTER_Z);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      el.setObject3D('sphere-flock', mesh);
      meshRef.current = mesh;
    };

    if (el.object3D) {
      build();
    } else {
      el.addEventListener('loaded', build, { once: true });
    }

    return () => {
      disposed = true;
      el.removeEventListener('loaded', build);
      if (meshRef.current) {
        el.removeObject3D('sphere-flock');
        meshRef.current.geometry.dispose();
        meshRef.current.material.dispose();
        meshRef.current = null;
      }
    };
  }, [items]);

  // Per-frame sync: mirror each proxy entity's (local) position into its
  // instance matrix. The proxies are the single source of truth and are moved
  // by the exact same events as the OBJ markers (drone-move-bridge, gizmo,
  // playback), so the spheres follow every interaction for free.
  React.useEffect(() => {
    const matrix = new THREE.Matrix4();
    let rafId = null;

    const tick = () => {
      const mesh = meshRef.current;
      if (mesh) {
        let changed = false;
        for (let i = 0; i < items.length; i++) {
          const proxy = proxyRefs.current.get(items[i].id);
          const p = proxy?.object3D?.position;
          if (!p) continue;
          matrix.makeTranslation(p.x, p.y, p.z + SPHERE_CENTER_Z);
          mesh.setMatrixAt(i, matrix);
          changed = true;
        }
        if (changed) mesh.instanceMatrix.needsUpdate = true;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [items]);

  // Drive per-instance colour from the LED show, updating only when the show or
  // the playhead actually changes (cheap: one Float32Array write per drone).
  // `drone-sphere-frame` events (dispatched by the 3D playback tick) carry the
  // dance-elapsed time so colours follow plain 3D playback even when the LED
  // clock is not the master.
  React.useEffect(() => {
    let overrideSec = null;
    let lastKey = '';

    const applyColors = () => {
      const mesh = meshRef.current;
      if (!mesh) return;
      const led = store.getState().ledEditor;
      const boards = led?.boards;
      const hasShow = Array.isArray(boards) && boards.length > 0;
      const syncEnabled = led?.threeDSync !== false;
      const playheadSec =
        overrideSec !== null && !syncEnabled
          ? overrideSec
          : led?.playheadSec ?? 0;
      const key = `${hasShow ? boards.length : 0}:${playheadSec}:${syncEnabled}`;
      if (key === lastKey) return;
      lastKey = key;

      const frame = hasShow
        ? computePlaybackFrame(boards, led.droneCount, led.ledsPerDrone, playheadSec)
        : null;
      const color = new THREE.Color();
      for (let i = 0; i < items.length; i++) {
        const rep = frame?.drones ? representativeColor(frame.drones[i]) : null;
        if (rep) {
          color.setRGB(rep[0], rep[1], rep[2]);
        } else {
          color.setHex(DEFAULT_BODY_COLOR);
        }
        mesh.setColorAt(i, color);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };

    const onFrame = (event) => {
      const tSec = Number(event?.detail?.tSec);
      if (Number.isFinite(tSec)) {
        overrideSec = tSec;
        applyColors();
      }
    };

    applyColors();
    const unsubscribe = store.subscribe(applyColors);
    window.addEventListener('drone-sphere-frame', onFrame);
    return () => {
      unsubscribe();
      window.removeEventListener('drone-sphere-frame', onFrame);
    };
  }, [items]);

  // 구체 클릭 = 드론 선택. InstancedMesh는 click-pick의 '.three-d-clickable'
  // 레이캐스트에 걸리지 않으므로 자체 레이캐스트로 instanceId를 찾아 기존
  // 선택 이벤트(drone-selected)를 같은 형식으로 쏜다. 빈 곳 클릭은 해제.
  // 카메라 드래그(5px 이상 이동)와 기즈모 드래그 중에는 무시.
  React.useEffect(() => {
    const sceneEl = document.querySelector('a-scene');
    const canvas = sceneEl?.canvas || sceneEl?.querySelector('canvas');
    if (!canvas) return undefined;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const onPointerDown = (event) => {
      downX = event.clientX;
      downY = event.clientY;
    };

    const onClick = (event) => {
      if (window.__droneAxisGizmoDragging) return;
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 5) return;
      const mesh = meshRef.current;
      const camera = sceneEl?.camera;
      if (!mesh || !camera) return;

      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);

      const hit = raycaster
        .intersectObject(mesh, false)
        .find((h) => h.instanceId !== undefined);
      if (!hit) {
        window.dispatchEvent(new CustomEvent('drone-deselected'));
        return;
      }
      const item = items[hit.instanceId];
      if (!item) return;

      // click-pick과 동일한 detail 형식으로 발행 — 프록시 엔티티에서 현재
      // 위치/초기 위치를 읽는다 (기즈모·패널이 같은 방식으로 반응).
      const proxy = proxyRefs.current.get(item.id);
      const p = proxy?.object3D?.position;
      window.dispatchEvent(
        new CustomEvent('drone-selected', {
          detail: {
            id: item.id,
            name: item.name,
            source: null,
            status: item.status,
            heading: String(item.yaw),
            currentPosition: p ? { x: p.x, y: p.y, z: p.z } : null,
            initialPosition: {
              x: Number(item.initialPos[0]) || 0,
              y: Number(item.initialPos[1]) || 0,
              z: Number(item.initialPos[2]) || 0,
            },
          },
        })
      );
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('click', onClick);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('click', onClick);
    };
  }, [items]);

  return (
    <>
      {/* 보이지 않는 프록시 엔티티: OBJ 마커와 동일한 데이터 계약
          (data-*, position, rotation) — 시각 자식만 없다. 이동 브리지,
          기즈모, 위치 수집 등 기존 레이어가 이 엔티티들을 그대로 쓴다. */}
      {items.map((d) => (
        <a-entity
          key={d.id}
          ref={setProxyRef(d.id)}
          position={d.pos.join(' ')}
          data-drone-id={d.id}
          data-drone-name={d.name}
          data-battery={d.battery}
          data-status={d.status}
          data-heading={d.yaw}
          data-initial-pos={d.initialPos.join(' ')}
          data-path={d.path && d.path.length ? JSON.stringify(d.path) : undefined}
        />
      ))}
      <a-entity ref={elRef} data-sphere-flock="true" />
    </>
  );
});

DroneSphereMarkers.displayName = 'DroneSphereMarkers';

DroneSphereMarkers.propTypes = {
  drones: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      battery: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      status: PropTypes.string,
      yaw: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      heading: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      pos: PropTypes.arrayOf(PropTypes.number),
      initialPos: PropTypes.arrayOf(PropTypes.number),
      initial_position: PropTypes.arrayOf(PropTypes.number),
      path: PropTypes.array,
    })
  ),
};

export default DroneSphereMarkers;
