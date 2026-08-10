/**
 * @file Component that shows a three-dimensional view of the drone flock.
 */

import PropTypes from 'prop-types';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connect } from 'react-redux';
import { createSelector } from '@reduxjs/toolkit';
import SunCalc from 'suncalc';

import CoordinateSystemAxes from './CoordinateSystemAxes';
import DroneShapeMarkers from './DroneShapeMarkers';
import DroneSphereMarkers from './DroneSphereMarkers';
import DronePathTrajectories from './DronePathTrajectories';
import HomePositionMarkers from './HomePositionMarkers';
import LandingPositionMarkers from './LandingPositionMarkers';
import Room from './Room';
import SatelliteMapGround from './SatelliteMapGround';
import Scenery from './Scenery';
import SelectedTrajectories from './SelectedTrajectories';
import DroneInfoPanel from './DroneInfoPanel';
import DroneSelectPanel from './DroneSelectPanel';
import ImageToDotsModal from './ImageToDotsModal';
import PathControlPanel from './PathControlPanel';
import AddDroneModal from './AddDroneModal';
import FormationGridModal, { MAX_GRID_COUNT } from './FormationGridModal';
import PathGeneratorModal from './PathGeneratorModal';
import useThreeDViewDroneEvents from './hooks/useThreeDViewDroneEvents';
import {
  applyDronePathsToScene,
  buildPathDeliveryPayloadFromConfig,
  buildSeekPathWithInitial,
  collectConfigFromScene as collectConfigFromSceneUtil,
  isDroneConfigState,
  DRONE_PATH_FLUSH_REQUEST,
  getEffectiveScenery as getEffectiveSceneryUtil,
  getPathTotalDurationMs,
  mergePathOverridesIntoDrones,
  normalizeDroneForConfigIO,
  normalizeDronesFromConfigImport,
  DEFAULT_DRONE_GROUND_POSITION,
  parsePositionLike,
  slicePathByElapsedMs,
} from './utils/threeDViewUtils';
import {
  getProfileExp,
  getProfileLog,
  getVelocitySmoothing,
} from './utils/pathSmoothing';
import { exportPatchedSkycFromShow } from './utils/skycExportUtils';
import { getShowSpecDroneConfigForThreeDView } from './showSpecDroneConfig';

// eslint-disable-next-line no-unused-vars
import AFrame from '~/aframe';
import { objectToString } from '~/aframe/utils';
import Colors from '~/components/colors';
import {
  getLightingConditionsForThreeDView,
  getSceneryForThreeDView,
} from '~/features/settings/selectors';
import { getReverseMissionMapping } from '~/features/mission/selectors';
import { setViewRuntimeState } from '~/features/three-d/slice';
import {
  getBase64ShowBlob,
  getDroneSwarmSpecification,
  isShowIndoor,
} from '~/features/show/selectors';
import {
  isMapCoordinateSystemLeftHanded,
} from '~/selectors/map';
import {
  importShow,
  setPlayhead,
  setPlaying,
  setThreeDSync,
  setFormationSync,
  upsertImageBoard,
} from '~/features/led-editor/slice';
import {
  getPlayheadSec,
  getPlaying,
  getThreeDSync,
  getTimelineDuration,
} from '~/features/led-editor/selectors';
import store from '~/store';

const getEffectiveScenery = (state) => {
  return getEffectiveSceneryUtil(state, getSceneryForThreeDView, isShowIndoor);
};

const getNaturalLightingForThreeDView = (state) => {
  const origin = state.map.origin.position;
  if (!Array.isArray(origin)) {
    return getLightingConditionsForThreeDView(state);
  }

  const [lon, lat] = origin;
  const { altitude } = SunCalc.getPosition(new Date(), lat, lon);
  return altitude < -0.05 ? 'dark' : 'light';
};

/** 드론 id로 씬의 마커 엔티티(또는 구체 모드의 프록시)를 찾는다. */
const findDroneEntityById = (droneId) => {
  if (droneId == null || typeof document === 'undefined') {
    return null;
  }

  const id = String(droneId);
  const safeId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(id)
      : id;
  return document.querySelector(`a-scene [data-drone-id="${safeId}"]`);
};

/**
 * 드론 엔티티에서 OBJ 모델 컴포넌트를 찾는다 — 선택 하이라이트(빨간 틴트)를
 * 걸 대상. 시각 자식이 없는 구체 모드 프록시에서는 null이 나온다.
 */
const findFbxModelComponent = (el) => {
  if (el?.components?.['fbx-model']) {
    return el.components['fbx-model'];
  }

  for (const child of Array.from(el?.children ?? [])) {
    const component = child?.components?.['fbx-model'];
    if (component) {
      return component;
    }
  }

  return null;
};

const DEFAULT_PATH_DELIVERY_URL = '/api/v1/path-planner/plan';
const PATH_DELIVERY_PROXY_TARGET = 'http://localhost:5001/api/v1/path-planner/plan';
const PATH_DELIVERY_STATUS_DISMISS_MS = 5000;

// Distinct colours cycled across formation regions on the LED timeline.
const FORMATION_COLORS = Object.freeze([
  '#42a5f5',
  '#66bb6a',
  '#ffa726',
  '#ab47bc',
  '#ef5350',
  '#26c6da',
  '#d4e157',
  '#ec407a',
]);

// 드론 간 최소 간격의 절대 하한 (m). 백엔드 HARD_MIN_SEPARATION과 동일 —
// 어떤 축에서도 이보다 가까워질 수 없고, 사용자 설정으로도 낮출 수 없다.
export const HARD_MIN_SEPARATION_M = 1.45;

const DEFAULT_FORMATION_SETTINGS = Object.freeze({
  step_size: 1.0,
  // duration_ms를 보내면 서버가 cruise_speed를 무시하므로 cruise_speed만 사용.
  cruise_speed: 0.1,
  takeoff_time: 0,
  auto_upload: false,
  // 빈 문자열 = 백엔드 기본값(.skyc 다운로드) 사용. payload에서 output 키를 생략.
  output: '',
  // 드론 간 최소 간격 (모든 축, m). 1.5 미만으로는 내려갈 수 없다.
  min_separation: HARD_MIN_SEPARATION_M,
});

// 첫 번째 항목('')은 "백엔드 기본값(=skyc) 사용". 그 외 값을 선택하면 명시적으로 전송.
const FORMATION_OUTPUT_OPTIONS = ['', 'path', 'show', 'skyc'];

const cssEscape = (value) => {
  const raw = String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(raw);
  }
  return raw;
};

const roundCoord = (value) => Math.round(value * 10000) / 10000;

const readDronePositionFromDom = (droneId) => {
  if (typeof document === 'undefined' || !droneId) return null;
  const target = document.querySelector(
    `a-scene [data-drone-id="${cssEscape(droneId)}"]`
  );
  const pos = target?.getAttribute?.('position');
  if (!pos || typeof pos !== 'object') return null;
  const x = Number(pos.x);
  const y = Number(pos.y);
  const z = Number(pos.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  const point = { x: roundCoord(x), y: roundCoord(y), z: roundCoord(z) };
  const yaw = Number(target.getAttribute('data-heading'));
  if (Number.isFinite(yaw)) {
    point.yaw = roundCoord(yaw);
  }
  return point;
};

const readAllDronePositionsFromDom = () => {
  const result = {};
  if (typeof document === 'undefined') return result;
  const targets = document.querySelectorAll('a-scene [data-drone-id]');
  targets.forEach((el) => {
    const id = el.getAttribute('data-drone-id');
    if (!id) return;
    const pos = readDronePositionFromDom(id);
    if (pos) result[id] = pos;
  });
  return result;
};

const getDroneInitialPositionTuple = (drone) => {
  // path의 첫 점이 곧 시작 위치. 없으면 기존 initialPos/pos로 fallback.
  const firstPathPoint = Array.isArray(drone?.path) && drone.path.length > 0
    ? drone.path[0]
    : null;
  if (firstPathPoint) {
    const fx = Number(firstPathPoint.x);
    const fy = Number(firstPathPoint.y);
    const fz = Number(firstPathPoint.z);
    if (Number.isFinite(fx) && Number.isFinite(fy) && Number.isFinite(fz)) {
      return [fx, fy, fz];
    }
  }

  const initial = Array.isArray(drone?.initialPos) && drone.initialPos.length >= 3
    ? drone.initialPos
    : drone?.pos;
  if (!Array.isArray(initial) || initial.length < 3) return [0, 0, 0];
  const x = Number(initial[0]);
  const y = Number(initial[1]);
  const z = Number(initial[2]);
  return [
    Number.isFinite(x) ? x : 0,
    Number.isFinite(y) ? y : 0,
    Number.isFinite(z) ? z : 0,
  ];
};

/** 새로고침 후 복원 시: 패널의 초기 위치(initialPos)가 있으면 그것을, 없으면 기존 규칙(path 첫 점 등)을 사용 */
const getDroneHomePositionTupleForReload = (drone) => {
  if (Array.isArray(drone?.initialPos) && drone.initialPos.length >= 3) {
    const x = Number(drone.initialPos[0]);
    const y = Number(drone.initialPos[1]);
    const z = Number(drone.initialPos[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return [x, y, z];
    }
  }
  return getDroneInitialPositionTuple(drone);
};

const sanitizeFormationSettings = (settings) => {
  const merged = { ...DEFAULT_FORMATION_SETTINGS, ...(settings || {}) };
  const stepSize = Number(merged.step_size);
  const resolvedStepSize =
    Number.isFinite(stepSize) && stepSize > 0
      ? stepSize
      : DEFAULT_FORMATION_SETTINGS.step_size;
  let cruiseSpeed = Number(merged.cruise_speed);
  // 예전 저장값(duration_ms)만 있으면 step당 속도로 환산.
  if (!(Number.isFinite(cruiseSpeed) && cruiseSpeed > 0)) {
    const legacyDurationMs = Number(merged.duration_ms);
    if (Number.isFinite(legacyDurationMs) && legacyDurationMs > 0) {
      cruiseSpeed = (resolvedStepSize * 1000) / legacyDurationMs;
    }
  }
  const takeoffTime = Number(merged.takeoff_time);
  const rawOutput = merged.output == null ? '' : String(merged.output);
  const output = FORMATION_OUTPUT_OPTIONS.includes(rawOutput)
    ? rawOutput
    : DEFAULT_FORMATION_SETTINGS.output;
  // 최소 간격: 어떤 입력이 와도 절대 하한(1.5 m) 밑으로는 내려가지 않는다.
  const minSeparation = Number(merged.min_separation);
  const resolvedMinSeparation = Number.isFinite(minSeparation)
    ? Math.max(HARD_MIN_SEPARATION_M, minSeparation)
    : HARD_MIN_SEPARATION_M;
  return {
    step_size: resolvedStepSize,
    cruise_speed: Number.isFinite(cruiseSpeed) && cruiseSpeed > 0
      ? cruiseSpeed
      : DEFAULT_FORMATION_SETTINGS.cruise_speed,
    takeoff_time: Number.isFinite(takeoffTime) && takeoffTime >= 0
      ? takeoffTime
      : DEFAULT_FORMATION_SETTINGS.takeoff_time,
    auto_upload: !!merged.auto_upload,
    output,
    min_separation: resolvedMinSeparation,
  };
};

const generateImportedFormationPhaseId = (index) =>
  `phase-import-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeFormationPhaseForImport = (raw, index) => {
  const id =
    raw?.id != null && String(raw.id).trim() !== ''
      ? String(raw.id)
      : generateImportedFormationPhaseId(index);
  const name = String(raw?.name ?? '').trim() || `phase-${index + 1}`;
  const holdMs = Math.max(0, Math.round(Number(raw?.holdMs) || 0));
  const points = {};
  const rawPoints = raw?.points;
  if (rawPoints && typeof rawPoints === 'object' && !Array.isArray(rawPoints)) {
    Object.entries(rawPoints).forEach(([droneId, pos]) => {
      if (droneId == null || String(droneId).trim() === '') return;
      const x = Number(pos?.x);
      const y = Number(pos?.y);
      const z = Number(pos?.z);
      const yaw = Number(pos?.yaw);
      const hasPosition =
        Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
      const hasYaw = Number.isFinite(yaw);
      if (!hasPosition && !hasYaw) return;
      const point = {};
      if (hasPosition) {
        point.x = x;
        point.y = y;
        point.z = z;
      }
      if (hasYaw) {
        point.yaw = yaw;
      }
      points[String(droneId)] = point;
    });
  }
  // 직선 고정 드론 목록. 과거 포맷(fixedPaths 객체)은 키만 취해 호환한다.
  const fixedDroneIds = [];
  const rawFixedIds = Array.isArray(raw?.fixedDroneIds)
    ? raw.fixedDroneIds
    : raw?.fixedPaths && typeof raw.fixedPaths === 'object'
      ? Object.keys(raw.fixedPaths)
      : [];
  rawFixedIds.forEach((droneId) => {
    const key = droneId != null ? String(droneId).trim() : '';
    if (key && !fixedDroneIds.includes(key)) {
      fixedDroneIds.push(key);
    }
  });
  // 클러스터(강체 그룹): [[droneId, ...], ...]
  const clusters = [];
  if (Array.isArray(raw?.clusters)) {
    raw.clusters.forEach((cluster) => {
      if (!Array.isArray(cluster)) return;
      const clean = [];
      cluster.forEach((droneId) => {
        const key = droneId != null ? String(droneId).trim() : '';
        if (key && !clean.includes(key)) {
          clean.push(key);
        }
      });
      if (clean.length) {
        clusters.push(clean);
      }
    });
  }
  const phase = { id, name, holdMs, points };
  if (fixedDroneIds.length) {
    phase.fixedDroneIds = fixedDroneIds;
  }
  if (clusters.length) {
    phase.clusters = clusters;
  }
  const lattice = normalizeFormationLattice(raw?.lattice);
  if (lattice) {
    phase.lattice = lattice;
  }
  return phase;
};

/** 그리드 툴이 저장한 격자 파라미터 정규화 */
const normalizeFormationLattice = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const nx = Math.round(Number(raw.nx));
  const ny = Math.round(Number(raw.ny));
  const nz = Math.round(Number(raw.nz));
  const sx = Number(raw.sx);
  const sy = Number(raw.sy);
  const sz = Number(raw.sz);
  const ax = Number(raw.ax);
  const ay = Number(raw.ay);
  const az = Number(raw.az);
  if (
    ![nx, ny, nz, sx, sy, sz, ax, ay, az].every((v) => Number.isFinite(v)) ||
    nx < 1 ||
    ny < 1 ||
    nz < 1 ||
    sx <= 0 ||
    sy <= 0 ||
    sz <= 0
  ) {
    return null;
  }
  return {
    nx: Math.min(MAX_GRID_COUNT, Math.max(1, nx)),
    ny: Math.min(MAX_GRID_COUNT, Math.max(1, ny)),
    nz: Math.min(MAX_GRID_COUNT, Math.max(1, nz)),
    sx,
    sy,
    sz,
    ax,
    ay,
    az: Math.max(0, az),
  };
};

const stripFormationFromDroneConfigRoot = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return {};
  const next = { ...parsed };
  delete next.formation;
  delete next.formation_phases;
  delete next.formation_settings;
  delete next.formationPhases;
  delete next.formationSettings;
  delete next.drones;
  return next;
};

/**
 * JSON에 show-drone-N / drone-N 등 서로 다른 id 체계가 섞여 있을 때,
 * phase.points 키를 현재 불러온 drones[].id와 맞춥니다.
 */
const remapFormationPhasesToDroneIds = (phases, drones) => {
  if (!Array.isArray(phases) || !phases.length) return phases;
  if (!Array.isArray(drones) || !drones.length) return phases;
  const droneIds = drones.map((d) => String(d?.id || '')).filter(Boolean);
  const droneIdSet = new Set(droneIds);
  if (!droneIds.length) return phases;

  const trailingNumber = (s) => {
    const m = String(s).match(/(\d+)\s*$/);
    return m ? Number(m[1]) : NaN;
  };

  return phases.map((phase) => {
    const raw =
      phase.points && typeof phase.points === 'object' && !Array.isArray(phase.points)
        ? phase.points
        : {};
    const entries = Object.entries(raw);
    if (!entries.length) return phase;
    if (entries.every(([k]) => droneIdSet.has(String(k)))) return phase;

    const keyMap = {};
    const newPoints = {};
    entries.forEach(([k, pos], i) => {
      const key = String(k);
      const assign = (mappedKey) => {
        keyMap[key] = mappedKey;
        newPoints[mappedKey] = pos;
      };
      if (droneIdSet.has(key)) {
        assign(key);
        return;
      }
      const n = trailingNumber(key);
      if (Number.isFinite(n) && n >= 1) {
        const byOrder = droneIds[n - 1];
        if (byOrder) {
          assign(byOrder);
          return;
        }
        const candDrone = `drone-${n}`;
        if (droneIdSet.has(candDrone)) {
          assign(candDrone);
          return;
        }
        const candShow = `show-drone-${n}`;
        if (droneIdSet.has(candShow)) {
          assign(candShow);
          return;
        }
      }
      if (droneIds.length === entries.length) {
        assign(droneIds[i]);
        return;
      }
      assign(key);
    });
    let next = { ...phase, points: newPoints };
    // 직선 고정 드론 목록과 클러스터도 phase.points와 같은 id 매핑을 따른다.
    const mapId = (k) => {
      const key = String(k);
      return keyMap[key] || (droneIdSet.has(key) ? key : null);
    };
    if (Array.isArray(phase.fixedDroneIds) && phase.fixedDroneIds.length) {
      const newFixed = [];
      phase.fixedDroneIds.forEach((k) => {
        const mapped = mapId(k);
        if (mapped && !newFixed.includes(mapped)) {
          newFixed.push(mapped);
        }
      });
      next = { ...next, fixedDroneIds: newFixed };
    }
    if (Array.isArray(phase.clusters) && phase.clusters.length) {
      const newClusters = phase.clusters
        .map((cluster) =>
          (Array.isArray(cluster) ? cluster : [])
            .map(mapId)
            .filter((v, i, arr) => v && arr.indexOf(v) === i)
        )
        .filter((cluster) => cluster.length > 0);
      next = { ...next, clusters: newClusters };
    }
    return next;
  });
};

const readFormationImportFromParsed = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return null;

  if (parsed.formation && typeof parsed.formation === 'object') {
    const { phases: phasesRaw, settings: settingsRaw } = parsed.formation;
    const phases = Array.isArray(phasesRaw)
      ? phasesRaw.map((p, i) => normalizeFormationPhaseForImport(p, i))
      : [];
    const settings =
      settingsRaw && typeof settingsRaw === 'object'
        ? sanitizeFormationSettings(settingsRaw)
        : DEFAULT_FORMATION_SETTINGS;
    return { phases, settings };
  }

  if (
    Array.isArray(parsed.formationPhases) ||
    (parsed.formationSettings && typeof parsed.formationSettings === 'object')
  ) {
    const phases = Array.isArray(parsed.formationPhases)
      ? parsed.formationPhases.map((p, i) => normalizeFormationPhaseForImport(p, i))
      : [];
    const settings =
      parsed.formationSettings && typeof parsed.formationSettings === 'object'
        ? sanitizeFormationSettings(parsed.formationSettings)
        : DEFAULT_FORMATION_SETTINGS;
    return { phases, settings };
  }

  if (
    Array.isArray(parsed.formation_phases) ||
    (parsed.formation_settings && typeof parsed.formation_settings === 'object')
  ) {
    const phases = Array.isArray(parsed.formation_phases)
      ? parsed.formation_phases.map((p, i) => normalizeFormationPhaseForImport(p, i))
      : [];
    const settings =
      parsed.formation_settings && typeof parsed.formation_settings === 'object'
        ? sanitizeFormationSettings(parsed.formation_settings)
        : DEFAULT_FORMATION_SETTINGS;
    return { phases, settings };
  }

  return null;
};

const getPathDeliveryErrorMessage = async (response) => {
  const rawText = await response.text().catch(() => '');
  if (!rawText) return response.statusText || `요청 실패: ${response.status}`;

  try {
    const json = JSON.parse(rawText);
    const headline =
      (typeof json.error === 'string' && json.error) ||
      (typeof json.message === 'string' && json.message) ||
      '';

    // Collect any extra diagnostic fields the backend may include so we don't
    // hide useful validation info behind the short headline.
    const detailFields = [
      'details',
      'detail',
      'reason',
      'reasons',
      'errors',
      'validation',
      'validation_errors',
      'failed',
      'description',
    ];
    const extraParts = [];
    for (const key of detailFields) {
      const value = json[key];
      if (value === undefined || value === null) continue;
      const formatted =
        typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      if (formatted) extraParts.push(`${key}: ${formatted}`);
    }

    if (headline && extraParts.length) {
      return `${headline}\n${extraParts.join('\n')}`;
    }
    if (headline) return headline;
    if (extraParts.length) return extraParts.join('\n');
    return JSON.stringify(json, null, 2);
  } catch {
    return rawText;
  }
};

const buildSelectedDroneFromShowSpec = (drone) => {
  if (!drone?.id) return null;
  const next = {
    id: drone.id,
    name: drone.name || String(drone.id),
    battery: drone.battery,
    status: drone.status,
    path: Array.isArray(drone.path) ? drone.path.slice() : [],
  };
  if (Array.isArray(drone.initialPos) && drone.initialPos.length >= 3) {
    next.initialPosition = {
      x: Number(drone.initialPos[0]) || 0,
      y: Number(drone.initialPos[1]) || 0,
      z: Number(drone.initialPos[2]) || 0,
    };
  } else if (Array.isArray(drone.path) && drone.path.length > 0) {
    const p0 = drone.path[0];
    next.initialPosition = {
      x: Number(p0.x) || 0,
      y: Number(p0.y) || 0,
      z: Number(p0.z) || 0,
    };
  }
  return next;
};

const ThreeDView = React.forwardRef((props, ref) => {
  const {
    cameraRef,
    grid,
    interactionMode,
    isCreateMode: isCreateModeProp,
    isCoordinateSystemLeftHanded,
    lighting,
    navigation,
    naturalLighting,
    sceneId,
    scenery,
    showAxes,
    showHomePositions,
    showLandingPositions,
    showStatistics,
    showTrajectoriesOfSelection,
    showSpecDroneConfig,
    base64ShowBlob,
    showData,
    swarmSpecification,
    uavToMissionIndex,
    viewRuntime,
    persistRehydrated,
    onSetViewRuntimeState,
    ledPlayheadSec,
    ledPlaying,
    threeDSync,
    ledTimelineDuration,
  } = props;

  // Sync is only meaningful when an LED show exists (its playhead is the master
  // clock). With no boards the LED clock can't advance, so fall back to the
  // 3D view's own independent playback even when the checkbox is on.
  const syncActive = threeDSync && ledTimelineDuration > 0;

  const isCreateMode =
    typeof isCreateModeProp === 'boolean'
      ? isCreateModeProp
      : interactionMode === 'create';

  const persistedDroneConfig =
    viewRuntime && typeof viewRuntime === 'object' ? viewRuntime.droneConfig : null;
  const persistedFormationPhases =
    viewRuntime && typeof viewRuntime === 'object' && Array.isArray(viewRuntime.formationPhases)
      ? viewRuntime.formationPhases
      : [];
  const persistedFormationSettings =
    viewRuntime && typeof viewRuntime === 'object' ? viewRuntime.formationSettings : null;
  const persistedPathProgressRaw =
    viewRuntime && typeof viewRuntime === 'object' ? viewRuntime.pathProgress : 0;
  const persistedPathProgress = Number.isFinite(Number(persistedPathProgressRaw))
    ? Number(persistedPathProgressRaw)
    : 0;

  // 선택된 드론 정보 및 JSON에서 불러온 드론 구성
  const [selectedDrone, setSelectedDrone] = useState(null);
  const [droneConfig, setDroneConfig] = useState(() => (
    persistedDroneConfig && typeof persistedDroneConfig === 'object'
      ? persistedDroneConfig
      : null
  ));
  const [pendingAutoSelectDrone, setPendingAutoSelectDrone] = useState(null);
  const droneConfigRef = useRef(null);
  droneConfigRef.current = droneConfig;
  const pathOverridesByIdRef = useRef(new Map());
  const clearPathOverrides = useCallback(() => {
    pathOverridesByIdRef.current.clear();
  }, []);
  const ignorePersistedDroneConfigRef = useRef(false);
  const formationHydratedFromPersistRef = useRef(false);
  const snapDronesToHomeAfterRehydrateRef = useRef(false);

  // 드론 추가 모달
  const [addDroneModalOpen, setAddDroneModalOpen] = useState(false);
  const [formationGridModalOpen, setFormationGridModalOpen] = useState(false);
  const [formationGridEditPhaseId, setFormationGridEditPhaseId] = useState(null);
  const [pathGeneratorModalOpen, setPathGeneratorModalOpen] = useState(false);
  const [isSendingPaths, setIsSendingPaths] = useState(false);
  const [pathDeliveryStatus, setPathDeliveryStatus] = useState('');

  useEffect(() => {
    if (!pathDeliveryStatus) return undefined;
    const timer = setTimeout(
      () => setPathDeliveryStatus(''),
      PATH_DELIVERY_STATUS_DISMISS_MS
    );
    return () => clearTimeout(timer);
  }, [pathDeliveryStatus]);

  const [pathProgress, setPathProgress] = useState(persistedPathProgress);
  const [isPlaybackRunning, setIsPlaybackRunning] = useState(false);
  const playbackClockRef = useRef({ startElapsedMs: 0, startedAt: 0 });
  const playbackActiveDroneIdsRef = useRef([]);
  const playbackFinishedDroneIdsRef = useRef(new Set());

  // 시뮬레이션용 고속 구체 렌더: 켜면 드론 전체를 InstancedMesh 하나로
  // 즉시 그려 100대 이상에서도 프레임을 유지한다 (LED 쇼 색 반영).
  // 렌더링만 바뀐다 — 보이지 않는 프록시 엔티티가 OBJ 마커와 동일한
  // 데이터/이벤트 계약을 유지하므로 클릭 선택·기즈모·phase 캡처 등
  // 편집 기능은 그대로 동작한다.
  const [sphereSimRender, setSphereSimRender] = useState(false);

  const [formationPhases, setFormationPhases] = useState([]);
  const [lastReversedPhaseIds, setLastReversedPhaseIds] = useState([]);
  const [formationSettings, setFormationSettings] = useState(DEFAULT_FORMATION_SETTINGS);
  const [isSendingFormation, setIsSendingFormation] = useState(false);
  const [formationSendStartedAt, setFormationSendStartedAt] = useState(null);
  const [formationDeliveryStatus, setFormationDeliveryStatus] = useState('');
  // 백엔드 plan 응답의 실제 phase 타이밍(절대 초). phase/설정이 바뀌면
  // 무효화되고, 없으면 아래 formationTimeline 휴리스틱으로 폴백한다.
  const [plannedTimeline, setPlannedTimeline] = useState(null);

  useEffect(() => {
    setPlannedTimeline(null);
  }, [formationPhases, formationSettings]);

  useEffect(() => {
    if (ignorePersistedDroneConfigRef.current) {
      return;
    }
    if (!droneConfig && persistedDroneConfig && typeof persistedDroneConfig === 'object') {
      setDroneConfig(persistedDroneConfig);
    }
  }, [droneConfig, persistedDroneConfig]);

  // persist 복원 직후 한 번: 저장된 마지막 좌표가 아니라 초기 위치로 정렬 (다음 저장에도 반영)
  useEffect(() => {
    if (!persistRehydrated) return;
    if (ignorePersistedDroneConfigRef.current) return;
    if (snapDronesToHomeAfterRehydrateRef.current) return;

    if (
      showSpecDroneConfig &&
      Array.isArray(showSpecDroneConfig.drones) &&
      showSpecDroneConfig.drones.length
    ) {
      snapDronesToHomeAfterRehydrateRef.current = true;
      return;
    }

    const source =
      droneConfig && Array.isArray(droneConfig.drones) && droneConfig.drones.length
        ? droneConfig
        : persistedDroneConfig &&
            typeof persistedDroneConfig === 'object' &&
            Array.isArray(persistedDroneConfig.drones) &&
            persistedDroneConfig.drones.length
          ? persistedDroneConfig
          : null;

    if (!source?.drones?.length) {
      snapDronesToHomeAfterRehydrateRef.current = true;
      return;
    }

    snapDronesToHomeAfterRehydrateRef.current = true;

    const nextDrones = source.drones.map((d) => {
      if (!d?.id) return d;
      const [x, y, z] = getDroneHomePositionTupleForReload(d);
      const out = { ...d, pos: [x, y, z] };
      if (Array.isArray(d.path) && d.path.length > 0) {
        out.path = [{ ...d.path[0], x, y, z }, ...d.path.slice(1)];
      }
      return out;
    });

    setDroneConfig({ ...source, drones: nextDrones });
    setPathProgress(0);
    setIsPlaybackRunning(false);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        nextDrones.forEach((d) => {
          if (!d.id) return;
          const [x, y, z] = getDroneHomePositionTupleForReload(d);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
          window.dispatchEvent(
            new CustomEvent('drone-move-request', {
              detail: { id: d.id, x, y, z },
            })
          );
        });
      });
    });
  }, [
    persistRehydrated,
    droneConfig,
    persistedDroneConfig,
    showSpecDroneConfig,
  ]);

  useEffect(() => {
    onSetViewRuntimeState({
      droneConfig,
      pathProgress,
      formationPhases,
      formationSettings,
    });
  }, [
    droneConfig,
    pathProgress,
    formationPhases,
    formationSettings,
    onSetViewRuntimeState,
  ]);

  const collectConfigFromScene = useCallback(() => collectConfigFromSceneUtil(), []);

  useThreeDViewDroneEvents({
    droneConfigRef,
    pathOverridesByIdRef,
    clearPathOverrides,
    setSelectedDrone,
    setDroneConfig,
    setPathProgress,
    collectConfigFromScene,
    showSpecDroneConfig,
  });

  // .skyc 업로드/교체 시 이전 JSON·패널 경로 오버라이드를 버리고 spec 경로로 재설정
  useEffect(() => {
    const hasShowSpec =
      showSpecDroneConfig &&
      Array.isArray(showSpecDroneConfig.drones) &&
      showSpecDroneConfig.drones.length > 0;

    if (!hasShowSpec) {
      return;
    }

    const drones = showSpecDroneConfig.drones;

    ignorePersistedDroneConfigRef.current = true;
    clearPathOverrides();
    setDroneConfig(null);
    setPathProgress(0);
    setIsPlaybackRunning(false);
    playbackActiveDroneIdsRef.current = [];
    playbackFinishedDroneIdsRef.current = new Set();

    setSelectedDrone((prev) => {
      if (prev?.id) {
        const found = drones.find((d) => String(d?.id) === String(prev.id));
        if (found) {
          return {
            ...prev,
            ...buildSelectedDroneFromShowSpec(found),
          };
        }
      }
      return buildSelectedDroneFromShowSpec(drones[0]) ?? prev;
    });

    applyDronePathsToScene(drones);
  }, [showSpecDroneConfig, base64ShowBlob, showData, clearPathOverrides]);

  const extraCameraProps = {
    'advanced-camera-controls': objectToString({
      acceptsKeyboardEvent: 'notEditable',
      embedded: true,
      fly: navigation && navigation.mode === 'fly',
      minAltitude: 0.5,
      reverseMouseDrag: true,
    }),
    'look-controls': objectToString({ enabled: false }),
    'wasd-controls': objectToString({ enabled: false }),
  };

  const extraSceneProps = {};
  if (showStatistics) extraSceneProps.stats = 'true';

  const panelOpen =
    isCreateMode && !!selectedDrone && selectedDrone.source !== 'uav';
  const effectiveLighting = naturalLighting || lighting;

  useEffect(() => {
    if (isCreateMode) return;
    setIsPlaybackRunning(false);
    setAddDroneModalOpen(false);
    setPathGeneratorModalOpen(false);
    setSelectedDrone(null);
    setPendingAutoSelectDrone(null);
    window.dispatchEvent(new CustomEvent('drone-deselected'));
  }, [isCreateMode]);

  const closePanel = () => {
    // ✅ 패널 닫기 = 선택 해제까지 같이 일어나게 (A-Frame도 정리되도록)
    window.dispatchEvent(new CustomEvent('drone-deselected'));
    setSelectedDrone(null);
  };

  const fileInputRef = useRef(null);

  const handleLoadConfigClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);

        // uranus-show-project: LED 쇼 섹션이 있으면 JR LED 에디터 상태를
        // 통째로 복원한다 (섹션이 없으면 LED 상태는 건드리지 않음).
        if (
          parsed &&
          parsed.ledShow &&
          typeof parsed.ledShow === 'object' &&
          !Array.isArray(parsed.ledShow)
        ) {
          store.dispatch(importShow(parsed.ledShow));
        }

        const importedDrones = normalizeDronesFromConfigImport(parsed);
        if (!importedDrones.length) {
          if (!parsed?.ledShow) {
            // eslint-disable-next-line no-console
            console.warn('[ThreeDView] invalid drone config JSON (missing "drones")');
          }
          return;
        }
        const normalizedDrones = importedDrones.map((d, index) => {
          const normalized = normalizeDroneForConfigIO(d, index);
          return {
            ...normalized,
            initialPos: normalized.initialPos.slice(),
          };
        });

        const formationImport = readFormationImportFromParsed(parsed);
        if (formationImport) {
          setFormationPhases(
            remapFormationPhasesToDroneIds(formationImport.phases, normalizedDrones)
          );
          setLastReversedPhaseIds([]);
          setFormationSettings(formationImport.settings);
        }

        clearPathOverrides();
        setDroneConfig({
          ...stripFormationFromDroneConfigRoot(parsed),
          drones: normalizedDrones,
        });
        // 새 파일을 불러오면 이전 재생 진행률(pathProgress)이 남아있어, PLAY 시
        // 그 stale progress를 새 경로의 duration에 적용해 중간 지점으로 순간 이동한 뒤
        // (겉으로는 "뒤로 갔다가") 나머지 구간만 정상 재생되는 문제가 있었다.
        // 새 파일 로드 시 재생 상태를 처음으로 리셋한다.
        setPathProgress(0);
        setIsPlaybackRunning(false);
        playbackActiveDroneIdsRef.current = [];
        playbackFinishedDroneIdsRef.current = new Set();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[ThreeDView] failed to parse drone config JSON', err);
      }
    };
    reader.readAsText(file);
  };

  const handleSaveConfigClick = () => {
    const baseConfig = isDroneConfigState(droneConfig)
      ? droneConfig
      : collectConfigFromScene();

    const droneRows =
      baseConfig && Array.isArray(baseConfig.drones)
        ? baseConfig.drones.map((d, index) => {
            const normalized = normalizeDroneForConfigIO(
              {
                ...d,
                // Export format uses pos as canonical initial position.
                pos:
                  Array.isArray(d?.initialPos) && d.initialPos.length >= 3
                    ? d.initialPos
                    : d?.pos,
              },
              index
            );
            const { initialPos, ...exported } = normalized;
            return {
              ...exported,
              initial_position: initialPos,
            };
          })
        : [];

    const dronesForFormationKeys =
      baseConfig && Array.isArray(baseConfig.drones) ? baseConfig.drones : [];
    const phasesAligned = remapFormationPhasesToDroneIds(
      formationPhases,
      dronesForFormationKeys.map((d, index) => normalizeDroneForConfigIO(d, index))
    );

    // ── uranus-show-project v1 ─────────────────────────────────────────
    // 프론트 상태 전체를 재현 가능한 단일 프로젝트 파일. 섹션은 내용이
    // 있을 때만 포함한다 (없던 섹션은 다시 열어도 없음):
    //   format/version : 파일 식별자 ("uranus-show-project", 1)
    //   drones         : 드론 목록 (id/이름/초기 위치/수동 경로)
    //   formation      : phases(좌표·yaw·holdMs·직선고정·클러스터) + 설정
    //   ledShow        : JR LED 애니메이션 (ledsPerDrone, droneCount, fps,
    //                    boards[id/name/rows/cols/startSec/durationSec/
    //                    drones(드론별 k*k RGB 픽셀)])
    // 구버전 three-d-drone-config.json(drones+formation만)도 계속 읽힌다.
    const configToSave = {
      format: 'uranus-show-project',
      version: 1,
      drones: droneRows,
      formation: {
        phases: phasesAligned.map((p) => {
          const phase = {
            id: p.id,
            name: String(p.name || '').trim() || 'phase',
            holdMs: Math.max(0, Math.round(Number(p.holdMs) || 0)),
            points:
              p.points && typeof p.points === 'object' && !Array.isArray(p.points)
                ? { ...p.points }
                : {},
          };
          if (Array.isArray(p.fixedDroneIds) && p.fixedDroneIds.length) {
            phase.fixedDroneIds = [...p.fixedDroneIds];
          }
          if (Array.isArray(p.clusters) && p.clusters.length) {
            phase.clusters = p.clusters.map((c) => [...c]);
          }
          const lattice = normalizeFormationLattice(p.lattice);
          if (lattice) {
            phase.lattice = lattice;
          }
          return phase;
        }),
        settings: sanitizeFormationSettings(formationSettings),
      },
    };

    const ledState = store.getState().ledEditor;
    if (ledState && Array.isArray(ledState.boards) && ledState.boards.length) {
      configToSave.ledShow = {
        ledsPerDrone: ledState.ledsPerDrone,
        droneCount: ledState.droneCount,
        fps: ledState.fps,
        boards: ledState.boards.map((b) => ({
          id: b.id,
          name: b.name,
          rows: b.rows,
          cols: b.cols,
          startSec: b.startSec,
          durationSec: b.durationSec,
          drones: b.drones,
        })),
      };
    }

    const blob = new Blob([JSON.stringify(configToSave, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'uranus-show-project.json';
    document.body.appendChild(a);
    a.click();
    if (a.parentNode === document.body) {
      try {
        document.body.removeChild(a);
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
    }
    URL.revokeObjectURL(url);
  };

  const handleAddDrones = (newDrones) => {
    const batch = Array.isArray(newDrones) ? newDrones.filter(Boolean) : [];
    if (!batch.length) return;

    setDroneConfig((prev) => {
      const base = isDroneConfigState(prev) ? prev : collectConfigFromScene();

      const existingDrones =
        base && Array.isArray(base.drones) ? base.drones : [];

      return { ...base, drones: [...existingDrones, ...batch] };
    });
    setPendingAutoSelectDrone(batch[batch.length - 1]);
  };

  useEffect(() => {
    if (!pendingAutoSelectDrone?.id) return undefined;
    if (typeof document === 'undefined') {
      setPendingAutoSelectDrone(null);
      return undefined;
    }

    let cancelled = false;
    let tries = 0;
    let rafId = null;

    const trySelect = () => {
      if (cancelled) return;
      tries += 1;

      const sceneEl = document.querySelector('a-scene');
      const safeId =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(pendingAutoSelectDrone.id)
          : pendingAutoSelectDrone.id;
      const target = sceneEl?.querySelector?.(`[data-drone-id="${safeId}"]`);

      if (target) {
        const position = parsePositionLike(target.getAttribute('position'), DEFAULT_DRONE_GROUND_POSITION);
        const initialPos = parsePositionLike(target.getAttribute('data-initial-pos'), position);
        window.dispatchEvent(
          new CustomEvent('drone-selected', {
            detail: {
              id: pendingAutoSelectDrone.id,
              name: pendingAutoSelectDrone.name,
              battery: pendingAutoSelectDrone.battery,
              status: pendingAutoSelectDrone.status,
              path: Array.isArray(pendingAutoSelectDrone.path) ? pendingAutoSelectDrone.path : [],
              currentPosition: { x: position[0], y: position[1], z: position[2] },
              initialPosition: { x: initialPos[0], y: initialPos[1], z: initialPos[2] },
            },
          })
        );
        setPendingAutoSelectDrone(null);
        return;
      }

      if (tries < 30) {
        rafId = requestAnimationFrame(trySelect);
      } else {
        setPendingAutoSelectDrone(null);
      }
    };

    rafId = requestAnimationFrame(trySelect);
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [pendingAutoSelectDrone]);

  const [gizmoDragState, setGizmoDragState] = useState({ dragging: false, axis: null });

  // ── showSpec 모드 뒤로가기 ────────────────────────────────────────────
  // .skyc 쇼를 로드하면 3D 뷰가 쇼 스펙을 표시하는 모드로 전환된다.
  // 이 플래그를 켜면 로드된 스펙을 무시하고 수동 편집 상태(droneConfig +
  // formation)로 돌아간다 — 스펙 자체는 지워지지 않아 언제든 복귀 가능.
  const [showSpecIgnored, setShowSpecIgnored] = useState(false);

  // 새 쇼 파일이 로드되면 다시 표시 상태로 리셋
  useEffect(() => {
    setShowSpecIgnored(false);
  }, [showSpecDroneConfig]);

  // ── 드론 다중 선택 + 그룹 이동 ────────────────────────────────────────
  // 좌측 "드론 선택" 탭과 3D 뷰 클릭이 공유하는 단일 선택 상태. 어느 쪽에서
  // 골라도 같은 목록이 되고, 3D 뷰에서는 선택된 드론이 모두 빨갛게 표시된다.
  // "primary"는 마지막으로 선택에 들어온 드론 — 정보 패널과 이동 기즈모가
  // 이 드론에 붙는다. 2대 이상 선택된 상태에서 기즈모를 드래그하면 나머지
  // 선택 드론도 같은 벡터만큼 함께 이동한다.
  const [multiSelectedDroneIds, setMultiSelectedDroneIds] = useState([]);
  const multiSelectedRef = useRef(new Set());
  // 이벤트 핸들러가 같은 tick 안에서 최신 선택을 읽어야 하므로 순서 있는
  // 목록과 primary도 ref로 동기 유지한다 (state는 한 렌더 늦게 온다).
  const multiSelectedListRef = useRef([]);
  const primarySelectedIdRef = useRef(null);

  useEffect(() => {
    multiSelectedListRef.current = multiSelectedDroneIds.map(String);
    multiSelectedRef.current = new Set(multiSelectedListRef.current);
    if (
      primarySelectedIdRef.current &&
      !multiSelectedRef.current.has(primarySelectedIdRef.current)
    ) {
      primarySelectedIdRef.current = null;
    }
  }, [multiSelectedDroneIds]);

  // primary 드론을 기존 선택 이벤트로 알린다 — 정보 패널(useThreeDViewDroneEvents)
  // 과 기즈모(drone-axis-gizmo)가 이 이벤트만 보고 움직이므로, 패널에서 고른
  // 선택도 3D 뷰 클릭과 완전히 같은 결과가 된다. `fromSelectionSync`는 우리가
  // 쏜 에코라는 표시로, 아래 리스너가 이를 다시 선택 변경으로 해석하지 않는다.
  const emitPrimarySelection = useCallback((droneId) => {
    const id = droneId ? String(droneId) : '';
    const target = id ? findDroneEntityById(id) : null;

    if (!target) {
      window.dispatchEvent(
        new CustomEvent('drone-deselected', {
          detail: { fromSelectionSync: true },
        })
      );
      return;
    }

    const position = parsePositionLike(
      target.getAttribute('position'),
      DEFAULT_DRONE_GROUND_POSITION
    );
    const initialPos = parsePositionLike(
      target.getAttribute('data-initial-pos'),
      position
    );

    window.dispatchEvent(
      new CustomEvent('drone-selected', {
        detail: {
          fromSelectionSync: true,
          id,
          name: target.getAttribute('data-drone-name'),
          source: target.getAttribute('data-drone-source'),
          battery: target.getAttribute('data-battery'),
          status: target.getAttribute('data-status'),
          mode: target.getAttribute('data-mode'),
          heading: target.getAttribute('data-heading'),
          currentPosition: { x: position[0], y: position[1], z: position[2] },
          initialPosition: {
            x: initialPos[0],
            y: initialPos[1],
            z: initialPos[2],
          },
        },
      })
    );
  }, []);

  const applySelection = useCallback(
    (ids, primaryId, { emitPrimary = false } = {}) => {
      const list = (Array.isArray(ids) ? ids : []).map(String);
      const primary = primaryId ? String(primaryId) : null;

      multiSelectedListRef.current = list;
      multiSelectedRef.current = new Set(list);
      primarySelectedIdRef.current = primary;
      setMultiSelectedDroneIds(list);

      if (emitPrimary) {
        emitPrimarySelection(primary);
      }
    },
    [emitPrimarySelection]
  );

  // "드론 선택" 패널에서 목록이 바뀐 경우. primary(정보 패널·기즈모가 붙는
  // 드론)는 여전히 선택돼 있으면 그대로 둔다 — 목록을 긁어서 여러 대를 담는
  // 동안 정보 패널이 드론마다 갈아치워지지 않게 하는 앵커 역할이다.
  const handleMultiSelectionChange = useCallback(
    (ids) => {
      const list = (Array.isArray(ids) ? ids : []).map(String);
      const nextSet = new Set(list);
      const previousPrimary = primarySelectedIdRef.current;
      const previousSelection = multiSelectedRef.current;

      let primary =
        previousPrimary && nextSet.has(previousPrimary) ? previousPrimary : null;
      if (!primary) {
        const added = list.filter((id) => !previousSelection.has(id));
        primary = (added.length ? added.at(-1) : list.at(-1)) ?? null;
      }

      applySelection(list, primary, {
        emitPrimary: primary !== previousPrimary,
      });
    },
    [applySelection]
  );

  // 3D 뷰 클릭(click-pick / 구체 마커) → 공유 선택 상태.
  // 그냥 클릭 = 그 드론만 선택(이미 단독 선택이면 해제),
  // Ctrl/Cmd/Shift + 클릭 = 선택 토글.
  useEffect(() => {
    if (!isCreateMode) {
      return undefined;
    }

    const onSelected = (event) => {
      const detail = event.detail || {};
      if (detail.fromSelectionSync) {
        return;
      }

      const id = detail.id != null ? String(detail.id) : '';
      if (!id) {
        return;
      }

      const list = multiSelectedListRef.current;
      const selected = multiSelectedRef.current;
      const primaryId = primarySelectedIdRef.current;

      let next;
      let primary;

      if (detail.additive) {
        if (selected.has(id)) {
          next = list.filter((item) => item !== id);
          primary =
            primaryId && primaryId !== id && next.includes(primaryId)
              ? primaryId
              : next[next.length - 1] ?? null;
        } else {
          next = [...list, id];
          primary = id;
        }
      } else if (selected.size === 1 && selected.has(id)) {
        next = [];
        primary = null;
      } else {
        next = [id];
        primary = id;
      }

      applySelection(next, primary);

      // 이벤트는 이미 "id가 선택됐다"고 알렸다. 토글로 빠졌거나 해제된
      // 클릭이면 정보 패널·기즈모를 실제 primary로 바로잡는다 (원래
      // 이벤트의 모든 리스너가 끝난 뒤에 보내야 하므로 microtask).
      if (primary !== id) {
        queueMicrotask(() => {
          emitPrimarySelection(primary);
        });
      }
    };

    const onDeselected = (event) => {
      if (event.detail?.fromSelectionSync) {
        return;
      }

      applySelection([], null);
    };

    window.addEventListener('drone-selected', onSelected);
    window.addEventListener('drone-deselected', onDeselected);
    return () => {
      window.removeEventListener('drone-selected', onSelected);
      window.removeEventListener('drone-deselected', onDeselected);
    };
  }, [applySelection, emitPrimarySelection, isCreateMode]);

  useEffect(() => {
    const gizmoDragging = { current: false };
    // 그룹 이동 상태: 앵커(드래그 중인 드론)의 직전 위치와, 프로그램적
    // 이동이 발생시키는 drone-moved 에코를 무시하기 위한 플래그.
    const groupState = { anchorId: null, last: null, applying: false };

    const onDragState = (e) => {
      const dragging = !!e?.detail?.dragging;
      gizmoDragging.current = dragging;
      if (!dragging) {
        groupState.anchorId = null;
        groupState.last = null;
      }
    };

    const onMoved = (e) => {
      if (groupState.applying) return;
      if (!gizmoDragging.current) return;
      const detail = e?.detail || {};
      const id = detail.id != null ? String(detail.id) : '';
      const selected = multiSelectedRef.current;
      if (!id || selected.size < 2 || !selected.has(id)) return;
      const x = Number(detail.x);
      const y = Number(detail.y);
      const z = Number(detail.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return;
      }
      if (groupState.anchorId !== id || !groupState.last) {
        groupState.anchorId = id;
        groupState.last = { x, y, z };
        return;
      }
      const dx = x - groupState.last.x;
      const dy = y - groupState.last.y;
      const dz = z - groupState.last.z;
      groupState.last = { x, y, z };
      if (dx === 0 && dy === 0 && dz === 0) return;
      groupState.applying = true;
      try {
        for (const otherId of selected) {
          if (otherId === id) continue;
          const safe =
            typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
              ? CSS.escape(otherId)
              : otherId;
          const el = document.querySelector(`a-scene [data-drone-id="${safe}"]`);
          const pos = el?.getAttribute?.('position');
          if (!pos || typeof pos !== 'object') continue;
          window.dispatchEvent(
            new CustomEvent('drone-move-request', {
              detail: {
                id: otherId,
                x: Number(pos.x) + dx,
                y: Number(pos.y) + dy,
                z: Math.max(0, Number(pos.z) + dz),
              },
            })
          );
        }
      } finally {
        groupState.applying = false;
      }
    };

    window.addEventListener('drone-gizmo-drag-state', onDragState);
    window.addEventListener('drone-moved', onMoved);
    return () => {
      window.removeEventListener('drone-gizmo-drag-state', onDragState);
      window.removeEventListener('drone-moved', onMoved);
    };
  }, []);

  // "드론 선택" 탭에서 고른 드론들을 확인 팝업 후 한 번에 삭제.
  // 패널의 "선택 삭제" 버튼과 Del 키 모두 이 핸들러를 사용한다.
  const handleDeleteSelectedDrones = useCallback(() => {
    const ids = [...multiSelectedRef.current];
    if (!ids.length) return;
    const confirmed = window.confirm(
      `선택한 드론 ${ids.length}대를 삭제할까요?\n(${ids.join(', ')})`
    );
    if (!confirmed) return;
    window.dispatchEvent(
      new CustomEvent('drone-delete-request', { detail: { ids } })
    );
    applySelection([], null);
  }, [applySelection]);

  useEffect(() => {
    if (!isCreateMode) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Delete') return;
      const target = e.target;
      const tag = target?.tagName ? String(target.tagName).toLowerCase() : '';
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (!multiSelectedRef.current.size) return;
      e.preventDefault();
      handleDeleteSelectedDrones();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCreateMode, handleDeleteSelectedDrones]);
  const effectiveConfig = useMemo(() => {
    const hasShowSpec =
      !showSpecIgnored &&
      showSpecDroneConfig &&
      Array.isArray(showSpecDroneConfig.drones) &&
      showSpecDroneConfig.drones.length > 0;
    const hasDroneConfig = isDroneConfigState(droneConfig);

    if (hasShowSpec) {
      const deletedIds = new Set(
        (Array.isArray(droneConfig?.deletedIds) ? droneConfig.deletedIds : []).map(String)
      );
      const visibleDrones = showSpecDroneConfig.drones.filter(
        (d) => d?.id == null || !deletedIds.has(String(d.id))
      );
      const mergedDrones =
        hasDroneConfig && droneConfig.drones.length
          ? mergePathOverridesIntoDrones(visibleDrones, droneConfig.drones)
          : visibleDrones;
      return { ...showSpecDroneConfig, drones: mergedDrones };
    }

    if (hasDroneConfig) {
      return droneConfig;
    }

    return collectConfigFromScene();
  }, [droneConfig, showSpecDroneConfig, showSpecIgnored, collectConfigFromScene]);
  droneConfigRef.current = effectiveConfig;

  // 삭제되거나 사라진 드론은 다중 선택에서 자동 제거
  useEffect(() => {
    const ids = new Set(
      (Array.isArray(effectiveConfig?.drones) ? effectiveConfig.drones : [])
        .map((d) => (d?.id != null ? String(d.id) : ''))
        .filter(Boolean)
    );
    setMultiSelectedDroneIds((prev) => {
      const next = prev.filter((id) => ids.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [effectiveConfig]);

  const getConfigForPathDelivery = useCallback(() => {
    const base = isDroneConfigState(effectiveConfig)
      ? effectiveConfig
      : collectConfigFromScene();

    const overrideList = Array.from(pathOverridesByIdRef.current.entries()).map(
      ([id, path]) => ({ id, path })
    );
    if (!overrideList.length) {
      return base;
    }

    return {
      ...base,
      drones: mergePathOverridesIntoDrones(base.drones, overrideList),
    };
  }, [collectConfigFromScene, effectiveConfig]);

  const flushPendingPathEdits = useCallback(
    () =>
      new Promise((resolve) => {
        window.dispatchEvent(new CustomEvent(DRONE_PATH_FLUSH_REQUEST));
        queueMicrotask(resolve);
      }),
    []
  );

  const handleSendPathsClick = useCallback(async () => {
    await flushPendingPathEdits();

    const baseConfig = getConfigForPathDelivery();
    const droneList = Array.isArray(baseConfig?.drones) ? baseConfig.drones : [];

    if (!droneList.length) {
      setPathDeliveryStatus('전달할 드론 경로가 없습니다.');
      return;
    }

    setIsSendingPaths(true);
    setPathDeliveryStatus('');

    const canExportLocally =
      effectiveConfig?.source === 'showSpec' &&
      Boolean(base64ShowBlob) &&
      Array.isArray(swarmSpecification) &&
      swarmSpecification.length > 0;

    try {
      if (canExportLocally) {
        await exportPatchedSkycFromShow({
          base64Blob: base64ShowBlob,
          swarmDrones: swarmSpecification,
          editedDrones: droneList,
          filename: 'updated-show.skyc',
        });
        setPathDeliveryStatus(
          `로컬 SKYC 갱신 완료: ${droneList.length}대\n경로·타이밍만 반영했습니다. (lights/formation 등은 원본 유지)`
        );
        return;
      }

      const payload = buildPathDeliveryPayloadFromConfig(baseConfig);
      if (!payload.drones.length) {
        setPathDeliveryStatus('전달할 드론 경로가 없습니다.');
        return;
      }

      const usedUrl = DEFAULT_PATH_DELIVERY_URL;
      const response = await fetch(usedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const msg = await getPathDeliveryErrorMessage(response);
        throw new Error(msg || `요청 실패: ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'path-planner.skyc';
      document.body.appendChild(a);
      a.click();
      if (a.parentNode === document.body) {
        try {
          document.body.removeChild(a);
        } catch (error) {
          if (error?.name !== 'NotFoundError') throw error;
        }
      }
      URL.revokeObjectURL(objectUrl);

      setPathDeliveryStatus(
        `경로 전달 완료: ${payload.drones.length}대\npath-planner.skyc 다운로드가 시작되었습니다.\nURL: ${usedUrl}\nProxy target: ${PATH_DELIVERY_PROXY_TARGET}`
      );
    } catch (error) {
      const usedUrl = DEFAULT_PATH_DELIVERY_URL;
      setPathDeliveryStatus(
        canExportLocally
          ? `SKYC 갱신 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`
          : `경로 전달 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}\nURL: ${usedUrl}\nProxy target: ${PATH_DELIVERY_PROXY_TARGET}`
      );
    } finally {
      setIsSendingPaths(false);
    }
  }, [
    base64ShowBlob,
    effectiveConfig?.source,
    flushPendingPathEdits,
    getConfigForPathDelivery,
    swarmSpecification,
  ]);

  const selectedPathDroneId = useMemo(() => {
    if (!selectedDrone?.id || !Array.isArray(effectiveConfig?.drones)) return undefined;

    const selectedId = String(selectedDrone.id);
    const directMatch = effectiveConfig.drones.find((d) => String(d?.id) === selectedId);
    if (directMatch?.id) return directMatch.id;

    if (selectedDrone.source === 'uav') {
      const missionIndex = uavToMissionIndex?.[selectedId];
      const mappedDrone = Number.isInteger(missionIndex)
        ? effectiveConfig.drones[missionIndex]
        : null;
      if (mappedDrone?.id) return mappedDrone.id;
    }

    return undefined;
  }, [effectiveConfig, selectedDrone, uavToMissionIndex]);

  useEffect(() => {
    if (ignorePersistedDroneConfigRef.current) {
      return;
    }
    if (!persistRehydrated) {
      return;
    }
    if (formationHydratedFromPersistRef.current) {
      return;
    }
    if (!Array.isArray(persistedFormationPhases) || persistedFormationPhases.length === 0) {
      formationHydratedFromPersistRef.current = true;
      return;
    }

    const drones =
      effectiveConfig && Array.isArray(effectiveConfig.drones) ? effectiveConfig.drones : [];
    if (!drones.length) {
      return;
    }

    const normPhases = persistedFormationPhases.map((p, i) =>
      normalizeFormationPhaseForImport(p, i)
    );
    const normalizedDrones = drones.map((d, i) => normalizeDroneForConfigIO(d, i));
    setFormationPhases(remapFormationPhasesToDroneIds(normPhases, normalizedDrones));
    setLastReversedPhaseIds([]);
    setFormationSettings(
      sanitizeFormationSettings(
        persistedFormationSettings &&
          typeof persistedFormationSettings === 'object' &&
          !Array.isArray(persistedFormationSettings)
          ? persistedFormationSettings
          : DEFAULT_FORMATION_SETTINGS
      )
    );
    formationHydratedFromPersistRef.current = true;
  }, [
    persistRehydrated,
    persistedFormationPhases,
    persistedFormationSettings,
    effectiveConfig,
  ]);

  const playbackSourceLabel =
    effectiveConfig?.source === 'showSpec'
      ? '로드된 .skyc spec'
      : '3D JSON · 수동 경로';

  const maxPathDurationMs = useMemo(() => {
    if (!effectiveConfig || !Array.isArray(effectiveConfig.drones)) return 0;
    return effectiveConfig.drones.reduce((max, d) => {
      const seekPath = buildSeekPathWithInitial(d);
      const total = getPathTotalDurationMs(seekPath, {
        startFromInitial: true,
        durationPerSegment: 1000,
      });
      return Math.max(max, total);
    }, 0);
  }, [effectiveConfig]);

  const currentPositionMs =
    maxPathDurationMs * (Math.min(100, Math.max(0, Number(pathProgress) || 0)) / 100);

  // 구체 렌더 활성 조건: 편집 모드에서 토글 ON이면 즉시 구체로 표시
  // (재생 여부와 무관 — 체크하면 바로 바뀌어야 알아보기 쉽다). 구체
  // 표시 중에는 개별 OBJ 엔티티가 없으므로 클릭/기즈모 편집은 쉬고,
  // 끄면 즉시 복귀한다.
  const sphereModeActive = isCreateMode && sphereSimRender;
  const sphereModeActiveRef = useRef(false);
  sphereModeActiveRef.current = sphereModeActive;

  // 선택된 드론을 3D 뷰에서 빨갛게 표시한다 (OBJ 마커). 구체 모드는
  // DroneSphereMarkers가 selectedIds로 인스턴스 색을 직접 칠한다.
  // 방금 추가된 드론은 fbx-model 컴포넌트 초기화가 한 프레임 늦을 수 있어
  // 다음 프레임에 한 번 더 적용한다.
  useEffect(() => {
    if (!isCreateMode || sphereModeActive || typeof document === 'undefined') {
      return undefined;
    }

    const selected = new Set(multiSelectedDroneIds.map(String));

    const applyHighlight = () => {
      for (const el of document.querySelectorAll('a-scene [data-drone-id]')) {
        const component = findFbxModelComponent(el);
        if (!component) {
          continue;
        }

        if (selected.has(String(el.getAttribute('data-drone-id')))) {
          component._select?.();
        } else {
          component._deselect?.();
        }
      }
    };

    applyHighlight();
    const rafId = requestAnimationFrame(applyHighlight);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [effectiveConfig, isCreateMode, multiSelectedDroneIds, sphereModeActive]);
  const pathProgressLatestRef = useRef(0);
  pathProgressLatestRef.current = pathProgress;

  // Same pose driver as the playbar scrubber: sample the path at elapsed time and
  // snap via drone-move-request. PLAY used to drive a separate segment animation
  // (drone-path-request); that fought React re-renders from pathProgress updates
  // and looked like a brief reverse jump before climbing. Scrub never had that
  // bug, so playback now uses this path exclusively.
  const applyProgressToAll = useCallback(
    (progressPercent) => {
      const base = effectiveConfig;

      if (!base || !Array.isArray(base.drones) || !base.drones.length) return;

      const progress = Math.min(100, Math.max(0, Number(progressPercent) || 0)) / 100;
      const elapsedMs = maxPathDurationMs * progress;

      const updates = [];
      base.drones.forEach((d) => {
        if (!Array.isArray(d.path) || !d.path.length || !d.id) return;

        const seekPath = buildSeekPathWithInitial(d);
        if (!seekPath.length) return;
        const sliced = slicePathByElapsedMs(seekPath, elapsedMs);
        if (!sliced.length) return;

        const point = sliced[0];
        const x = Number(point.x);
        const y = Number(point.y);
        const z = Number(point.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;

        const detail = { id: d.id, x, y, z };
        const yaw = Number(point.yaw);
        if (Number.isFinite(yaw)) {
          detail.yaw = yaw;
        }
        updates.push(detail);
      });
      if (!updates.length) return;

      // 구체 모드에서도 드론별 이동 이벤트는 그대로 흘린다 — 구체는
      // "렌더링만" 다르고, 프록시 엔티티가 OBJ 마커와 동일하게 이 이벤트를
      // 소비한다 (구체 메시는 프록시 위치를 매 프레임 미러링). tSec 이벤트는
      // LED 동기화 없이 재생할 때 구체 색을 진행 시각에 맞추는 용도.
      updates.forEach((detail) => {
        window.dispatchEvent(new CustomEvent('drone-move-request', { detail }));
      });
      if (sphereModeActiveRef.current) {
        window.dispatchEvent(
          new CustomEvent('drone-sphere-frame', {
            detail: { tSec: elapsedMs / 1000 },
          })
        );
      }
    },
    [effectiveConfig, maxPathDurationMs]
  );

  // 구체/OBJ 전환 시 새로 마운트된 마커(프록시 포함)는 초기 위치로
  // 나타나므로, 잠시 뒤 현재 진행 위치를 재적용해 점프를 없앤다 (양방향
  // 공통). 프록시 엔티티의 A-Frame 초기화가 끝나도록 두 프레임 기다린다.
  useEffect(() => {
    let rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => {
        applyProgressToAll(pathProgressLatestRef.current);
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [sphereModeActive, applyProgressToAll]);

  const handlePathProgressChange = (nextValue) => {
    if (syncActive) {
      // Sync on: the LED-show playhead is the master clock. Pause and seek it;
      // the sync effect below mirrors the new position onto the 3D drones.
      const clamped = Math.min(100, Math.max(0, Number(nextValue) || 0));
      const absSec = (maxPathDurationMs * (clamped / 100)) / 1000;
      store.dispatch(setPlaying(false));
      store.dispatch(setPlayhead(absSec));
      return;
    }
    setIsPlaybackRunning(false);
    setPathProgress(nextValue);
    applyProgressToAll(nextValue);
  };

  useEffect(() => {
    if (syncActive) return undefined; // sync mode drives drones from the LED clock
    if (!isPlaybackRunning || maxPathDurationMs <= 0) return undefined;

    let rafId = null;

    const tick = (now) => {
      const elapsedMs =
        playbackClockRef.current.startElapsedMs +
        (now - playbackClockRef.current.startedAt);
      const nextProgress = Math.min(100, (elapsedMs / maxPathDurationMs) * 100);

      setPathProgress(nextProgress);
      applyProgressToAll(nextProgress);

      if (elapsedMs >= maxPathDurationMs) {
        setPathProgress(100);
        applyProgressToAll(100);
        setIsPlaybackRunning(false);
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isPlaybackRunning, maxPathDurationMs, syncActive, applyProgressToAll]);

  // Bidirectional playback sync. When enabled, the LED-show playhead is the
  // single source of truth: whether playback is started/seeked from the LED
  // simulator or from this 3D view (its buttons/slider write to the same
  // playhead), this effect mirrors the playhead onto the 3D drones so both
  // timelines stay aligned. Seeking the LED bar to e.g. 4s and playing moves
  // the 3D drones — and the 3D progress bar — to the matching instant.
  useEffect(() => {
    if (!syncActive) return;
    if (!(maxPathDurationMs > 0)) return;
    const absMs = Math.max(0, Number(ledPlayheadSec) || 0) * 1000;
    const progress = Math.min(100, (absMs / maxPathDurationMs) * 100);
    setPathProgress(progress);
    applyProgressToAll(progress);
  }, [syncActive, ledPlayheadSec, maxPathDurationMs, applyProgressToAll]);

  // Formation hold-windows on the shared timeline. When a plan has been run,
  // the backend's actual per-phase timings (takeoff + real solver transit
  // durations included) are used verbatim; otherwise a rough client-side
  // estimate (one step's travel time per transition) fills in. Each region
  // marks when a formation is held; the first *formation* region's start is
  // the recommended LED-activation delay after dance start.
  const formationTimeline = useMemo(() => {
    if (Array.isArray(plannedTimeline) && plannedTimeline.length) {
      return plannedTimeline;
    }
    if (!Array.isArray(formationPhases) || !formationPhases.length) return [];
    const s = sanitizeFormationSettings(formationSettings);
    const cruise = Math.max(1e-6, Number(s.cruise_speed) || 0);
    // 전환 시간 추정: 이전 phase에서 가장 멀리 이동하는 드론의 직선 거리
    // 기준 (예전엔 1스텝 시간으로 잡아 실제 타임라인과 크게 어긋났다 —
    // phase-1이 이륙 구간에 뭉개져 "사라진 것처럼" 보이던 원인).
    const transitSecTo = (phase, prevPhase) => {
      const points = phase.points || {};
      const prevPoints = prevPhase?.points || {};
      let maxDist = 0;
      for (const [droneId, p] of Object.entries(points)) {
        const q = prevPoints[droneId];
        if (!p || !q) continue;
        const dx = Number(p.x) - Number(q.x);
        const dy = Number(p.y) - Number(q.y);
        const dz = Number(p.z) - Number(q.z);
        if ([dx, dy, dz].every(Number.isFinite)) {
          maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
        }
      }
      // 첫 phase는 이전 정보가 없으니 대략 이륙+스테이징 추정치로 20 m.
      const dist = prevPhase ? maxDist : 20.0;
      return Math.max(Number(s.step_size) || 1, dist) / cruise;
    };
    let cursorSec = Math.max(0, Number(s.takeoff_time) || 0);
    return formationPhases.map((phase, i) => {
      cursorSec += transitSecTo(phase, formationPhases[i - 1]);
      const startSec = cursorSec;
      const holdSec = Math.max(0, Number(phase.holdMs) || 0) / 1000;
      const endSec = startSec + holdSec;
      cursorSec = endSec; // hold here, then the next move begins
      return {
        name: String(phase.name || '').trim() || `phase-${i + 1}`,
        startSec,
        endSec,
        color: FORMATION_COLORS[i % FORMATION_COLORS.length],
      };
    });
  }, [plannedTimeline, formationPhases, formationSettings]);

  const ledStartDelaySec = useMemo(() => {
    if (!formationTimeline.length) return null;
    // Transit regions (staging-grid / return-to-start from the planner) are
    // not user formations — the LED show should start at the first real one.
    const firstFormation = formationTimeline.find((r) => r.kind !== 'transit');
    return (firstFormation || formationTimeline[0]).startSec;
  }, [formationTimeline]);

  // Mirror the formation windows + recommended delay into the LED editor store
  // (read by the LED timeline, simulator and JR-control) while sync is on.
  useEffect(() => {
    if (syncActive) {
      store.dispatch(
        setFormationSync({ timeline: formationTimeline, delaySec: ledStartDelaySec })
      );
    } else {
      store.dispatch(setFormationSync({ timeline: [], delaySec: null }));
    }
  }, [syncActive, formationTimeline, ledStartDelaySec]);

  // Clear the mirrored formation data when the 3D view unmounts so stale
  // regions don't linger on the LED timeline.
  useEffect(
    () => () => {
      store.dispatch(setFormationSync({ timeline: [], delaySec: null }));
    },
    []
  );

  useEffect(() => {
    const onGizmoDragState = (e) => {
      const detail = e.detail || {};
      setGizmoDragState({
        dragging: !!detail.dragging,
        axis: detail.axis || null,
      });
    };

    window.addEventListener('drone-gizmo-drag-state', onGizmoDragState);
    return () => window.removeEventListener('drone-gizmo-drag-state', onGizmoDragState);
  }, []);

  const handlePlayAll = () => {
    const base = effectiveConfig;

    if (!base || !Array.isArray(base.drones) || !base.drones.length) return;

    if (syncActive) {
      // Sync on: just start the shared LED-show clock; the sync effect advances
      // the 3D drones to follow it. (Resume from the current playhead, not 0.)
      store.dispatch(setPlaying(true));
      return;
    }

    const progress = Math.min(100, Math.max(0, Number(pathProgress) || 0)) / 100;
    const elapsedMs = maxPathDurationMs * progress;
    if (maxPathDurationMs <= 0 || elapsedMs >= maxPathDurationMs) return;

    // Cancel any leftover segment animations (e.g. single-drone path play).
    window.dispatchEvent(new CustomEvent('drone-path-stop'));

    playbackActiveDroneIdsRef.current = [];
    playbackFinishedDroneIdsRef.current = new Set();
    playbackClockRef.current = {
      startElapsedMs: elapsedMs,
      startedAt: performance.now(),
    };
    applyProgressToAll(pathProgress);
    setIsPlaybackRunning(true);
  };

  const handlePausePlayback = () => {
    setIsPlaybackRunning(false);
    // Freeze any leftover segment animations (single-drone path play, etc.).
    window.dispatchEvent(new CustomEvent('drone-path-stop'));
  };

  const handleResetAll = () => {
    if (syncActive) {
      // Reset the shared clock too so the LED simulator rewinds in lockstep.
      store.dispatch(setPlaying(false));
      store.dispatch(setPlayhead(0));
    }
    setIsPlaybackRunning(false);
    playbackActiveDroneIdsRef.current = [];
    playbackFinishedDroneIdsRef.current = new Set();
    setPathProgress(0);
    const base = effectiveConfig;

    if (!base || !Array.isArray(base.drones) || !base.drones.length) return;

    base.drones.forEach((d) => {
      // path[0]이 곧 시작 위치. 없으면 기존 initialPos/pos로 fallback.
      const [x, y, z] = getDroneInitialPositionTuple(d);
      if (!d.id) return;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;

      window.dispatchEvent(
        new CustomEvent('drone-path-request', {
          detail: {
            id: d.id,
            points: [{ x, y, z, durationMs: 1000 }],
            durationPerSegment: 1000,
            startFromInitial: false,
          },
        })
      );
    });
  };

  const handleLedSyncToggle = (next) => {
    // Stop the 3D view's own playback when handing control to the shared clock,
    // so the two playback systems don't fight over the drones.
    if (next) {
      setIsPlaybackRunning(false);
    }
    store.dispatch(setThreeDSync(!!next));
  };

  const handleResetPanelSettings = () => {
    // Prevent immediate re-hydration of old persisted runtime config.
    ignorePersistedDroneConfigRef.current = true;
    formationHydratedFromPersistRef.current = true;
    setPathProgress(0);
    setSelectedDrone(null);
    setPendingAutoSelectDrone(null);
    window.dispatchEvent(new CustomEvent('drone-deselected'));
    clearPathOverrides();
    setDroneConfig(null);
    setFormationPhases([]);
    setLastReversedPhaseIds([]);
    setFormationSettings(DEFAULT_FORMATION_SETTINGS);
    setFormationDeliveryStatus('');
    setPathDeliveryStatus('');
  };

  const generateFormationPhaseId = () =>
    `phase-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const handleAddFormationPhase = useCallback(() => {
    // 첫 phase는 3D 씬의 현재 위치를 캡처하고, 이후 phase는 직전 phase를
    // 복사해서 시작한다 (씬의 드론이 지상(z=0)에 있어도 고도가 유지됨).
    const domPoints = readAllDronePositionsFromDom();
    setFormationPhases((prev) => {
      const fallbackName = `phase-${prev.length + 1}`;
      const lastPhase = prev[prev.length - 1];
      let points = domPoints;
      if (
        lastPhase &&
        lastPhase.points &&
        typeof lastPhase.points === 'object' &&
        Object.keys(lastPhase.points).length
      ) {
        points = {};
        for (const [droneId, pos] of Object.entries(lastPhase.points)) {
          points[droneId] =
            pos && typeof pos === 'object' && !Array.isArray(pos)
              ? { ...pos }
              : pos;
        }
      }
      return [
        ...prev,
        {
          id: generateFormationPhaseId(),
          name: fallbackName,
          holdMs: 3000,
          points,
        },
      ];
    });
  }, []);

  const closeFormationGridModal = useCallback(() => {
    setFormationGridModalOpen(false);
    setFormationGridEditPhaseId(null);
  }, []);

  const openFormationGridCreate = useCallback(() => {
    setFormationGridEditPhaseId(null);
    setFormationGridModalOpen(true);
  }, []);

  const openFormationGridEdit = useCallback((phaseId) => {
    if (!phaseId) return;
    setFormationGridEditPhaseId(String(phaseId));
    setFormationGridModalOpen(true);
  }, []);

  /** Lattice 그리드 툴로 새 phase 추가 또는 기존 phase 좌표 수정 후 씬에 반영 */
  const handleConfirmFormationGridPhase = useCallback(
    (pointsByDroneId, latticeRaw) => {
      if (!pointsByDroneId || typeof pointsByDroneId !== 'object') return;
      const points = {};
      for (const [droneId, pos] of Object.entries(pointsByDroneId)) {
        if (!droneId || !pos || typeof pos !== 'object') continue;
        const x = Number(pos.x);
        const y = Number(pos.y);
        const z = Number(pos.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        points[droneId] = {
          x: roundCoord(x),
          y: roundCoord(y),
          z: roundCoord(z),
        };
      }
      if (!Object.keys(points).length) return;
      const lattice = normalizeFormationLattice(latticeRaw);

      const editId = formationGridEditPhaseId;
      if (editId) {
        setFormationPhases((prev) =>
          prev.map((phase) => {
            if (String(phase.id) !== String(editId)) return phase;
            // 그리드에 배치된 드론만 유지 (대기 스택으로 뺀 드론은 phase에서 제거).
            // yaw 등 기존 속성은 남은 드론에 한해 보존한다.
            const nextPoints = {};
            Object.entries(points).forEach(([id, pos]) => {
              const prevPoint = phase.points?.[id];
              nextPoints[id] =
                prevPoint && typeof prevPoint === 'object' && !Array.isArray(prevPoint)
                  ? { ...prevPoint, ...pos }
                  : pos;
            });
            const next = { ...phase, points: nextPoints };
            if (lattice) next.lattice = lattice;
            else delete next.lattice;
            return next;
          })
        );
      } else {
        setFormationPhases((prev) => [
          ...prev,
          {
            id: generateFormationPhaseId(),
            name: `phase-${prev.length + 1}`,
            holdMs: 3000,
            points,
            ...(lattice ? { lattice } : {}),
          },
        ]);
      }

      Object.entries(points).forEach(([id, pos]) => {
        window.dispatchEvent(
          new CustomEvent('drone-move-request', {
            detail: { id, x: pos.x, y: pos.y, z: pos.z },
          })
        );
      });
    },
    [formationGridEditPhaseId]
  );

  const formationGridDrones = useMemo(() => {
    const drones = Array.isArray(effectiveConfig?.drones) ? effectiveConfig.drones : [];
    const editPhase = formationGridEditPhaseId
      ? formationPhases.find((p) => String(p.id) === String(formationGridEditPhaseId))
      : null;
    const phasePoints =
      editPhase?.points && typeof editPhase.points === 'object' ? editPhase.points : null;
    const domPoints = readAllDronePositionsFromDom();
    return drones
      .filter((d) => d?.id != null && String(d.id).trim() !== '')
      .map((d) => {
        const id = String(d.id);
        const fromPhase = phasePoints?.[id];
        if (
          fromPhase &&
          Number.isFinite(Number(fromPhase.x)) &&
          Number.isFinite(Number(fromPhase.y)) &&
          Number.isFinite(Number(fromPhase.z))
        ) {
          return {
            id,
            x: Number(fromPhase.x),
            y: Number(fromPhase.y),
            z: Number(fromPhase.z),
            fromPhase: true,
          };
        }
        const fromDom = domPoints[id];
        if (
          fromDom &&
          Number.isFinite(Number(fromDom.x)) &&
          Number.isFinite(Number(fromDom.y)) &&
          Number.isFinite(Number(fromDom.z))
        ) {
          return { id, x: Number(fromDom.x), y: Number(fromDom.y), z: Number(fromDom.z) };
        }
        const [x, y, z] = getDroneInitialPositionTuple(d);
        return { id, x, y, z };
      });
  }, [
    effectiveConfig,
    formationGridModalOpen,
    formationGridEditPhaseId,
    formationPhases,
  ]);

  const formationGridEditLattice = useMemo(() => {
    if (!formationGridEditPhaseId) return null;
    const phase = formationPhases.find(
      (p) => String(p.id) === String(formationGridEditPhaseId)
    );
    return normalizeFormationLattice(phase?.lattice);
  }, [formationGridEditPhaseId, formationPhases]);

  /**
   * 새 phase를 만들 때 쓸 격자 시드 — 마지막으로 그리드를 사용한 phase의
   * 개수·간격·기준점. 앱을 다시 켜도 phase에 저장된 값이라 그대로 이어진다.
   */
  const formationGridLastUsedLattice = useMemo(() => {
    for (let i = formationPhases.length - 1; i >= 0; i -= 1) {
      const lattice = normalizeFormationLattice(formationPhases[i]?.lattice);
      if (lattice) {
        return lattice;
      }
    }

    return null;
  }, [formationPhases]);

  const formationGridEditPhaseName = useMemo(() => {
    if (!formationGridEditPhaseId) return '';
    const phase = formationPhases.find(
      (p) => String(p.id) === String(formationGridEditPhaseId)
    );
    return phase?.name ? String(phase.name) : '';
  }, [formationGridEditPhaseId, formationPhases]);

  /**
   * 그리드 편집기에 회색 참고 점으로 깔아줄 "이전 상태" — 편집이면 바로 앞
   * phase, 새 phase면 마지막 phase. 앞 phase가 없으면 드론의 초기 위치를 쓴다.
   */
  const formationGridPrevious = useMemo(() => {
    const drones = Array.isArray(effectiveConfig?.drones)
      ? effectiveConfig.drones.filter(
          (d) => d?.id != null && String(d.id).trim() !== ''
        )
      : [];
    if (!drones.length) {
      return { drones: [], label: '' };
    }

    const editIndex = formationGridEditPhaseId
      ? formationPhases.findIndex(
          (p) => String(p.id) === String(formationGridEditPhaseId)
        )
      : formationPhases.length;
    const previousPhase =
      editIndex > 0 ? formationPhases[editIndex - 1] : undefined;
    const points =
      previousPhase?.points && typeof previousPhase.points === 'object'
        ? previousPhase.points
        : null;

    if (points) {
      const previousDrones = [];
      for (const d of drones) {
        const id = String(d.id);
        const point = points[id];
        const x = Number(point?.x);
        const y = Number(point?.y);
        const z = Number(point?.z);
        if (
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          Number.isFinite(z)
        ) {
          previousDrones.push({ id, x, y, z });
        }
      }

      return {
        drones: previousDrones,
        label: previousPhase?.name
          ? String(previousPhase.name)
          : `phase-${editIndex}`,
      };
    }

    return {
      drones: drones.map((d) => {
        const [x, y, z] = getDroneInitialPositionTuple(d);
        return { id: String(d.id), x, y, z };
      }),
      label: '초기 위치',
    };
  }, [
    effectiveConfig,
    formationGridEditPhaseId,
    formationGridModalOpen,
    formationPhases,
  ]);

  /** 기존 phase(a,b,c)의 역순(c,b,a)을 복제해 뒤에 추가 */
  const handleAppendReversedFormationPhases = useCallback(() => {
    setFormationPhases((prev) => {
      if (!prev.length) return prev;
      const reversed = [...prev].reverse().map((phase) => {
        const points = {};
        for (const [droneId, pos] of Object.entries(phase.points || {})) {
          points[droneId] =
            pos && typeof pos === 'object' && !Array.isArray(pos) ? { ...pos } : pos;
        }
        const baseName = String(phase.name || '').trim() || 'phase';
        const reversedPhase = {
          id: generateFormationPhaseId(),
          name: `${baseName}-rev`,
          holdMs: phase.holdMs,
          points,
        };
        if (Array.isArray(phase.fixedDroneIds) && phase.fixedDroneIds.length) {
          reversedPhase.fixedDroneIds = [...phase.fixedDroneIds];
        }
        if (Array.isArray(phase.clusters) && phase.clusters.length) {
          reversedPhase.clusters = phase.clusters.map((c) => [...c]);
        }
        const lattice = normalizeFormationLattice(phase.lattice);
        if (lattice) {
          reversedPhase.lattice = lattice;
        }
        return reversedPhase;
      });
      setLastReversedPhaseIds(reversed.map((phase) => phase.id));
      return [...prev, ...reversed];
    });
  }, []);

  /** 직전에 추가한 역점(역순 복제 phase)을 제거 */
  const handleRecoverReversedFormationPhases = useCallback(() => {
    setFormationPhases((prev) => {
      if (!lastReversedPhaseIds.length) return prev;
      const idSet = new Set(lastReversedPhaseIds);
      return prev.filter((phase) => !idSet.has(phase.id));
    });
    setLastReversedPhaseIds([]);
  }, [lastReversedPhaseIds]);

  const handleUpdateFormationPhaseMeta = useCallback((phaseId, updates) => {
    setFormationPhases((prev) =>
      prev.map((phase) => (phase.id === phaseId ? { ...phase, ...updates } : phase))
    );
  }, []);

  const handleUpdateFormationDronePosition = useCallback(
    (phaseId, droneId, position) => {
      const pid = phaseId != null ? String(phaseId) : '';
      const did = droneId != null ? String(droneId) : '';
      if (!pid || !did) return;
      setFormationPhases((prev) =>
        prev.map((phase) => {
          if (String(phase.id) !== pid) return phase;
          const nextPoints = { ...(phase.points || {}) };
          if (position === null) {
            delete nextPoints[did];
          } else {
            nextPoints[did] = position;
          }
          return { ...phase, points: nextPoints };
        })
      );
    },
    []
  );

  const handleCaptureDronePositionInPhase = useCallback(
    (phaseId, droneId) => {
      const pos = readDronePositionFromDom(droneId);
      if (!pos) return;
      handleUpdateFormationDronePosition(phaseId, droneId, pos);
    },
    [handleUpdateFormationDronePosition]
  );

  const handleCaptureAllPositionsInPhase = useCallback((phaseId) => {
    const points = readAllDronePositionsFromDom();
    setFormationPhases((prev) =>
      prev.map((phase) => (phase.id === phaseId ? { ...phase, points } : phase))
    );
  }, []);

  /**
   * 직선 경로 고정: 이 phase로의 전환 동안 해당 드론이 자동 회피 없이 이전
   * formation 위치 → 이 phase 위치를 잇는 직선을 그대로 날도록 지정한다.
   * 고정된 드론들은 디스패치 대기 없이 전원 동시에 출발한다.
   */
  const handleToggleFixedStraight = useCallback((phaseId, droneId) => {
    const pid = phaseId != null ? String(phaseId) : '';
    const did = droneId != null ? String(droneId) : '';
    if (!pid || !did) return;
    setFormationPhases((prev) =>
      prev.map((phase) => {
        if (String(phase.id) !== pid) return phase;
        const current = Array.isArray(phase.fixedDroneIds)
          ? phase.fixedDroneIds.map(String)
          : [];
        const next = current.includes(did)
          ? current.filter((id) => id !== did)
          : [...current, did];
        return { ...phase, fixedDroneIds: next };
      })
    );
  }, []);

  const handleSetAllFixedStraight = useCallback(
    (phaseId, enable) => {
      const pid = phaseId != null ? String(phaseId) : '';
      if (!pid) return;
      const allIds = (Array.isArray(effectiveConfig?.drones)
        ? effectiveConfig.drones
        : []
      )
        .map((d) => (d?.id != null ? String(d.id) : ''))
        .filter(Boolean);
      setFormationPhases((prev) =>
        prev.map((phase) =>
          String(phase.id) === pid
            ? { ...phase, fixedDroneIds: enable ? allIds : [] }
            : phase
        )
      );
    },
    [effectiveConfig]
  );

  const handleRemoveFormationPhase = useCallback((phaseId) => {
    setFormationPhases((prev) => prev.filter((phase) => phase.id !== phaseId));
    setLastReversedPhaseIds((prev) => prev.filter((id) => id !== phaseId));
    setSelectedPhaseId((prev) => (prev === phaseId ? null : prev));
  }, []);

  // ── phase 선택 + 클러스터(강체 그룹) ─────────────────────────────────
  // phase 카드를 클릭해 선택하면, 좌측 "드론 선택" 탭에서 현재 선택된
  // 드론들로 그 phase 전환의 클러스터(통째로 움직이는 그룹)를 만들 수 있다.
  const [selectedPhaseId, setSelectedPhaseId] = useState(null);

  const handleTogglePhaseSelected = useCallback((phaseId) => {
    const pid = phaseId != null ? String(phaseId) : '';
    if (!pid) return;
    setSelectedPhaseId((prev) => (prev === pid ? null : pid));
  }, []);

  const handleAddClusterToPhase = useCallback((phaseId) => {
    const pid = phaseId != null ? String(phaseId) : '';
    const ids = [...multiSelectedRef.current];
    if (!pid || ids.length < 2) return;
    setFormationPhases((prev) =>
      prev.map((phase) => {
        if (String(phase.id) !== pid) return phase;
        const existing = Array.isArray(phase.clusters)
          ? phase.clusters.map((c) => c.map(String))
          : [];
        // 새 그룹 멤버는 기존 그룹들에서 제거해 중복 소속을 막는다.
        const idSet = new Set(ids);
        const cleaned = existing
          .map((cluster) => cluster.filter((id) => !idSet.has(id)))
          .filter((cluster) => cluster.length > 0);
        return { ...phase, clusters: [...cleaned, ids] };
      })
    );
  }, []);

  const handleAddClusterToSelectedPhase = useCallback(() => {
    if (selectedPhaseId) {
      handleAddClusterToPhase(selectedPhaseId);
    }
  }, [selectedPhaseId, handleAddClusterToPhase]);

  // ── 이미지 → 점 formation ─────────────────────────────────────────────
  const [imageDotsModalOpen, setImageDotsModalOpen] = useState(false);

  const handleAddFormationPhaseFromImage = useCallback(
    (name, points) => {
      if (!points || !Object.keys(points).length) return;
      const holdMs = 3000;
      const phaseName = String(name || '').trim();
      setFormationPhases((prev) => [
        ...prev,
        {
          id: generateFormationPhaseId(),
          name: phaseName || `image-${prev.length + 1}`,
          holdMs,
          points,
        },
      ]);

      // 이미지에서 뽑은 드론별 색을 JR LED 쇼에도 반영: 드론 인덱스 순서
      // (= LED 보드/3D 구체 렌더의 인덱스 순서)로 색 배열을 만들어 phase
      // 이름의 보드를 생성/갱신한다. 색 정보가 없으면(3D 모델 소스 등)
      // 보드를 만들지 않는다.
      const droneList = Array.isArray(effectiveConfig?.drones)
        ? effectiveConfig.drones
        : [];
      const colors = droneList.map((d) => {
        const c = points[String(d?.id)]?.color;
        return Array.isArray(c) && c.length === 3 ? c : null;
      });
      if (colors.some(Boolean)) {
        store.dispatch(
          upsertImageBoard({
            name: `LED · ${phaseName || 'image'}`,
            colors,
            durationSec: holdMs / 1000,
          })
        );
      }
    },
    [effectiveConfig]
  );

  const handleRemoveClusterFromPhase = useCallback((phaseId, clusterIndex) => {
    const pid = phaseId != null ? String(phaseId) : '';
    if (!pid) return;
    setFormationPhases((prev) =>
      prev.map((phase) => {
        if (String(phase.id) !== pid) return phase;
        const clusters = Array.isArray(phase.clusters) ? phase.clusters : [];
        const next = clusters.filter((_, index) => index !== clusterIndex);
        return { ...phase, clusters: next };
      })
    );
  }, []);

  const handleMoveFormationPhase = useCallback((phaseId, direction) => {
    if (!phaseId || !direction) return;
    setFormationPhases((prev) => {
      const index = prev.findIndex((phase) => phase.id === phaseId);
      if (index < 0) return prev;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = prev.slice();
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }, []);

  const handleDuplicateFormationPhase = useCallback((phaseId) => {
    if (!phaseId) return;
    setFormationPhases((prev) => {
      const index = prev.findIndex((phase) => phase.id === phaseId);
      if (index < 0) return prev;
      const phase = prev[index];
      const points = {};
      for (const [droneId, pos] of Object.entries(phase.points || {})) {
        points[droneId] =
          pos && typeof pos === 'object' && !Array.isArray(pos) ? { ...pos } : pos;
      }
      const baseName = String(phase.name || '').trim() || 'phase';
      const copy = {
        id: generateFormationPhaseId(),
        name: `${baseName}-copy`,
        holdMs: phase.holdMs,
        points,
      };
      if (Array.isArray(phase.fixedDroneIds) && phase.fixedDroneIds.length) {
        copy.fixedDroneIds = [...phase.fixedDroneIds];
      }
      if (Array.isArray(phase.clusters) && phase.clusters.length) {
        copy.clusters = phase.clusters.map((c) => [...c]);
      }
      const lattice = normalizeFormationLattice(phase.lattice);
      if (lattice) {
        copy.lattice = lattice;
      }
      const next = prev.slice();
      next.splice(index + 1, 0, copy);
      return next;
    });
  }, []);

  const handleUpdateFormationSettings = useCallback((updates) => {
    setFormationSettings((prev) => sanitizeFormationSettings({ ...prev, ...updates }));
  }, []);

  const handleApplyDronePositionInPhase = useCallback((phaseId, droneId) => {
    const phase = formationPhases.find((p) => p.id === phaseId);
    if (!phase) return;
    const position = phase.points?.[droneId];
    if (!position) return;
    const x = Number(position.x);
    const y = Number(position.y);
    const z = Number(position.z);
    const yaw = Number(position.yaw);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const detail = { id: droneId, x, y, z };
    if (Number.isFinite(yaw)) {
      detail.yaw = yaw;
    }
    window.dispatchEvent(
      new CustomEvent('drone-move-request', {
        detail,
      })
    );
  }, [formationPhases]);

  /** phase별 저장 좌표(미캡처 드론은 초기/경로 첫 점)로 전체 드론을 한 번에 이동 */
  const handleApplyAllDronesInPhase = useCallback(
    (phaseId) => {
      const phase = formationPhases.find((p) => p.id === phaseId);
      if (!phase) return;
      const drones = Array.isArray(effectiveConfig?.drones) ? effectiveConfig.drones : [];
      drones.forEach((d) => {
        if (!d?.id) return;
        const id = String(d.id);
        const captured = phase.points?.[id];
        let x;
        let y;
        let z;
        if (
          captured &&
          Number.isFinite(Number(captured.x)) &&
          Number.isFinite(Number(captured.y)) &&
          Number.isFinite(Number(captured.z))
        ) {
          x = Number(captured.x);
          y = Number(captured.y);
          z = Number(captured.z);
        } else {
          [x, y, z] = getDroneInitialPositionTuple(d);
        }
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        const yaw = Number(captured?.yaw);
        const detail = { id: d.id, x, y, z };
        if (Number.isFinite(yaw)) {
          detail.yaw = yaw;
        }
        window.dispatchEvent(
          new CustomEvent('drone-move-request', {
            detail,
          })
        );
      });
    },
    [formationPhases, effectiveConfig]
  );

  const buildFormationPayload = useCallback(() => {
    const drones = Array.isArray(effectiveConfig?.drones) ? effectiveConfig.drones : [];
    const initial = drones
      .filter((d) => d?.id)
      .map((d) => {
        const [x, y, z] = getDroneInitialPositionTuple(d);
        return { droneId: String(d.id), x, y, z };
      });

    const phases = formationPhases.map((phase) => {
      const points = drones
        .filter((d) => d?.id)
        .map((d) => {
          const id = String(d.id);
          const captured = phase.points?.[id];
          const yaw = Number(captured?.yaw);
          if (
            captured &&
            Number.isFinite(Number(captured.x)) &&
            Number.isFinite(Number(captured.y)) &&
            Number.isFinite(Number(captured.z))
          ) {
            const point = {
              droneId: id,
              x: Number(captured.x),
              y: Number(captured.y),
              z: Number(captured.z),
            };
            if (Number.isFinite(yaw)) {
              point.yaw = yaw;
            }
            return point;
          }
          const [x, y, z] = getDroneInitialPositionTuple(d);
          const point = { droneId: id, x, y, z };
          if (Number.isFinite(yaw)) {
            point.yaw = yaw;
          }
          return point;
        });

      const holdMs = Math.max(0, Math.round(Number(phase.holdMs) || 0));
      const name = String(phase.name || '').trim() || `phase`;

      // 직선 경로 고정: 웨이포인트가 목표점 하나인 고정 경로 = 출발
      // 위치에서 이 phase 위치까지의 직선. 고정된 드론은 백엔드에서
      // 디스패치 대기 없이 동시에 출발한다.
      const fixedSet = new Set(
        (Array.isArray(phase.fixedDroneIds) ? phase.fixedDroneIds : []).map(
          String
        )
      );
      const fixedPaths = points
        .filter((point) => fixedSet.has(point.droneId))
        .map((point) => ({
          droneId: point.droneId,
          path: [{ x: point.x, y: point.y, z: point.z }],
        }));

      const phasePayload = { name, holdMs, points };
      if (fixedPaths.length) {
        phasePayload.fixedPaths = fixedPaths;
      }

      // 클러스터: 존재하는 드론만, 직선 고정(fixedPaths)과 중복되지 않게.
      const pointIdSet = new Set(points.map((p) => p.droneId));
      const clusters = (Array.isArray(phase.clusters) ? phase.clusters : [])
        .map((cluster) =>
          (Array.isArray(cluster) ? cluster : [])
            .map(String)
            .filter(
              (id, i, arr) =>
                pointIdSet.has(id) &&
                !fixedSet.has(id) &&
                arr.indexOf(id) === i
            )
        )
        .filter((cluster) => cluster.length > 0);
      if (clusters.length) {
        phasePayload.clusters = clusters;
      }
      return phasePayload;
    });

    const sanitized = sanitizeFormationSettings(formationSettings);
    const payload = {
      initial,
      phases,
      step_size: sanitized.step_size,
      cruise_speed: sanitized.cruise_speed,
      auto_upload: sanitized.auto_upload,
      min_separation: sanitized.min_separation,
      // 관성 프로파일 (전역 공유값): 스무딩 = 램프 비율, exp/log = 곡률
      velocity_smoothing: getVelocitySmoothing(),
      profile_exp: getProfileExp(),
      profile_log: getProfileLog(),
    };
    // output은 빈 문자열이면 생략 → 백엔드가 기본값(.skyc 다운로드)으로 처리.
    if (sanitized.output) {
      payload.output = sanitized.output;
    }
    // takeoff_time은 옵션값이므로 0보다 클 때만 포함 (백엔드 기본 포맷과 정렬)
    if (Number(sanitized.takeoff_time) > 0) {
      payload.takeoff_time = sanitized.takeoff_time;
    }
    return payload;
  }, [effectiveConfig, formationPhases, formationSettings]);

  const handleSendFormationPlan = useCallback(async () => {
    if (!formationPhases.length) {
      setFormationDeliveryStatus('포메이션 phase를 먼저 추가해주세요.');
      return;
    }

    const payload = buildFormationPayload();
    if (!payload.initial.length) {
      setFormationDeliveryStatus('드론이 없습니다. 먼저 드론을 추가해주세요.');
      return;
    }
    if (!payload.phases.length) {
      setFormationDeliveryStatus('전송할 포메이션 phase가 없습니다.');
      return;
    }

    const usedUrl = DEFAULT_PATH_DELIVERY_URL;
    const requestBody = JSON.stringify(payload);
    const payloadPreview = requestBody.length > 600
      ? `${requestBody.slice(0, 600)}... (총 ${requestBody.length}자)`
      : requestBody;

    // Log full payload so user can verify it matches the backend spec.
    // eslint-disable-next-line no-console
    console.log('[Formation] POST', usedUrl, payload);

    const sendStartedAt = Date.now();
    setIsSendingFormation(true);
    setFormationSendStartedAt(sendStartedAt);
    setFormationDeliveryStatus('');
    const totalElapsedText = () =>
      `${((Date.now() - sendStartedAt) / 1000).toFixed(1)}s`;

    // 계획 진행률 폴링: 서버의 그리디 계산이 어느 세그먼트/스텝까지
    // 왔는지, 구간별 예상 잔여 시간과 함께 상태창에 실시간 표시한다.
    const progressTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/v1/path-planner/progress');
        if (!res.ok) return;
        const p = await res.json();
        if (!p || !p.active) return;
        let line = `계획 진행 중 · ${p.segment || '준비'}`;
        if (Number.isFinite(Number(p.phases_total)) && p.segment_index) {
          line += ` (세그먼트 ${p.segment_index})`;
        }
        if (Number.isFinite(Number(p.percent))) {
          line += ` · ${p.percent}%`;
        }
        if (Number.isFinite(Number(p.step)) && p.step > 0) {
          line += ` · 스텝 ${p.step}`;
        }
        if (Number.isFinite(Number(p.remaining_m))) {
          line += ` · 잔여 ${p.remaining_m}m`;
        }
        if (Number.isFinite(Number(p.elapsed_sec))) {
          line += `\n경과 ${p.elapsed_sec}s`;
        }
        if (Number.isFinite(Number(p.segment_eta_sec))) {
          line += ` · 이 구간 예상 잔여 ~${Math.ceil(p.segment_eta_sec)}s`;
        }
        setFormationDeliveryStatus(line);
      } catch {
        // 폴링 실패는 무시 (본 요청이 상태를 최종 결정)
      }
    }, 1000);

    try {
      const response = await fetch(usedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      if (!response.ok) {
        const msg = await getPathDeliveryErrorMessage(response);
        throw new Error(msg || `요청 실패: ${response.status}`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const isJsonResponse = contentType.includes('application/json');
      let summaryDetail = '';

      if (isJsonResponse) {
        const json = await response.json().catch(() => null);
        if (json && typeof json === 'object') {
          summaryDetail = `\n응답: ${JSON.stringify(json).slice(0, 240)}`;
          const planningSec = Number(json.timing?.planning_sec);
          const verifySec = Number(json.timing?.build_verify_sec);
          if (Number.isFinite(planningSec)) {
            summaryDetail += `\n서버 계산: 계획 ${planningSec}s`;
            if (Number.isFinite(verifySec)) {
              summaryDetail += ` · 생성/검증 ${verifySec}s`;
            }
          }
          // 백엔드가 계산한 phase별 실제 도착/종료 시각(절대 초)을 LED
          // 타임라인 마커로 반영. staging-grid / return-to-start 구간은
          // 회색 'transit' 구간으로 구분한다.
          if (Array.isArray(json.phases)) {
            let formationIndex = 0;
            const planned = json.phases
              .filter(
                (p) =>
                  Number.isFinite(Number(p?.arrivalTimeAbsSec)) &&
                  Number.isFinite(Number(p?.endTimeAbsSec))
              )
              .map((p) => {
                const name = String(p.name || `phase-${formationIndex + 1}`);
                const isTransit =
                  name === 'staging-grid' || name === 'return-to-start';
                const color = isTransit
                  ? '#546e7a'
                  : FORMATION_COLORS[formationIndex % FORMATION_COLORS.length];
                if (!isTransit) formationIndex += 1;
                return {
                  name,
                  startSec: Number(p.arrivalTimeAbsSec),
                  endSec: Number(p.endTimeAbsSec),
                  color,
                  ...(isTransit ? { kind: 'transit' } : {}),
                };
              });
            if (planned.length) {
              setPlannedTimeline(planned);
              summaryDetail += `\nLED 타임라인에 실제 phase 타이밍 반영 (${planned.length}개 구간)`;
            }
          }
        }
      } else {
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        // output 미지정 또는 'skyc' = .skyc, 'show' = .show, 'path' = .json (보통은 JSON 응답).
        const ext = payload.output === 'show'
          ? 'show'
          : payload.output === 'path'
            ? 'json'
            : 'skyc';
        a.href = objectUrl;
        a.download = `formation-plan.${ext}`;
        document.body.appendChild(a);
        a.click();
        if (a.parentNode === document.body) {
          try {
            document.body.removeChild(a);
          } catch (error) {
            if (error?.name !== 'NotFoundError') throw error;
          }
        }
        URL.revokeObjectURL(objectUrl);
        summaryDetail = `\n다운로드: formation-plan.${ext}`;
      }

      setFormationDeliveryStatus(
        `포메이션 전달 완료 (총 ${totalElapsedText()}): ${payload.initial.length}대 · phase ${payload.phases.length}개${summaryDetail}\nURL: ${usedUrl}\nProxy target: ${PATH_DELIVERY_PROXY_TARGET}`
      );
    } catch (error) {
      const baseMsg = error instanceof Error ? error.message : '알 수 없는 오류';
      const looksLikeOldBackend = /must be arrays of \[x,y,z\]/i.test(baseMsg);
      const hint = looksLikeOldBackend
        ? '\n\n[힌트] 백엔드가 phase-based 포맷(initial+phases)을 인식하지 못합니다.\n→ localhost:5001 path-planner 서버를 새 버전으로 업데이트/재시작해주세요.'
        : '';
      setFormationDeliveryStatus(
        `포메이션 전달 실패 (총 ${totalElapsedText()}): ${baseMsg}${hint}\nURL: ${usedUrl}\nProxy target: ${PATH_DELIVERY_PROXY_TARGET}\n\n[보낸 페이로드]\n${payloadPreview}`
      );
    } finally {
      clearInterval(progressTimer);
      setIsSendingFormation(false);
      setFormationSendStartedAt(null);
    }
  }, [buildFormationPayload, formationPhases]);

  const sceneEditProps = isCreateMode
    ? { 'drone-move-bridge': '', 'drone-axis-gizmo': '' }
    : {};

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {isCreateMode && (
      <PathControlPanel
        fileInputRef={fileInputRef}
        pathProgress={pathProgress}
        onPathProgressChange={handlePathProgressChange}
        currentPositionMs={currentPositionMs}
        totalDurationMs={maxPathDurationMs}
        playbackSourceLabel={playbackSourceLabel}
        showSpecActive={
          !!(
            showSpecDroneConfig &&
            Array.isArray(showSpecDroneConfig.drones) &&
            showSpecDroneConfig.drones.length > 0
          )
        }
        showSpecIgnored={showSpecIgnored}
        onToggleShowSpecIgnored={() => setShowSpecIgnored((prev) => !prev)}
        isPlaybackRunning={syncActive ? ledPlaying : isPlaybackRunning}
        ledSyncEnabled={threeDSync}
        onLedSyncToggle={handleLedSyncToggle}
        sphereRender={sphereSimRender}
        onSphereRenderChange={setSphereSimRender}
        droneCount={
          effectiveConfig && Array.isArray(effectiveConfig.drones)
            ? effectiveConfig.drones.length
            : 0
        }
        onPlayAll={handlePlayAll}
        onPausePlayback={handlePausePlayback}
        onResetAll={handleResetAll}
        onResetPanelSettings={handleResetPanelSettings}
        onLoadConfigClick={handleLoadConfigClick}
        onSaveConfigClick={handleSaveConfigClick}
        onSendPathsClick={handleSendPathsClick}
        onFileChange={handleFileChange}
        onAddDroneClick={() => setAddDroneModalOpen(true)}
        isSendingPaths={isSendingPaths}
        pathDeliveryStatus={pathDeliveryStatus}
      />
      )}
      {isCreateMode && (
      <AddDroneModal
        open={addDroneModalOpen}
        onClose={() => setAddDroneModalOpen(false)}
        onAdd={handleAddDrones}
        existingIds={
          effectiveConfig && Array.isArray(effectiveConfig.drones)
            ? effectiveConfig.drones.map((d) => d.id)
            : []
        }
      />
      )}
      {isCreateMode && (
      <FormationGridModal
        open={formationGridModalOpen}
        onClose={closeFormationGridModal}
        drones={formationGridDrones}
        onConfirm={handleConfirmFormationGridPhase}
        mode={formationGridEditPhaseId ? 'edit' : 'create'}
        initialLattice={
          formationGridEditPhaseId
            ? formationGridEditLattice
            : formationGridLastUsedLattice
        }
        previousDrones={formationGridPrevious.drones}
        previousLabel={formationGridPrevious.label}
        title={
          formationGridEditPhaseId
            ? `Formation · 수정${
                formationGridEditPhaseName ? ` · ${formationGridEditPhaseName}` : ''
              }`
            : undefined
        }
      />
      )}
      {isCreateMode && (
      <PathGeneratorModal
        open={pathGeneratorModalOpen}
        onClose={() => setPathGeneratorModalOpen(false)}
      />
      )}
      <a-scene
        key={sceneId}
        ref={ref}
        deallocate
        embedded="true"
        keyboard-shortcuts="enterVR: false"
        loading-screen="backgroundColor: #424242; dotsColor: #888"
        renderer="antialias: false; colorManagement: true; physicallyCorrectLights: true"
        xr-mode-ui="enabled: false"
        device-orientation-permission-ui="enabled: false"
        tabIndex={-1}
        class="react-hotkeys-ignore no-focus-ring"
        {...sceneEditProps}
        {...extraSceneProps}
      >
        <a-assets>
          <a-asset-item id="drone-obj" src="assets/obj/ur9.obj" />
          <a-mixin
            id="drone-marker"
            fbx-model="src: assets/obj/ur9.obj; modelRotation: 0 0 0"
          />
          <a-mixin
            id="takeoff-marker"
            geometry="primitive: triangle; vertexA: 1 0 0; vertexB: -0.5 0.866 0; vertexC: -0.5 -0.866 0"
            material={`color: ${Colors.markers.takeoff}; shader: flat; side: double`}
          />
          <a-mixin
            id="landing-marker"
            geometry="primitive: triangle; vertexA: -1 0 0; vertexB: 0.5 -0.866 0; vertexC: 0.5 0.866 0"
            material={`color: ${Colors.markers.landing}; shader: flat; side: double`}
          />
        </a-assets>

        {/* ✅ 마우스 피킹/호버 커서 */}
        <a-entity
          id="mouse-ray"
          click-pick={isCreateMode ? 'externalSelection: true' : ''}
          hover-cursor="className: three-d-clickable; interval: 50"
        />

        {/* ✅ 카메라 */}
        <a-camera
          ref={cameraRef}
          sync-pose-with-store=""
          id="three-d-camera"
          {...extraCameraProps}
        />

        <a-entity rotation="-90 0 90">
          <SatelliteMapGround
            enabled={scenery === 'outdoor'}
            lighting={effectiveLighting}
          />
          {showAxes && (
            <CoordinateSystemAxes
              leftHanded={isCoordinateSystemLeftHanded}
              length={10}
              lineWidth={10}
            />
          )}
          {/* {showHomePositions && effectiveConfig?.source !== 'showSpec' && (
            <HomePositionMarkers />
          )} */}
          {showLandingPositions && <LandingPositionMarkers />}
          {showTrajectoriesOfSelection && <SelectedTrajectories />}

          <DronePathTrajectories
            drones={effectiveConfig && Array.isArray(effectiveConfig.drones) ? effectiveConfig.drones : undefined}
            selectedDroneId={selectedPathDroneId}
          />
          {isCreateMode && !sphereModeActive && (
            <DroneShapeMarkers
              drones={
                effectiveConfig && Array.isArray(effectiveConfig.drones)
                  ? effectiveConfig.drones
                  : undefined
              }
            />
          )}
          {isCreateMode && sphereModeActive && (
            <DroneSphereMarkers
              drones={
                effectiveConfig && Array.isArray(effectiveConfig.drones)
                  ? effectiveConfig.drones
                  : undefined
              }
              selectedIds={multiSelectedDroneIds}
            />
          )}
          {!isCreateMode && <a-drone-flock />}
          <Room />
        </a-entity>

        <Scenery type={`${scenery}-${effectiveLighting}`} grid={grid} />
      </a-scene>

      {/* ✅ 우측 패널 (Create 모드 전용) */}
      {isCreateMode && (
      <DroneInfoPanel
        open={panelOpen}
        onClose={closePanel}
        drone={selectedDrone}
        droneCount={
          effectiveConfig && Array.isArray(effectiveConfig.drones)
            ? effectiveConfig.drones.length
            : 0
        }
        droneIds={
          effectiveConfig && Array.isArray(effectiveConfig.drones)
            ? effectiveConfig.drones
                .map((d) =>
                  d?.id != null && String(d.id).trim() !== '' ? String(d.id) : null
                )
                .filter(Boolean)
            : []
        }
        formationPhases={formationPhases}
        formationSettings={formationSettings}
        isSendingFormation={isSendingFormation}
        formationSendStartedAt={formationSendStartedAt}
        formationDeliveryStatus={formationDeliveryStatus}
        onAddFormationPhase={handleAddFormationPhase}
        onOpenFormationGrid={openFormationGridCreate}
        onEditFormationPhaseGrid={openFormationGridEdit}
        onAppendReversedFormationPhases={handleAppendReversedFormationPhases}
        onRecoverReversedFormationPhases={handleRecoverReversedFormationPhases}
        canRecoverReversedFormationPhases={lastReversedPhaseIds.length > 0}
        onRemoveFormationPhase={handleRemoveFormationPhase}
        onMoveFormationPhase={handleMoveFormationPhase}
        onDuplicateFormationPhase={handleDuplicateFormationPhase}
        onUpdateFormationPhaseMeta={handleUpdateFormationPhaseMeta}
        onUpdateFormationDronePosition={handleUpdateFormationDronePosition}
        onCaptureDronePositionInPhase={handleCaptureDronePositionInPhase}
        onCaptureAllPositionsInPhase={handleCaptureAllPositionsInPhase}
        onToggleFixedStraight={handleToggleFixedStraight}
        onSetAllFixedStraight={handleSetAllFixedStraight}
        selectedPhaseId={selectedPhaseId}
        onTogglePhaseSelected={handleTogglePhaseSelected}
        multiSelectedDroneIds={multiSelectedDroneIds}
        onAddClusterToPhase={handleAddClusterToPhase}
        onRemoveClusterFromPhase={handleRemoveClusterFromPhase}
        onOpenImageDots={() => setImageDotsModalOpen(true)}
        onApplyDronePositionInPhase={handleApplyDronePositionInPhase}
        onApplyAllDronesInPhase={handleApplyAllDronesInPhase}
        onUpdateFormationSettings={handleUpdateFormationSettings}
        onSendFormationPlan={handleSendFormationPlan}
        onDownloadSkyc={handleSendPathsClick}
        isDownloadingSkyc={isSendingPaths}
        skycDownloadStatus={pathDeliveryStatus}
      />
      )}

      {isCreateMode && (
        <DroneSelectPanel
          drones={(Array.isArray(effectiveConfig?.drones)
            ? effectiveConfig.drones
            : []
          )
            .filter((d) => d?.id != null)
            .map((d) => ({
              id: String(d.id),
              name: d.name ? String(d.name) : String(d.id),
            }))}
          selectedIds={multiSelectedDroneIds}
          onChangeSelection={handleMultiSelectionChange}
          onDeleteSelected={handleDeleteSelectedDrones}
          selectedPhase={(() => {
            if (!selectedPhaseId) return null;
            const index = formationPhases.findIndex(
              (p) => String(p.id) === selectedPhaseId
            );
            if (index < 0) return null;
            const phase = formationPhases[index];
            return {
              id: String(phase.id),
              name: String(phase.name || '').trim() || `phase-${index + 1}`,
              clusters: Array.isArray(phase.clusters)
                ? phase.clusters.map((c) => c.map(String))
                : [],
            };
          })()}
          onCreateCluster={handleAddClusterToSelectedPhase}
          onRemoveCluster={(clusterIndex) =>
            handleRemoveClusterFromPhase(selectedPhaseId, clusterIndex)
          }
        />
      )}
      {isCreateMode && (
        <ImageToDotsModal
          open={imageDotsModalOpen}
          droneIds={(Array.isArray(effectiveConfig?.drones)
            ? effectiveConfig.drones
            : []
          )
            .filter((d) => d?.id != null)
            .map((d) => String(d.id))}
          minSeparation={
            sanitizeFormationSettings(formationSettings).min_separation
          }
          suggestedPlaneX={(() => {
            // 대형(초기 위치 기준) 최북단 + 10m: 그림 평면이 이륙 지역을
            // 관통하지 않도록 앞쪽에 세운다.
            const drones = Array.isArray(effectiveConfig?.drones)
              ? effectiveConfig.drones
              : [];
            let maxX = 0;
            for (const d of drones) {
              const x = Number(
                Array.isArray(d?.initialPos) ? d.initialPos[0] : d?.pos?.[0]
              );
              if (Number.isFinite(x) && x > maxX) maxX = x;
            }
            return maxX + 10;
          })()}
          onCreatePhase={handleAddFormationPhaseFromImage}
          onClose={() => setImageDotsModalOpen(false)}
        />
      )}

      {/* ✅ 커서에서 시작하는 레이를 그릴 2D 오버레이 */}
      <div
        id="click-ray-overlay"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 9999,
        }}
      />
      {panelOpen && gizmoDragState.dragging && gizmoDragState.axis && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 12,
            transform: 'translateX(-50%)',
            zIndex: 12000,
            pointerEvents: 'none',
            padding: '4px 10px',
            borderRadius: 6,
            background: 'rgba(16, 18, 22, 0.75)',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 11,
            backdropFilter: 'blur(6px)',
          }}
        >
          {`${gizmoDragState.axis.toUpperCase()} 축 드래그 중`}
        </div>
      )}
    </div>
  );
});

ThreeDView.propTypes = {
  cameraRef: PropTypes.any,
  grid: PropTypes.string,
  interactionMode: PropTypes.oneOf(['view', 'create']),
  isCreateMode: PropTypes.bool,
  isCoordinateSystemLeftHanded: PropTypes.bool,
  lighting: PropTypes.oneOf(['dark', 'light']),
  naturalLighting: PropTypes.oneOf(['dark', 'light']),
  navigation: PropTypes.shape({
    mode: PropTypes.oneOf(['walk', 'fly']),
    parameters: PropTypes.object,
  }),
  sceneId: PropTypes.number,
  scenery: PropTypes.oneOf(['outdoor', 'indoor']),
  showAxes: PropTypes.bool,
  showHomePositions: PropTypes.bool,
  showLandingPositions: PropTypes.bool,
  showStatistics: PropTypes.bool,
  showTrajectoriesOfSelection: PropTypes.bool,
  showSpecDroneConfig: PropTypes.shape({
    drones: PropTypes.array,
    source: PropTypes.string,
  }),
  base64ShowBlob: PropTypes.string,
  showData: PropTypes.object,
  swarmSpecification: PropTypes.array,
  uavToMissionIndex: PropTypes.object,
  viewRuntime: PropTypes.shape({
    droneConfig: PropTypes.any,
    pathProgress: PropTypes.number,
    formationPhases: PropTypes.array,
    formationSettings: PropTypes.object,
  }),
  persistRehydrated: PropTypes.bool,
  onSetViewRuntimeState: PropTypes.func,
  ledPlayheadSec: PropTypes.number,
  ledPlaying: PropTypes.bool,
  threeDSync: PropTypes.bool,
  ledTimelineDuration: PropTypes.number,
};

export default connect(
  (state) => ({
    isCoordinateSystemLeftHanded: isMapCoordinateSystemLeftHanded(state),
    persistRehydrated: state._persist?.rehydrated === true,
    ...state.settings.threeD,
    ...state.threeD,
    scenery: getEffectiveScenery(state),
    lighting: getLightingConditionsForThreeDView(state),
    naturalLighting: getNaturalLightingForThreeDView(state),
    showSpecDroneConfig: getShowSpecDroneConfigForThreeDView(state),
    base64ShowBlob: getBase64ShowBlob(state),
    showData: state.show.data,
    swarmSpecification: getDroneSwarmSpecification(state),
    uavToMissionIndex: getReverseMissionMapping(state),
    ledPlayheadSec: getPlayheadSec(state),
    ledPlaying: getPlaying(state),
    threeDSync: getThreeDSync(state),
    ledTimelineDuration: getTimelineDuration(state),
  }),
  {
    onSetViewRuntimeState: setViewRuntimeState,
  },
  null,
  { forwardRef: true }
)(ThreeDView);