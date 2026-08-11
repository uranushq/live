import React from 'react';
import PropTypes from 'prop-types';

import {
  showYawToModelRotationZ,
  UR9_TARGET_SIZE_M,
} from '~/aframe/components/fbx-model';
import { hasFeature } from '~/utils/configuration';

import { DEFAULT_DRONE_GROUND_POSITION } from './utils/threeDViewUtils';

const ledShowEnabled = hasFeature('ledShow');

/** Invisible pick sphere — matches Navigate outdoor pick (radius × 1.8). */
const DRONE_PICK_RADIUS = 0.9;
/** Model origin is at the feet; lift the pick volume to body mid-height. */
const DRONE_BODY_CENTER_Z = UR9_TARGET_SIZE_M.z / 2;

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
      const posArray = firstPathPoint ? fallbackPos : (Array.isArray(d.pos) && d.pos.length === 3 ? d.pos : initialPosArray);
      const pathYaw = firstPathPoint && Number.isFinite(Number(firstPathPoint.yaw))
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

const DroneShapeMarkers = React.memo(({ drones, showModels = true }) => {
  const items = normalizeDrones(drones);

  return items.map((d, index) => (
    <a-entity
      key={d.id}
      position={d.pos.join(' ')}
      rotation={`0 0 ${showYawToModelRotationZ(d.yaw) ?? 0}`}
      data-drone-id={d.id}
      data-drone-name={d.name}
      data-battery={d.battery}
      data-status={d.status}
      data-heading={d.yaw}
      data-initial-pos={d.initialPos.join(' ')}
      data-path={d.path && d.path.length ? JSON.stringify(d.path) : undefined}
    >
      {/* 구체 모드에서는 시각(OBJ/LED)만 떼고 부모 엔티티는 유지한다.
          위치·선택·기즈모 계약이 끊기지 않고, 체크 해제 시 모델만 다시 붙는다. */}
      {showModels && (
        <a-entity mixin="drone-marker" class="three-d-clickable" />
      )}
      {/* OBJ 메시보다 넓은 투명 피킹 구 — Navigate(drone-flock)와 동일 목적 */}
      {showModels && (
        <a-entity
          class="three-d-clickable"
          position={`0 0 ${DRONE_BODY_CENTER_Z}`}
          geometry={`primitive: sphere; radius: ${DRONE_PICK_RADIUS}; segmentsWidth: 10; segmentsHeight: 8`}
          material="opacity: 0; transparent: true; depthWrite: false; shader: flat"
        />
      )}
      {showModels && ledShowEnabled && (
        <a-entity drone-led-panel={`index: ${index}`} />
      )}
    </a-entity>
  ));
});

DroneShapeMarkers.displayName = 'DroneShapeMarkers';

DroneShapeMarkers.propTypes = {
  showModels: PropTypes.bool,
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

export default DroneShapeMarkers;
