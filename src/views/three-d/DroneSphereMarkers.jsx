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
// per-drone point light, no per-drone LED-panel meshes). The sphere colour
// comes from the LED show (which an image-to-path import populates), so each
// drone still shows "이미지에 맞는" colour. Only used while simulation mode is
// ON; normal authoring keeps the OBJ DroneShapeMarkers.
const SPHERE_RADIUS = 0.5; // metres
const SPHERE_SEGMENTS_W = 10;
const SPHERE_SEGMENTS_H = 8;
// Lift the sphere to the drone body's mid-height (positions are at the model
// base, like the OBJ marker) so spheres sit where the drones would.
const SPHERE_CENTER_Z = UR9_TARGET_SIZE_M.z / 2;
// Default body colour when no LED show drives the colour (matches the flock's
// DRONE_BODY_COLOR orange).
const DEFAULT_BODY_COLOR = 0xff8c00;

function normalizeDrones(drones) {
  if (!Array.isArray(drones) || !drones.length) return [];

  return drones
    .map((d, index) => {
      const id =
        d.id !== undefined && d.id !== null && String(d.id).trim() !== ''
          ? String(d.id)
          : `drone-${index + 1}`;
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

      return { id, pos: posArray };
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

  // Build (and rebuild on count/position change) the instanced sphere mesh.
  React.useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;

    let disposed = false;

    const build = () => {
      if (disposed || !el.object3D) return;
      // Remove any previous mesh.
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

  // Drive per-instance colour from the LED show, updating only when the show or
  // the playhead actually changes (cheap: one Float32Array write per drone).
  React.useEffect(() => {
    let lastKey = '';
    const applyColors = () => {
      const mesh = meshRef.current;
      if (!mesh) return;
      const led = store.getState().ledEditor;
      const boards = led?.boards;
      const hasShow = Array.isArray(boards) && boards.length > 0;
      const syncEnabled = led?.threeDSync !== false;
      const playheadSec = led?.playheadSec ?? 0;
      const key = `${hasShow ? boards.length : 0}:${playheadSec}:${syncEnabled}`;
      if (key === lastKey) return;
      lastKey = key;

      const frame =
        hasShow && syncEnabled
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

    applyColors();
    const unsubscribe = store.subscribe(applyColors);
    return unsubscribe;
  }, [items]);

  return <a-entity ref={elRef} data-sphere-flock="true" />;
});

DroneSphereMarkers.displayName = 'DroneSphereMarkers';

DroneSphereMarkers.propTypes = {
  drones: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      pos: PropTypes.arrayOf(PropTypes.number),
      initialPos: PropTypes.arrayOf(PropTypes.number),
      initial_position: PropTypes.arrayOf(PropTypes.number),
      path: PropTypes.array,
    })
  ),
};

export default DroneSphereMarkers;
