import AFrame from '@skybrush/aframe-components';
import PropTypes from 'prop-types';
import React from 'react';

import { UR9_TARGET_SIZE_M } from '~/aframe/components/fbx-model';
import { computePlaybackFrame } from '~/features/led-editor/utils';
import store from '~/store';

const { THREE } = AFrame;

// Simulation render: draw all drones as one InstancedMesh of coloured spheres
// instead of a per-drone OBJ model, so 100+ drones stay fast (one draw call, no
// per-drone point light, no per-drone LED-panel meshes).
//
// IMPORTANT: only the VISUAL changes. DroneShapeMarkers keeps the per-drone
// a-entity parents (data-*, position) mounted even in sphere mode — those are
// the source of truth for drone-move-bridge, the axis gizmo, formation capture,
// etc. This component only mirrors those existing entities into the instanced
// mesh and handles sphere click → `drone-selected`.
const SPHERE_RADIUS = 0.5; // metres
const SPHERE_SEGMENTS_W = 10;
const SPHERE_SEGMENTS_H = 8;
// Lift the sphere to the drone body's mid-height (positions are at the model
// base, like the OBJ marker) so spheres sit where the drones would.
const SPHERE_CENTER_Z = UR9_TARGET_SIZE_M.z / 2;
// Default body colour when no LED show drives the colour (matches the flock's
// DRONE_BODY_COLOR orange).
const DEFAULT_BODY_COLOR = 0xff8c00;
// Selected drones are painted red, matching the OBJ marker's selection tint
// (fbx-model `_select`), so the "드론 선택" panel and the 3D view agree.
const SELECTED_BODY_COLOR = 0xff0000;

function normalizeDroneIds(drones) {
  if (!Array.isArray(drones) || !drones.length) return [];

  return drones
    .map((d, index) => {
      const id =
        d.id !== undefined && d.id !== null && String(d.id).trim() !== ''
          ? String(d.id)
          : `drone-${index + 1}`;
      return id;
    })
    .filter(Boolean);
}

function findDroneEntity(droneId) {
  if (droneId == null || typeof document === 'undefined') return null;
  const id = String(droneId);
  const safeId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(id)
      : id;
  return document.querySelector(`a-scene [data-drone-id="${safeId}"]`);
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

const DroneSphereMarkers = React.memo(({ drones, selectedIds }) => {
  const ids = React.useMemo(() => normalizeDroneIds(drones), [drones]);
  const elRef = React.useRef(null);
  const meshRef = React.useRef(null);
  const entityByIdRef = React.useRef(new Map());

  const selectedSet = React.useMemo(
    () => new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String)),
    [selectedIds]
  );
  // Stable signature so the colour pass can cache on the selection as well.
  const selectionKey = React.useMemo(
    () => [...selectedSet].sort().join(','),
    [selectedSet]
  );

  // DroneShapeMarkers 부모가 먼저 마운트되므로, 한 프레임 뒤 엔티티 맵을 채운다.
  React.useEffect(() => {
    let rafId = requestAnimationFrame(() => {
      const map = new Map();
      for (const id of ids) {
        const el = findDroneEntity(id);
        if (el) map.set(id, el);
      }
      entityByIdRef.current = map;
    });
    return () => cancelAnimationFrame(rafId);
  }, [ids]);

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
      if (!ids.length) return;

      const geometry = new THREE.SphereGeometry(
        SPHERE_RADIUS,
        SPHERE_SEGMENTS_W,
        SPHERE_SEGMENTS_H
      );
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mesh = new THREE.InstancedMesh(geometry, material, ids.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      const m = new THREE.Matrix4();
      const color = new THREE.Color(DEFAULT_BODY_COLOR);
      for (let i = 0; i < ids.length; i++) {
        let proxy = entityByIdRef.current.get(ids[i]);
        if (!proxy) {
          proxy = findDroneEntity(ids[i]);
          if (proxy) entityByIdRef.current.set(ids[i], proxy);
        }
        const p = proxy?.object3D?.position;
        const x = p?.x ?? 0;
        const y = p?.y ?? 0;
        const z = p?.z ?? 0;
        m.makeTranslation(x, y, z + SPHERE_CENTER_Z);
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
  }, [ids]);

  // Per-frame sync: mirror each drone entity's (local) position into its
  // instance matrix. The DroneShapeMarkers parents are the single source of
  // truth and are moved by the exact same events as when OBJ is shown.
  React.useEffect(() => {
    const matrix = new THREE.Matrix4();
    let rafId = null;

    const tick = () => {
      const mesh = meshRef.current;
      if (mesh) {
        let changed = false;
        for (let i = 0; i < ids.length; i++) {
          let proxy = entityByIdRef.current.get(ids[i]);
          if (!proxy?.object3D) {
            proxy = findDroneEntity(ids[i]);
            if (proxy) entityByIdRef.current.set(ids[i], proxy);
          }
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
  }, [ids]);

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
      const key = `${hasShow ? boards.length : 0}:${playheadSec}:${syncEnabled}:${selectionKey}`;
      if (key === lastKey) return;
      lastKey = key;

      const frame = hasShow
        ? computePlaybackFrame(boards, led.droneCount, led.ledsPerDrone, playheadSec)
        : null;
      const color = new THREE.Color();
      for (let i = 0; i < ids.length; i++) {
        const rep = frame?.drones ? representativeColor(frame.drones[i]) : null;
        if (selectedSet.has(ids[i])) {
          color.setHex(SELECTED_BODY_COLOR);
        } else if (rep) {
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
  }, [ids, selectedSet, selectionKey]);

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

      // Ctrl/Cmd/Shift = 다중 선택 토글. 토글 클릭으로 빈 곳을 눌러도 기존
      // 선택은 유지한다 (click-pick과 동일 규칙).
      const additive = Boolean(event.ctrlKey || event.metaKey || event.shiftKey);
      // Alt = 그룹(클러스터) 동시 선택을 건너뛰고 이 드론만 고른다.
      const solo = Boolean(event.altKey);

      const hit = raycaster
        .intersectObject(mesh, false)
        .find((h) => h.instanceId !== undefined);
      if (!hit) {
        if (!additive) {
          window.dispatchEvent(new CustomEvent('drone-deselected'));
        }

        return;
      }
      const id = ids[hit.instanceId];
      if (!id) return;

      let proxy = entityByIdRef.current.get(id);
      if (!proxy) {
        proxy = findDroneEntity(id);
        if (proxy) entityByIdRef.current.set(id, proxy);
      }
      const p = proxy?.object3D?.position;
      const initialRaw = proxy?.getAttribute?.('data-initial-pos');
      const initialParts = String(initialRaw || '')
        .split(/\s+/)
        .map(Number);
      window.dispatchEvent(
        new CustomEvent('drone-selected', {
          detail: {
            additive,
            solo,
            id,
            name: proxy?.getAttribute?.('data-drone-name') || id,
            source: null,
            status: proxy?.getAttribute?.('data-status') || 'Idle',
            heading: String(proxy?.getAttribute?.('data-heading') ?? 0),
            currentPosition: p ? { x: p.x, y: p.y, z: p.z } : null,
            initialPosition: {
              x: Number.isFinite(initialParts[0]) ? initialParts[0] : 0,
              y: Number.isFinite(initialParts[1]) ? initialParts[1] : 0,
              z: Number.isFinite(initialParts[2]) ? initialParts[2] : 0,
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
  }, [ids]);

  return <a-entity ref={elRef} data-sphere-flock="true" />;
});

DroneSphereMarkers.displayName = 'DroneSphereMarkers';

DroneSphereMarkers.propTypes = {
  selectedIds: PropTypes.arrayOf(PropTypes.string),
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
