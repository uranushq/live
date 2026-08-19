import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';

import Colors from '~/components/colors';

import FillDirectionPicker from './FillDirectionPicker';
import GridSatelliteGround from './GridSatelliteGround';
import ImageToDotsModal from './ImageToDotsModal';
import {
  axisIndices,
  PLANE_AXES,
  resolveAxisOrder,
} from './utils/fillDirections';
import { fitIsoView, isoInverseOnZ, isoRaw } from './utils/isoProjection';

/** 3D 뷰 CoordinateSystemAxes와 동일한 축 색 */
const AXIS_COLORS = {
  x: Colors.axes.x, // #f44
  y: Colors.axes.y, // #4f4
  z: Colors.axes.z, // #06f
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const nodeKey = (i, j, k) => `${i}_${j}_${k}`;

const shortLabel = (id, index) => {
  const raw = String(id ?? '');
  if (!raw) return String(index + 1);
  const m = raw.match(/(\d+)\s*$/);
  if (m) return m[1];
  return raw.length > 6 ? raw.slice(-4) : raw;
};

const makeFallbackDrones = (n) => {
  const per = Math.ceil(Math.sqrt(n * 1.6));
  return Array.from({ length: n }, (_, i) => ({
    id: `drone-${i + 1}`,
    x: ((i % per) - (per - 1) / 2) * 10,
    y: -46 + Math.floor(i / per) * 10,
    z: 0,
    yaw: 0,
  }));
};

const round3 = (v) => Math.round(Number(v) * 1000) / 1000;

const uniqSorted = (vals) =>
  [...new Set(vals.map((v) => round3(v)).filter((v) => Number.isFinite(v)))].sort(
    (a, b) => a - b
  );

const spacingOf = (arr, fallback) => {
  if (arr.length < 2) return fallback;
  const diffs = [];
  for (let i = 1; i < arr.length; i += 1) {
    const d = arr[i] - arr[i - 1];
    if (d > 1e-6) diffs.push(d);
  }
  if (!diffs.length) return fallback;
  diffs.sort((a, b) => a - b);
  return Math.max(1, Math.round(diffs[Math.floor(diffs.length / 2)] * 2) / 2);
};

const DEFAULT_LATTICE = { nx: 6, ny: 6, nz: 4, sx: 8, sy: 8, sz: 6, ax: 0, ay: 0, az: 10 };

/** 이 대수까지만 이전 phase 회색 점에 드론 라벨을 붙인다. */
const GHOST_LABEL_LIMIT = 40;

/** 축별 최대 격자 개수 — 세 축 모두 동일하다. */
export const MAX_GRID_COUNT = 14;
/** 간격(m) 허용 범위 */
const MIN_SPACING = 1;
const MAX_SPACING = 60;

const ZERO_PAN = Object.freeze({ x: 0, y: 0 });

/**
 * 기준점(ax,ay,az) = 격자 시작 모서리 (i=j=k=0).
 * 월드 원점(0,0,0)의 XYZ 축과 별개로, 격자만 이 좌표에서 시작한다.
 */
const latticeSlotPos = (i, j, k, { ax, ay, az, sx, sy, sz }) => ({
  x: ax + i * sx,
  y: ay + j * sy,
  z: az + k * sz,
});

const normalizeLattice = (raw) => {
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
    !Number.isFinite(nx) ||
    !Number.isFinite(ny) ||
    !Number.isFinite(nz) ||
    !Number.isFinite(sx) ||
    !Number.isFinite(sy) ||
    !Number.isFinite(sz) ||
    !Number.isFinite(ax) ||
    !Number.isFinite(ay) ||
    !Number.isFinite(az)
  ) {
    return null;
  }
  return {
    nx: clamp(nx, 1, MAX_GRID_COUNT),
    ny: clamp(ny, 1, MAX_GRID_COUNT),
    nz: clamp(nz, 1, MAX_GRID_COUNT),
    sx: clamp(sx, MIN_SPACING, MAX_SPACING),
    sy: clamp(sy, MIN_SPACING, MAX_SPACING),
    sz: clamp(sz, MIN_SPACING, MAX_SPACING),
    ax,
    ay,
    az: Math.max(0, az),
  };
};

/** 드론 좌표를 격자 슬롯에 매칭해 occupancy 생성 */
const matchOccupancyToLattice = (positions, lattice) => {
  const occupancy = {};
  if (!lattice || !Array.isArray(positions) || !positions.length) return occupancy;
  const { nx, ny, nz, sx, sy, sz } = lattice;
  const tol = Math.min(sx, sy, sz) * 0.35;
  const tol2 = tol * tol;

  positions.forEach((p) => {
    if (!p?.id) return;
    let best = null;
    let bd = Infinity;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const { x, y, z } = latticeSlotPos(i, j, k, lattice);
          const dd = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
          if (dd < bd) {
            bd = dd;
            best = nodeKey(i, j, k);
          }
        }
      }
    }
    if (best && bd <= tol2 && !occupancy[best]) occupancy[best] = String(p.id);
  });
  return occupancy;
};

/** phase 좌표로부터 격자 파라미터 + 슬롯 점유(occupancy)를 추정 */
const inferLatticeFromPositions = (positions) => {
  if (!Array.isArray(positions) || !positions.length) return null;
  const xs = uniqSorted(positions.map((p) => p.x));
  const ys = uniqSorted(positions.map((p) => p.y));
  const zs = uniqSorted(positions.map((p) => p.z));
  if (!xs.length || !ys.length || !zs.length) return null;

  const sx = spacingOf(xs, 8);
  const sy = spacingOf(ys, 8);
  const sz = spacingOf(zs, 6);
  const nx = clamp(xs.length, 1, MAX_GRID_COUNT);
  const ny = clamp(ys.length, 1, MAX_GRID_COUNT);
  const nz = clamp(zs.length, 1, MAX_GRID_COUNT);
  // 기준점 = 격자 시작 모서리 (최소 좌표)
  const ax = xs[0];
  const ay = ys[0];
  const az = Math.max(0, zs[0]);
  const lattice = { nx, ny, nz, sx, sy, sz, ax, ay, az };
  const occupancy = matchOccupancyToLattice(positions, lattice);
  return { ...lattice, occupancy };
};

const parseNodeKey = (key) => {
  const [i, j, k] = String(key).split('_').map(Number);
  return { i, j, k };
};

const compareDroneId = (a, b) =>
  String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

const slotWorldPos = (key, { ax, ay, az, nx, ny, nz, sx, sy, sz }) => {
  const { i, j, k } = parseNodeKey(key);
  if (
    !Number.isFinite(i) ||
    !Number.isFinite(j) ||
    !Number.isFinite(k) ||
    i < 0 ||
    j < 0 ||
    k < 0 ||
    i >= nx ||
    j >= ny ||
    k >= nz
  ) {
    return null;
  }
  return latticeSlotPos(i, j, k, { ax, ay, az, sx, sy, sz });
};

/**
 * 좌표 우선순위대로 드론을 다시 배치한다.
 *
 *   1. 격자 슬롯 (occupancy)
 *   2. 자유 평면 배치 (freePos) — 이미지/3D 모델을 평면에 쏜 결과. 격자와
 *      무관한 연속 좌표라 슬롯에 스냅하지 않는다.
 *   3. homePos — 모달을 열었을 때의 좌표(= 이전 상태). 어디에도 올리지 않은
 *      드론은 이 값을 그대로 유지하고, 배치를 풀면 여기로 돌아온다.
 */
const relayoutDrones = (drones, occupancy, lattice, homePos, freePos) => {
  if (!Array.isArray(drones) || !drones.length) return drones;
  const placedPos = {};
  Object.entries(occupancy || {}).forEach(([key, droneId]) => {
    const pos = slotWorldPos(key, lattice);
    if (!pos || !droneId) return;
    placedPos[droneId] = pos;
  });
  return drones.map((d) => {
    if (placedPos[d.id]) return { ...d, ...placedPos[d.id] };
    const free = freePos?.[d.id];
    if (free) return { ...d, ...free };
    const home = homePos?.[d.id];
    return home ? { ...d, ...home } : d;
  });
};

const ACCENT = '#4ea8ff';
const ACCENT_DEEP = '#2a79d9';
const ACCENT_SOFT = '#7ec8ff';

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 21000,
  background: 'rgba(6, 10, 16, 0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 8,
};

const panelStyle = {
  position: 'relative',
  width: 'min(1480px, 100%)',
  height: 'min(960px, calc(100vh - 16px))',
  display: 'flex',
  flexDirection: 'column',
  background: 'linear-gradient(165deg, rgba(18, 24, 36, 0.98), rgba(11, 16, 26, 0.96))',
  border: '1px solid rgba(126, 200, 255, 0.22)',
  borderRadius: 16,
  boxShadow: '0 20px 48px rgba(0, 0, 0, 0.48)',
  color: '#f3f8ff',
  overflow: 'hidden',
};

const labStyle = {
  fontSize: 11,
  opacity: 0.68,
  letterSpacing: 0.2,
};

const inputStyle = {
  flex: 1,
  minWidth: 0,
  width: 56,
  padding: '7px 8px',
  fontSize: 13,
  color: '#ecf5ff',
  background: 'rgba(245, 250, 255, 0.06)',
  border: '1px solid rgba(130, 190, 255, 0.2)',
  borderRadius: 8,
  outline: 'none',
  boxSizing: 'border-box',
};

const segStyle = (on) => ({
  flex: 1,
  borderRadius: 10,
  border: on
    ? '1px solid rgba(78, 168, 255, 0.5)'
    : '1px solid rgba(255,255,255,0.1)',
  background: on
    ? `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`
    : 'rgba(255,255,255,0.04)',
  color: on ? '#fff' : 'rgba(255,255,255,0.72)',
  fontSize: 12,
  padding: '8px 10px',
  cursor: 'pointer',
  fontWeight: on ? 600 : 500,
});

const btnStyle = (solid = false, disabled = false) => ({
  border: solid ? 'none' : '1px solid rgba(255,255,255,0.18)',
  background: solid
    ? disabled
      ? 'rgba(255,255,255,0.1)'
      : `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`
    : 'rgba(255,255,255,0.05)',
  color: solid
    ? disabled
      ? 'rgba(255,255,255,0.35)'
      : '#fff'
    : 'rgba(243,248,255,0.86)',
  fontSize: 13,
  padding: '9px 18px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  borderRadius: 8,
  fontWeight: solid ? 600 : 500,
});

const iconBtnStyle = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.7)',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  flexShrink: 0,
};

const isPartialNumberInput = (raw, { integer = false, allowNegative = true } = {}) => {
  if (raw === '') return true;
  if (allowNegative && raw === '-') return true;
  if (integer) {
    return allowNegative ? /^-?\d*$/.test(raw) : /^\d*$/.test(raw);
  }
  if (!allowNegative && raw.startsWith('-')) return false;
  // 중간 입력: "", "-", ".", "-.", "2.", "-2.", ".5", "-.5"
  return /^-?(?:\d+\.?\d*|\.\d*)$/.test(raw);
};

const parseNumberDraft = (raw, { integer = false } = {}) => {
  if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return null;
  const v = integer ? parseInt(raw, 10) : parseFloat(raw);
  return Number.isFinite(v) ? v : null;
};

const commitNumberValue = (raw, { min, max, free, integer }) => {
  const parsed = parseNumberDraft(raw, { integer });
  if (parsed == null) return null;
  if (free) {
    if (min != null && parsed < min) return min;
    if (max != null && parsed > max) return max;
    return parsed;
  }
  const lo = min != null ? min : parsed;
  const hi = max != null ? max : parsed;
  return clamp(parsed, lo, hi);
};

function NumberField({ value, onChange, min, max, step, free, integer, allowNegative }) {
  const canBeNegative = allowNegative ?? (free ? min == null || min < 0 : min == null || min < 0);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  const display = focused ? draft : String(value ?? '');

  const commitDraft = (raw) => {
    const next = commitNumberValue(raw, { min, max, free, integer });
    if (next == null) {
      setDraft(String(value ?? ''));
      return;
    }
    onChange(next);
    setDraft(String(next));
  };

  return (
    <input
      className="fg-modal-input"
      style={inputStyle}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      spellCheck={false}
      min={min}
      max={max}
      step={step}
      value={display}
      onFocus={(e) => {
        setFocused(true);
        setDraft(String(value ?? ''));
        e.target.select();
      }}
      onBlur={() => {
        setFocused(false);
        commitDraft(draft);
      }}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (!isPartialNumberInput(raw, { integer, allowNegative: canBeNegative })) return;
        setDraft(raw);
        const parsed = parseNumberDraft(raw, { integer });
        // 완전한 숫자일 때만 즉시 반영 (미리보기용). "-", "2." 등은 draft만 유지.
        if (parsed == null) return;
        if (raw.endsWith('.')) return;
        const next = commitNumberValue(raw, { min, max, free, integer });
        if (next != null) onChange(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitDraft(draft);
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(String(value ?? ''));
          e.currentTarget.blur();
        }
      }}
    />
  );
}

NumberField.propTypes = {
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  onChange: PropTypes.func.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  step: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  free: PropTypes.bool,
  integer: PropTypes.bool,
  allowNegative: PropTypes.bool,
};

export default function FormationGridModal({
  open,
  onClose,
  drones: dronesProp,
  onConfirm,
  mode = 'create',
  title,
  initialLattice = null,
  previousDrones = null,
  previousLabel = '',
  minSeparation = 1.45,
}) {
  const isEdit = mode === 'edit';
  const viewRef = useRef(null);
  const paintRef = useRef(null);
  /** 뷰 드래그 회전: { startX, startYaw } */
  const orbitRef = useRef(null);
  /** 휠 버튼 드래그 이동: { startX, startY, startPan } */
  const panRef = useRef(null);
  /** 가장자리 드래그로 격자 크기 조절: { handle, start, nx, ny, az, unproject } */
  const resizeRef = useRef(null);
  const yawRef = useRef(35);
  /**
   * 이 모달에서 마지막으로 쓴 격자(개수·간격·기준점). 새 phase를 연달아
   * 만들 때 기본값으로 되돌아가지 않고 직전 설정을 그대로 이어 쓴다.
   */
  const lastLatticeRef = useRef(null);
  /**
   * id -> {x,y,z} : 모달을 열었을 때의 좌표(= 이전 상태). 격자에 올리지 않은
   * 드론은 이 좌표를 그대로 유지하고, 확정할 때도 이 값이 그대로 나간다.
   */
  const homePosRef = useRef({});
  const placementRef = useRef({
    drones: [],
    occupancy: {},
    freePos: {},
    homeDrones: [],
    selectedId: null,
  });
  const [drones, setDrones] = useState([]);
  const [homeDrones, setHomeDrones] = useState([]);
  /** key -> droneId : 격자에 바로 배치된 드론 */
  const [occupancy, setOccupancy] = useState({});
  /**
   * droneId -> {x, y, z} : 이미지/3D 모델을 평면에 쏴서 놓은 드론.
   * 격자 슬롯이 아니라 연속 좌표라 occupancy와 따로 관리한다.
   */
  const [freePos, setFreePos] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [nx, setNx] = useState(DEFAULT_LATTICE.nx);
  const [ny, setNy] = useState(DEFAULT_LATTICE.ny);
  const [nz, setNz] = useState(DEFAULT_LATTICE.nz);
  const [sx, setSx] = useState(DEFAULT_LATTICE.sx);
  const [sy, setSy] = useState(DEFAULT_LATTICE.sy);
  const [sz, setSz] = useState(DEFAULT_LATTICE.sz);
  const [ax, setAx] = useState(DEFAULT_LATTICE.ax);
  const [ay, setAy] = useState(DEFAULT_LATTICE.ay);
  const [az, setAz] = useState(DEFAULT_LATTICE.az);
  const [layer, setLayer] = useState(0);
  const [allLayers, setAllLayers] = useState(false);
  const [laxis, setLaxis] = useState('z');
  /**
   * 채우기 순서: 작업 평면의 방향 토큰을 최대 2개 담는다 (예: ['x+', 'y-']).
   * 첫 번째가 가장 빨리 증가하는 축(1번), 두 번째가 그다음(2번). 비워 두면
   * 평면 축을 오름차순으로 자동 사용한다.
   */
  const [fillDirs, setFillDirs] = useState([]);
  /** 일괄 기입용 yaw 값 (뷰 회전 yaw와 무관 — 드론 헤딩) */
  const [bulkYaw, setBulkYaw] = useState(0);
  const [yaw, setYaw] = useState(35);
  const [zoom, setZoom] = useState(1);
  /** 휠 버튼 드래그로 옮기는 화면 이동량 (px) */
  const [pan, setPan] = useState(ZERO_PAN);
  /**
   * 격자 크기 조절 중에는 자동 맞춤(fit)을 얼려 둔다. 얼리지 않으면 간격을
   * 늘리는 순간 뷰가 다시 맞춰지면서 잡은 가장자리가 커서에서 도망간다.
   */
  const [fitFreeze, setFitFreeze] = useState(null);
  const [view, setView] = useState({ w: 900, h: 560 });
  const [guide, setGuide] = useState(true);
  const [orbiting, setOrbiting] = useState(false);
  /** 이미지/3D 모델 → 평면 배치 모달 */
  const [imagePlaneOpen, setImagePlaneOpen] = useState(false);
  const [, setPaintTick] = useState(0);

  useEffect(() => {
    placementRef.current = { drones, occupancy, freePos, homeDrones, selectedId };
  }, [drones, occupancy, freePos, homeDrones, selectedId]);

  useEffect(() => {
    yawRef.current = yaw;
  }, [yaw]);

  useEffect(() => {
    if (!open) return;
    const seeded =
      Array.isArray(dronesProp) && dronesProp.length
        ? dronesProp.map((d, i) => ({
            id: String(d.id),
            x: Number(d.x) || 0,
            y: Number(d.y) || 0,
            z: Number(d.z) || 0,
            yaw: Number.isFinite(Number(d.yaw)) ? Number(d.yaw) : 0,
            fromPhase: !!d.fromPhase,
            label: shortLabel(d.id, i),
          }))
        : makeFallbackDrones(16).map((d, i) => ({ ...d, label: shortLabel(d.id, i) }));
    setSelectedId(null);

    // 편집: 저장된 격자를 우선 복원. 없으면 phase에 속한 드론 좌표만으로 추론
    // (대기/홈 위치 드론이 섞이면 격자가 깨져 빈 화면처럼 보임)
    // 새 phase: 직전에 쓴 격자를 이어서 쓴다 — 세션 중 마지막으로 다룬 격자가
    // 우선이고, 없으면 마지막으로 그리드를 쓴 phase의 격자(initialLattice).
    let lattice = DEFAULT_LATTICE;
    let occ = {};
    if (!isEdit) {
      lattice =
        normalizeLattice(lastLatticeRef.current) ??
        normalizeLattice(initialLattice) ??
        DEFAULT_LATTICE;
    } else {
      const saved = normalizeLattice(initialLattice);
      const phaseDrones = seeded.filter((d) => d.fromPhase);
      const inferSource = phaseDrones.length ? phaseDrones : seeded;
      if (saved) {
        lattice = saved;
        occ = matchOccupancyToLattice(inferSource, saved);
      } else {
        const inferred = inferLatticeFromPositions(inferSource);
        if (inferred) {
          lattice = {
            nx: inferred.nx,
            ny: inferred.ny,
            nz: inferred.nz,
            sx: inferred.sx,
            sy: inferred.sy,
            sz: inferred.sz,
            ax: inferred.ax,
            ay: inferred.ay,
            az: inferred.az,
          };
          occ = inferred.occupancy || {};
        }
      }
    }
    const homePos = {};
    seeded.forEach((d) => {
      homePos[d.id] = { x: d.x, y: d.y, z: d.z };
    });
    homePosRef.current = homePos;
    const laidOut = relayoutDrones(seeded, occ, lattice, homePos, {});

    setNx(lattice.nx);
    setNy(lattice.ny);
    setNz(lattice.nz);
    setSx(lattice.sx);
    setSy(lattice.sy);
    setSz(lattice.sz);
    setAx(lattice.ax);
    setAy(lattice.ay);
    setAz(lattice.az);
    setOccupancy(occ);
    setFreePos({});
    setDrones(laidOut);
    setHomeDrones(laidOut.map((d) => ({ ...d })));
    setLayer(0);
    setAllLayers(false);
    setLaxis('z');
    setFillDirs([]);
    setYaw(35);
    setZoom(1);
    setPan(ZERO_PAN);
    setGuide(!isEdit);
    setImagePlaneOpen(false);
    paintRef.current = null;
    // dronesProp / mode / initialLattice는 open 시점에만 시드
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- seed on open only

  // 작업 평면이 바뀌면 이전 평면의 방향(1번·2번) 선택은 더 이상 유효하지 않다
  useEffect(() => {
    setFillDirs([]);
  }, [laxis]);

  // 열려 있는 동안의 격자 설정을 기억해 둔다 (닫아도 ref에 남아 다음 phase의
  // 시드가 된다). 위 시드 효과보다 뒤에 있어야 시드된 값이 기록된다.
  useEffect(() => {
    if (!open) return;
    lastLatticeRef.current = { nx, ny, nz, sx, sy, sz, ax, ay, az };
  }, [open, nx, ny, nz, sx, sy, sz, ax, ay, az]);

  /**
   * 가장자리/꼭짓점 드래그 → 반대쪽 변을 고정한 채 간격(과 필요하면 기준점)을
   * 다시 계산한다. 드래그 시작 때 얼려 둔 투영을 쓰므로 잡은 지점이 커서를
   * 그대로 따라온다.
   */
  const applyResize = useCallback((event) => {
    const state = resizeRef.current;
    const el = viewRef.current;
    if (!state || !el) return;

    const rect = el.getBoundingClientRect();
    const world = state.unproject(
      event.clientX - rect.left,
      event.clientY - rect.top,
      state.az
    );
    if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return;

    const { handle, start, offset } = state;
    const round1 = (v) => Math.round(v * 10) / 10;
    const targetX = world.x - offset.x;
    const targetY = world.y - offset.y;
    let { x0, y0, x1, y1 } = start;

    if (handle.includes('x1')) x1 = targetX;
    else if (handle.includes('x0')) x0 = targetX;
    if (handle.includes('y1')) y1 = targetY;
    else if (handle.includes('y0')) y0 = targetY;

    if (handle.includes('x0') || handle.includes('x1')) {
      if (state.nx > 1) {
        setSx(
          clamp(round1(Math.abs(x1 - x0) / (state.nx - 1)), MIN_SPACING, MAX_SPACING)
        );
        setAx(round1(Math.min(x0, x1)));
      } else {
        setAx(round1(targetX));
      }
    }

    if (handle.includes('y0') || handle.includes('y1')) {
      if (state.ny > 1) {
        setSy(
          clamp(round1(Math.abs(y1 - y0) / (state.ny - 1)), MIN_SPACING, MAX_SPACING)
        );
        setAy(round1(Math.min(y0, y1)));
      } else {
        setAy(round1(targetY));
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const el = viewRef.current;
    let ro;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        const r = el.getBoundingClientRect();
        setView({ w: r.width, h: r.height });
      });
      ro.observe(el);
      const r = el.getBoundingClientRect();
      setView({ w: r.width, h: r.height });
    }
    const wrapYaw = (v) => {
      let n = Math.round(v) % 360;
      if (n < 0) n += 360;
      return n;
    };
    const endOrbit = () => {
      if (!orbitRef.current) return;
      orbitRef.current = null;
      setOrbiting(false);
    };
    const onMove = (e) => {
      if (resizeRef.current) {
        applyResize(e);
        return;
      }

      if (panRef.current) {
        const { startX, startY, startPan } = panRef.current;
        setPan({
          x: startPan.x + (e.clientX - startX),
          y: startPan.y + (e.clientY - startY),
        });
        return;
      }

      if (!orbitRef.current) return;
      const dx = e.clientX - orbitRef.current.startX;
      setYaw(wrapYaw(orbitRef.current.startYaw + dx * 0.45));
    };
    const onUp = () => {
      if (paintRef.current !== null) {
        paintRef.current = null;
        setPaintTick((t) => t + 1);
      }
      if (resizeRef.current) {
        resizeRef.current = null;
        // 드래그가 끝나면 다시 자동 맞춤 (커진 격자에 맞게 화면을 다시 잡는다)
        setFitFreeze(null);
      }
      panRef.current = null;
      endOrbit();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // 위에 뜬 평면 배치 모달이 자기 Escape를 처리한다.
        if (imagePlaneOpen) return;
        if (guide) setGuide(false);
        else onClose();
      }
    };
    const onWheel = (e) => {
      e.preventDefault();
      const step = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((z) => clamp(Math.round((z + step) * 10) / 10, 0.5, 2.4));
    };
    const onContextMenu = (e) => {
      // 우클릭 회전과 충돌하지 않도록 뷰 안에서는 컨텍스트 메뉴 막음
      e.preventDefault();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    if (el) {
      el.addEventListener('wheel', onWheel, { passive: false });
      el.addEventListener('contextmenu', onContextMenu);
    }
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      if (el) {
        el.removeEventListener('wheel', onWheel);
        el.removeEventListener('contextmenu', onContextMenu);
      }
      orbitRef.current = null;
      panRef.current = null;
      resizeRef.current = null;
    };
  }, [open, guide, imagePlaneOpen, onClose, applyResize]);

  const beginOrbit = useCallback((clientX) => {
    orbitRef.current = { startX: clientX, startYaw: yawRef.current };
    setOrbiting(true);
    paintRef.current = null;
  }, []);

  const isViewBackgroundTarget = (target, currentTarget) => {
    if (!target || !currentTarget) return false;
    if (target === currentTarget) return true;
    const tag = String(target.tagName || '').toLowerCase();
    return (
      tag === 'svg' ||
      tag === 'line' ||
      tag === 'polygon' ||
      tag === 'path' ||
      tag === 'text' ||
      tag === 'circle'
    );
  };

  const handleViewMouseDown = useCallback(
    (e) => {
      if (guide) return;
      // 휠 버튼: 화면 이동(팬) / 우클릭: 어디서든 회전 /
      // 좌클릭: 빈 배경에서만 회전 (슬롯 배치와 분리)
      if (e.button === 1) {
        e.preventDefault();
        panRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startPan: pan,
        };
        return;
      }
      if (e.button === 2) {
        e.preventDefault();
        beginOrbit(e.clientX);
        return;
      }
      if (e.button === 0 && isViewBackgroundTarget(e.target, e.currentTarget)) {
        e.preventDefault();
        beginOrbit(e.clientX);
      }
    },
    [guide, beginOrbit, pan]
  );

  const nodePos = useCallback(
    (i, j, k) => latticeSlotPos(i, j, k, { ax, ay, az, sx, sy, sz }),
    [ax, ay, az, sx, sy, sz]
  );

  // spacing / anchor / lattice·occupancy 가 바뀌면 배치 드론만 슬롯으로 다시
  // 옮긴다 (대기 드론은 이전 상태 그대로).
  useEffect(() => {
    if (!open) return;
    const lattice = { ax, ay, az, nx, ny, nz, sx, sy, sz };
    const nextOcc = {};
    Object.entries(occupancy).forEach(([key, droneId]) => {
      if (slotWorldPos(key, lattice)) nextOcc[key] = droneId;
    });
    const occChanged =
      Object.keys(nextOcc).length !== Object.keys(occupancy).length ||
      Object.keys(occupancy).some((k) => nextOcc[k] !== occupancy[k]);

    setDrones((prev) => {
      const next = relayoutDrones(
        prev,
        nextOcc,
        lattice,
        homePosRef.current,
        placementRef.current.freePos
      );
      const changed = next.some(
        (d, i) => d.x !== prev[i]?.x || d.y !== prev[i]?.y || d.z !== prev[i]?.z
      );
      if (changed || occChanged) {
        placementRef.current = {
          ...placementRef.current,
          drones: next,
          occupancy: occChanged ? nextOcc : placementRef.current.occupancy,
        };
      }
      return changed ? next : prev;
    });

    if (occChanged) setOccupancy(nextOcc);
  }, [open, sx, sy, sz, ax, ay, az, nx, ny, nz, occupancy]);

  const axIndex = laxis === 'x' ? 0 : laxis === 'y' ? 1 : 2;
  const axCount = laxis === 'x' ? nx : laxis === 'y' ? ny : nz;
  const axValue = useCallback(
    (idx) => {
      if (laxis === 'x') return ax + idx * sx;
      if (laxis === 'y') return ay + idx * sy;
      return az + idx * sz;
    },
    [laxis, ax, ay, az, sx, sy, sz]
  );

  // 투영·회전은 항상 월드 원점(0,0,0) 기준.
  // 3D 뷰와 동일하게 +Y가 화면 오른쪽, +X가 왼쪽·아래, +Z가 위.
  const raw = useCallback((x, y, z) => isoRaw(x, y, z, yaw), [yaw]);

  const autoFit = useMemo(() => {
    // 월드 원점 + 격자를 함께 맞춤 → 축(0,0,0)이 보이면서 격자는 기준점 오프셋만큼 떨어짐
    const pts = [{ x: 0, y: 0, z: 0 }];
    for (const k of [0, nz - 1]) {
      for (const j of [0, ny - 1]) {
        for (const i of [0, nx - 1]) pts.push(nodePos(i, j, k));
      }
    }
    const pad = Math.max(sx, sy) * 0.6;
    const x0 = ax - pad;
    const x1 = ax + Math.max(0, nx - 1) * sx + pad;
    const y0 = ay - pad;
    const y1 = ay + Math.max(0, ny - 1) * sy + pad;
    for (const x of [x0, x1]) {
      for (const y of [y0, y1]) {
        pts.push({ x, y, z: 0 });
      }
    }

    return fitIsoView({
      points: pts,
      yaw,
      zoom,
      width: view.w,
      height: view.h,
      pan,
    });
  }, [nx, ny, nz, sx, sy, ax, ay, yaw, nodePos, view, zoom, pan]);

  // 크기 조절 중에는 드래그 시작 시점의 맞춤을 그대로 쓴다 (위 fitFreeze 주석)
  const fit = fitFreeze ?? autoFit;
  const resizing = Boolean(fitFreeze);

  const proj = useCallback(
    (x, y, z) => {
      const r = raw(x, y, z);
      return { px: fit.ox + r.u * fit.s, py: fit.oy + r.v * fit.s, depth: r.depth };
    },
    [raw, fit]
  );

  /**
   * proj의 역변환 — 화면 좌표를 "z가 주어진 수평면" 위의 월드 좌표로 되돌린다.
   * (u, v)는 (x, y)에 대해 선형이고 행렬식이 -cos30으로 항상 0이 아니라 안정적.
   */
  const unprojectOnZ = useCallback(
    (px, py, z) =>
      isoInverseOnZ((px - fit.ox) / fit.s, (py - fit.oy) / fit.s, z, yaw),
    [fit, yaw]
  );

  /**
   * 격자의 XY 바닥 테두리 + 크기 조절 손잡이. 가장자리를 끌면 그 축의 간격이,
   * 꼭짓점을 끌면 두 축의 간격이 함께 바뀐다 (반대쪽 변은 제자리에 고정).
   */
  const resizeFrame = useMemo(() => {
    const x0 = ax;
    const x1 = ax + Math.max(0, nx - 1) * sx;
    const y0 = ay;
    const y1 = ay + Math.max(0, ny - 1) * sy;
    // 손잡이는 격자 밖으로 조금 밀어 둔다 — 꼭짓점 슬롯 클릭을 가리지 않게.
    const mx = sx * 0.3;
    const my = sy * 0.3;
    const c00 = proj(x0 - mx, y0 - my, az);
    const c10 = proj(x1 + mx, y0 - my, az);
    const c11 = proj(x1 + mx, y1 + my, az);
    const c01 = proj(x0 - mx, y1 + my, az);
    const mid = (a, b) => ({ px: (a.px + b.px) / 2, py: (a.py + b.py) / 2 });

    return {
      world: { x0, y0, x1, y1 },
      polygon: [c00, c10, c11, c01]
        .map((p) => `${p.px.toFixed(1)},${p.py.toFixed(1)}`)
        .join(' '),
      handles: [
        { id: 'x0y0', corner: true, ...c00 },
        { id: 'x1y0', corner: true, ...c10 },
        { id: 'x1y1', corner: true, ...c11 },
        { id: 'x0y1', corner: true, ...c01 },
        { id: 'x0', axisLabel: 'X', ...mid(c00, c01) },
        { id: 'x1', axisLabel: 'X', ...mid(c10, c11) },
        { id: 'y0', axisLabel: 'Y', ...mid(c00, c10) },
        { id: 'y1', axisLabel: 'Y', ...mid(c01, c11) },
      ],
    };
  }, [ax, ay, az, nx, ny, sx, sy, proj]);

  const beginResize = useCallback(
    (handleId) => (e) => {
      if (guide || e.button !== 0) return;
      const el = viewRef.current;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();

      // 잡은 지점과 실제 변 사이의 차이를 기억해 두면 손잡이를 격자 밖에
      // 그려도 드래그가 커서를 정확히 따라온다.
      const rect = el.getBoundingClientRect();
      const grab = unprojectOnZ(e.clientX - rect.left, e.clientY - rect.top, az);
      const world = resizeFrame.world;
      const offset = {
        x: handleId.includes('x1')
          ? grab.x - world.x1
          : handleId.includes('x0')
            ? grab.x - world.x0
            : 0,
        y: handleId.includes('y1')
          ? grab.y - world.y1
          : handleId.includes('y0')
            ? grab.y - world.y0
            : 0,
      };

      resizeRef.current = {
        handle: handleId,
        start: world,
        offset,
        nx,
        ny,
        az,
        unproject: unprojectOnZ,
      };
      setFitFreeze(autoFit);
    },
    [autoFit, az, guide, nx, ny, resizeFrame, unprojectOnZ]
  );

  const planeGeom = useMemo(() => {
    const P = (i, j, k) => nodePos(i, j, k);
    if (laxis === 'z') return { A: nx, B: ny, mk: (a, b) => P(a, b, layer) };
    if (laxis === 'y') return { A: nx, B: nz, mk: (a, b) => P(a, layer, b) };
    return { A: ny, B: nz, mk: (a, b) => P(layer, a, b) };
  }, [laxis, nx, ny, nz, layer, nodePos]);

  const occupiedCount = Object.keys(occupancy).length;
  const freeDroneIds = useMemo(() => new Set(Object.keys(freePos)), [freePos]);
  /** 격자 슬롯이든 평면이든 어딘가에 올라간 드론 (= 대기가 아닌 드론) */
  const placedDroneIds = useMemo(
    () => new Set([...Object.values(occupancy), ...freeDroneIds]),
    [occupancy, freeDroneIds]
  );
  const idleDrones = useMemo(
    () =>
      drones
        .filter((d) => !placedDroneIds.has(d.id))
        .slice()
        .sort((a, b) => compareDroneId(a.id, b.id)),
    [drones, placedDroneIds]
  );

  /**
   * 평면 배치의 기본 위치 — 대형(열었을 때 좌표) 최북단 + 10 m. 그림 평면이
   * 이륙 지역을 관통하면 드론들이 차오르는 벽을 가로질러야 해서 진입 계획이
   * 교착되기 쉽다.
   */
  const suggestedPlaneX = useMemo(() => {
    let maxX = 0;
    for (const pos of Object.values(homePosRef.current || {})) {
      const x = Number(pos?.x);
      if (Number.isFinite(x) && x > maxX) maxX = x;
    }
    return maxX + 10;
  }, [homeDrones]); // eslint-disable-line react-hooks/exhaustive-deps -- homePosRef는 homeDrones와 함께 시드된다

  const commitPlacement = useCallback((next) => {
    if (!next) return;
    const nextFree =
      next.freePos !== undefined ? next.freePos : placementRef.current.freePos;
    placementRef.current = {
      ...placementRef.current,
      drones: next.drones,
      occupancy: next.occupancy,
      freePos: nextFree,
      selectedId: next.selectedId !== undefined ? next.selectedId : placementRef.current.selectedId,
    };
    setDrones(next.drones);
    setOccupancy(next.occupancy);
    if (next.freePos !== undefined) setFreePos(next.freePos);
    if (next.selectedId !== undefined) setSelectedId(next.selectedId);
  }, []);

  const latticeParams = useCallback(
    () => ({ ax, ay, az, nx, ny, nz, sx, sy, sz }),
    [ax, ay, az, nx, ny, nz, sx, sy, sz]
  );

  const placeAtKey = useCallback(
    (key, preferredId) => {
      const {
        drones: prevDrones,
        occupancy: prevOcc,
        freePos: prevFree,
      } = placementRef.current;
      if (prevOcc[key]) return null;
      const lattice = latticeParams();
      const pos = slotWorldPos(key, lattice);
      if (!pos) return null;
      const used = new Set(Object.values(prevOcc));
      let droneId = preferredId && !used.has(preferredId) ? preferredId : null;
      // 선택 없이 배치할 때는 대기 스택 순서(id 정렬)대로 꺼냄. 평면에 쏜
      // 드론은 대기가 아니므로 층 채우기가 그림을 갉아먹지 않는다.
      if (!droneId) {
        const idleIds = prevDrones
          .map((d) => d.id)
          .filter((id) => !used.has(id) && !prevFree?.[id])
          .sort(compareDroneId);
        droneId = idleIds[0] || null;
      }
      if (!droneId) return null;

      const nextOcc = { ...prevOcc };
      for (const [slot, id] of Object.entries(nextOcc)) {
        if (id === droneId) delete nextOcc[slot];
      }
      nextOcc[key] = droneId;
      // 슬롯에 올린 드론은 평면 배치에서 빠진다 — 두 자리를 동시에 차지할 수 없다.
      let nextFree = prevFree;
      if (prevFree?.[droneId]) {
        nextFree = { ...prevFree };
        delete nextFree[droneId];
      }
      const nextDrones = relayoutDrones(
        prevDrones,
        nextOcc,
        lattice,
        homePosRef.current,
        nextFree
      );
      return {
        drones: nextDrones,
        occupancy: nextOcc,
        freePos: nextFree,
        selectedId: null,
      };
    },
    [latticeParams]
  );

  const releaseAtKey = useCallback(
    (key) => {
      const { drones: prevDrones, occupancy: prevOcc } = placementRef.current;
      if (!prevOcc[key]) return null;
      const nextOcc = { ...prevOcc };
      delete nextOcc[key];
      const nextDrones = relayoutDrones(
        prevDrones,
        nextOcc,
        latticeParams(),
        homePosRef.current,
        placementRef.current.freePos
      );
      return { drones: nextDrones, occupancy: nextOcc };
    },
    [latticeParams]
  );

  const handleNodeDown = useCallback(
    (key, live) => (e) => {
      if (!live) return;
      e.preventDefault();
      e.stopPropagation();
      const { occupancy: prevOcc, selectedId: sel } = placementRef.current;
      if (prevOcc[key]) {
        paintRef.current = false;
        commitPlacement(releaseAtKey(key));
        return;
      }
      const next = placeAtKey(key, sel);
      paintRef.current = !!next;
      if (next) commitPlacement(next);
    },
    [commitPlacement, placeAtKey, releaseAtKey]
  );

  const handleNodeEnter = useCallback(
    (key, live) => () => {
      if (!live || paintRef.current === null) return;
      const { occupancy: prevOcc } = placementRef.current;
      if (paintRef.current) {
        if (prevOcc[key]) return;
        const next = placeAtKey(key, null);
        if (next) commitPlacement(next);
      } else if (prevOcc[key]) {
        commitPlacement(releaseAtKey(key));
      }
    },
    [commitPlacement, placeAtKey, releaseAtKey]
  );

  const handleDroneClick = useCallback(
    (droneId) => (e) => {
      e.preventDefault();
      e.stopPropagation();
      const { selectedId: sel, occupancy: prevOcc } = placementRef.current;
      // 이미 선택된 드론을 다시 클릭하면 선택 해제
      if (sel === droneId) {
        setSelectedId(null);
        placementRef.current.selectedId = null;
        return;
      }
      // 배치된 드론을 클릭하면 그 자리에서 해제(대기 위치)
      const slot = Object.entries(prevOcc).find(([, id]) => id === droneId)?.[0];
      if (slot) {
        paintRef.current = false;
        commitPlacement(releaseAtKey(slot));
        return;
      }
      // 대기 드론 클릭 → 선택 후 격자 클릭으로 바로 배치
      setSelectedId(droneId);
      placementRef.current.selectedId = droneId;
    },
    [commitPlacement, releaseAtKey]
  );

  /**
   * 채우기 진행 축 순서 — 빠른 축부터 [1번, 2번, 법선축]. 고르지 않은 축은
   * 평면 축 순서대로 오름차순 자동 배정된다.
   */
  const fillAxisOrder = useMemo(
    // 법선축은 층을 훑는 순서 (전체 층 채우기일 때만 의미가 있다)
    () => resolveAxisOrder(fillDirs, [...PLANE_AXES[laxis], laxis]),
    [fillDirs, laxis]
  );

  const fillLayer = () => {
    let { drones: d, occupancy: occ } = placementRef.current;
    const counts = { x: nx, y: ny, z: nz };
    const indices = (entry) => axisIndices(entry, counts[entry.axis]);

    const [fast, mid, slow] = fillAxisOrder;
    const slot = { x: 0, y: 0, z: 0 };

    for (const slowIdx of indices(slow)) {
      slot[slow.axis] = slowIdx;
      for (const midIdx of indices(mid)) {
        slot[mid.axis] = midIdx;
        for (const fastIdx of indices(fast)) {
          slot[fast.axis] = fastIdx;
          const { x: i, y: j, z: k } = slot;
          if (!allLayers && [i, j, k][axIndex] !== layer) continue;
          const key = nodeKey(i, j, k);
          if (occ[key]) continue;
          placementRef.current = { ...placementRef.current, drones: d, occupancy: occ };
          const next = placeAtKey(key, null);
          if (!next) {
            commitPlacement({ drones: d, occupancy: occ });
            return;
          }
          d = next.drones;
          occ = next.occupancy;
        }
      }
    }
    commitPlacement({ drones: d, occupancy: occ, selectedId: null });
  };

  const clearAll = () => {
    const { drones: prevDrones } = placementRef.current;
    commitPlacement({
      drones: relayoutDrones(prevDrones, {}, latticeParams(), homePosRef.current, {}),
      occupancy: {},
      freePos: {},
      selectedId: null,
    });
  };

  /**
   * 이미지/3D 모델을 평면에 쏜 결과를 배치에 얹는다.
   *
   * 격자 슬롯에 스냅하지 않고 계산된 연속 좌표를 그대로 쓴다 — 그림의 형상이
   * 격자 해상도에 갇히지 않아야 하기 때문이다. 격자에 올라가 있던 드론이
   * 그림에 포함되면 그 슬롯은 비운다.
   */
  const handlePlaceImagePoints = useCallback(
    (points) => {
      if (!points || typeof points !== 'object') return;
      const {
        drones: prevDrones,
        occupancy: prevOcc,
        freePos: prevFree,
      } = placementRef.current;
      const nextFree = { ...prevFree };
      const nextOcc = { ...prevOcc };
      let added = 0;
      for (const [droneId, pos] of Object.entries(points)) {
        const id = String(droneId);
        const x = Number(pos?.x);
        const y = Number(pos?.y);
        const z = Number(pos?.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        nextFree[id] = { x, y, z };
        added += 1;
        for (const [slot, occupant] of Object.entries(nextOcc)) {
          if (occupant === id) delete nextOcc[slot];
        }
      }
      if (!added) return;
      commitPlacement({
        drones: relayoutDrones(
          prevDrones,
          nextOcc,
          latticeParams(),
          homePosRef.current,
          nextFree
        ),
        occupancy: nextOcc,
        freePos: nextFree,
        selectedId: null,
      });
    },
    [commitPlacement, latticeParams]
  );

  /** 평면에 쏜 드론을 전부 대기로 되돌린다 (격자 배치는 그대로) */
  const clearImagePlacement = useCallback(() => {
    const { drones: prevDrones, occupancy: prevOcc } = placementRef.current;
    commitPlacement({
      drones: relayoutDrones(
        prevDrones,
        prevOcc,
        latticeParams(),
        homePosRef.current,
        {}
      ),
      occupancy: prevOcc,
      freePos: {},
      selectedId: null,
    });
  }, [commitPlacement, latticeParams]);

  /** 보유한 모든 드론(대기 포함)에 같은 yaw를 일괄 기입 */
  const applyYawToAll = (value) => {
    const { drones: cur, occupancy: occ } = placementRef.current;
    commitPlacement({
      drones: cur.map((d) => ({ ...d, yaw: value })),
      occupancy: occ,
    });
  };

  /** 선택된 드론 한 대만 yaw를 덮어씀 */
  const setSelectedDroneYaw = (value) => {
    const { drones: cur, occupancy: occ, selectedId: sel } = placementRef.current;
    if (!sel) return;
    commitPlacement({
      drones: cur.map((d) => (d.id === sel ? { ...d, yaw: value } : d)),
      occupancy: occ,
    });
  };

  const handleConfirm = () => {
    const points = {};
    const gridDroneIds = [];
    const { drones: cur, occupancy: occ, freePos: free } = placementRef.current;
    const placed = new Set(Object.values(occ));
    if (!placed.size && !Object.keys(free || {}).length) return;
    // 격자에 올린 드론은 슬롯 좌표로, 평면에 쏜 드론은 그 좌표로, 나머지는
    // 열었을 때의 좌표(이전 상태) 그대로 내보낸다 — 건드리지 않은 드론은
    // phase에서도 그대로 유지된다. gridDroneIds에는 격자 소속만 담는다:
    // 평면 배치는 슬롯이 아니라서 다시 열 때 스냅되면 안 된다.
    cur.forEach((d) => {
      points[d.id] = {
        x: Math.round(d.x * 10000) / 10000,
        y: Math.round(d.y * 10000) / 10000,
        z: Math.round(d.z * 10000) / 10000,
        yaw: Number.isFinite(Number(d.yaw)) ? Number(d.yaw) : 0,
      };
      if (placed.has(d.id)) gridDroneIds.push(d.id);
    });
    const lattice = {
      nx,
      ny,
      nz,
      sx: round3(sx),
      sy: round3(sy),
      sz: round3(sz),
      ax: round3(ax),
      ay: round3(ay),
      az: round3(az),
    };
    onConfirm?.(points, lattice, gridDroneIds);
    onClose();
  };

  const droneById = useMemo(() => {
    const map = {};
    drones.forEach((d) => {
      map[d.id] = d;
    });
    return map;
  }, [drones]);

  /**
   * 이전 phase(편집 시엔 바로 앞 phase, 없으면 드론의 현재 위치)의 좌표를
   * 회색 점으로 깔아 두는 참고 레이어. 클릭 대상이 아니라 "여기서 어디로
   * 옮기는지"만 보여준다.
   */
  const ghostDots = useMemo(() => {
    if (!Array.isArray(previousDrones) || !previousDrones.length) {
      return [];
    }

    return previousDrones
      .map((d, idx) => {
        const id = String(d?.id ?? '');
        const x = Number(d?.x);
        const y = Number(d?.y);
        const z = Number(d?.z);
        if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          return null;
        }

        const s = proj(x, y, z);
        return {
          key: id,
          label: shortLabel(id, idx),
          px: s.px,
          py: s.py,
          title: `${id} · 이전 위치 x ${x.toFixed(1)}  y ${y.toFixed(1)}  z ${z.toFixed(1)}`,
        };
      })
      .filter(Boolean);
  }, [previousDrones, proj]);

  const scene = useMemo(() => {
    const plate = [];
    const pad = Math.max(sx, sy) * 0.6;
    const x0 = ax - pad;
    const x1 = ax + Math.max(0, nx - 1) * sx + pad;
    const y0 = ay - pad;
    const y1 = ay + Math.max(0, ny - 1) * sy + pad;
    for (let i = 0; i <= nx; i += 1) {
      const x = x0 + (i / nx) * (x1 - x0);
      const a = proj(x, y0, 0);
      const b = proj(x, y1, 0);
      plate.push({ x1: a.px, y1: a.py, x2: b.px, y2: b.py, key: `px${i}` });
    }
    for (let j = 0; j <= ny; j += 1) {
      const y = y0 + (j / ny) * (y1 - y0);
      const a = proj(x0, y, 0);
      const b = proj(x1, y, 0);
      plate.push({ x1: a.px, y1: a.py, x2: b.px, y2: b.py, key: `py${j}` });
    }

    let planePoly = '';
    const planeLines = [];
    if (!allLayers) {
      const g = planeGeom;
      const m = 0.6;
      const corners = [
        [-m, -m],
        [g.A - 1 + m, -m],
        [g.A - 1 + m, g.B - 1 + m],
        [-m, g.B - 1 + m],
      ].map(([a, b]) => {
        const p = g.mk(a, b);
        const s = proj(p.x, p.y, p.z);
        return `${s.px.toFixed(1)},${s.py.toFixed(1)}`;
      });
      planePoly = corners.join(' ');
      for (let a = 0; a < g.A; a += 1) {
        const p1 = g.mk(a, -m);
        const p2 = g.mk(a, g.B - 1 + m);
        const s1 = proj(p1.x, p1.y, p1.z);
        const s2 = proj(p2.x, p2.y, p2.z);
        planeLines.push({ x1: s1.px, y1: s1.py, x2: s2.px, y2: s2.py, key: `pla${a}` });
      }
      for (let b = 0; b < g.B; b += 1) {
        const p1 = g.mk(-m, b);
        const p2 = g.mk(g.A - 1 + m, b);
        const s1 = proj(p1.x, p1.y, p1.z);
        const s2 = proj(p2.x, p2.y, p2.z);
        planeLines.push({ x1: s1.px, y1: s1.py, x2: s2.px, y2: s2.py, key: `plb${b}` });
      }
    }

    const posts = [];
    const droneOnLayer = {};
    Object.entries(occupancy).forEach(([key, droneId]) => {
      const { i, j, k } = parseNodeKey(key);
      const onLayer = allLayers || [i, j, k][axIndex] === layer;
      if (droneId != null) droneOnLayer[droneId] = onLayer;
      const p = nodePos(i, j, k);
      const top = proj(p.x, p.y, p.z);
      const ground = proj(p.x, p.y, 0);
      posts.push({
        x1: top.px,
        y1: top.py,
        x2: ground.px,
        y2: ground.py,
        key: `post${key}`,
        onLayer,
      });
    });

    // 빈 슬롯을 눌러도 꺼낼 드론이 없으면(대기 0) 클릭을 막는다 — 평면에 쏜
    // 드론은 대기가 아니므로 여기서도 빠진다.
    const atCap = idleDrones.length === 0;
    const nodes = [];
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const key = nodeKey(i, j, k);
          const p = nodePos(i, j, k);
          const s = proj(p.x, p.y, p.z);
          const droneId = occupancy[key];
          const on = !!droneId;
          const onLayer = allLayers || [i, j, k][axIndex] === layer;
          const live = onLayer && (on || !atCap || !!selectedId);
          const drone = droneId ? droneById[droneId] : null;
          nodes.push({
            key,
            depth: s.depth,
            py: s.py,
            title: on
              ? `${drone?.label || droneId} · x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)}`
              : `빈 슬롯 · x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)}`,
            label: '',
            live,
            onLayer,
            on,
            px: s.px,
            sPy: s.py,
          });
        }
      }
    }
    nodes.sort((a, b) => a.depth - b.depth || a.py - b.py);

    const dots = drones.map((d, idx) => {
      const s = proj(d.x, d.y, d.z);
      const placed = placedDroneIds.has(d.id);
      const selected = selectedId === d.id;
      // 대기 드론은 배치 대상이라 유지, 배치된 드론은 활성 층만 강조
      const onLayer = !placed || allLayers || droneOnLayer[d.id] !== false;
      return {
        key: d.id,
        label: d.label || shortLabel(d.id, idx),
        title: freeDroneIds.has(d.id)
          ? `${d.id} · 평면 배치 (격자 슬롯 아님)`
          : placed
          ? `${d.id} · 클릭하면 이전 위치로 되돌림`
          : selected
            ? `${d.id} · 선택됨 — 격자 클릭으로 배치`
            : `${d.id} · 이전 위치 유지 — 클릭 후 격자 배치`,
        px: s.px,
        py: s.py,
        placed,
        selected,
        idle: !placed,
        onLayer,
      };
    });

    // 3D 뷰와 동일: 원점(0,0,0) 기준 +X/+Y/+Z 축 (항상 월드 원점에 고정)
    const spanX = Math.max(sx, (nx - 1) * sx);
    const spanY = Math.max(sy, (ny - 1) * sy);
    const axisLen = Math.max(2.5, Math.min(spanX, spanY) * 0.18, Math.max(sx, sy, sz) * 0.85);
    const origin = proj(0, 0, 0);
    const makeAxis = (key, tipWorld, color) => {
      const tip = proj(tipWorld.x, tipWorld.y, tipWorld.z);
      const dx = tip.px - origin.px;
      const dy = tip.py - origin.py;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;
      const ah = 6;
      const aw = 3;
      const bx = tip.px - ux * ah;
      const by = tip.py - uy * ah;
      return {
        key,
        color,
        label: key.toUpperCase(),
        x1: origin.px,
        y1: origin.py,
        x2: tip.px,
        y2: tip.py,
        arrow: `${tip.px.toFixed(1)},${tip.py.toFixed(1)} ${(bx + px * aw).toFixed(1)},${(
          by +
          py * aw
        ).toFixed(1)} ${(bx - px * aw).toFixed(1)},${(by - py * aw).toFixed(1)}`,
        lx: tip.px + ux * 8,
        ly: tip.py + uy * 8,
      };
    };
    const axes = [
      makeAxis('x', { x: axisLen, y: 0, z: 0 }, AXIS_COLORS.x),
      makeAxis('y', { x: 0, y: axisLen, z: 0 }, AXIS_COLORS.y),
      makeAxis('z', { x: 0, y: 0, z: axisLen }, AXIS_COLORS.z),
    ];

    return { plate, planePoly, planeLines, posts, nodes, dots, axes, origin };
  }, [
    nx,
    ny,
    nz,
    sx,
    sy,
    sz,
    ax,
    ay,
    allLayers,
    planeGeom,
    proj,
    occupancy,
    idleDrones,
    drones,
    droneById,
    placedDroneIds,
    selectedId,
    axIndex,
    layer,
    nodePos,
    freeDroneIds,
  ]);

  const layerRows = useMemo(() => {
    const rows = [];
    for (let k = 0; k < axCount; k += 1) {
      let c = 0;
      Object.keys(occupancy).forEach((key) => {
        if (parseInt(key.split('_')[axIndex], 10) === k) c += 1;
      });
      const sel = allLayers || k === layer;
      rows.push({
        key: `L${k}`,
        name: `L${k + 1}`,
        alt: `${laxis.toUpperCase()} ${axValue(k).toFixed(1)} m`,
        count: c,
        sel,
        index: k,
      });
    }
    return rows.reverse();
  }, [axCount, occupancy, axIndex, allLayers, layer, laxis, axValue]);

  if (!open) return null;

  return ReactDOM.createPortal(
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={panelStyle} role="dialog" aria-modal="true" aria-label="Formation Grid">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flex: '0 0 auto',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>
              {title || (isEdit ? '그리드 수정' : '그리드로 Phase 추가')}
            </div>
            <div style={{ fontSize: 12, opacity: 0.55, marginTop: 2 }}>
              {selectedId
                ? `드론 ${selectedId} 선택됨 — 빈 격자를 클릭하면 바로 배치됩니다`
                : '드래그로 회전, 휠로 확대 · 대기 드론은 하단에서 선택해 배치하세요'}
            </div>
          </div>
          <span style={{ fontSize: 12, opacity: 0.55, flexShrink: 0 }}>
            {placedDroneIds.size} / {drones.length} 배치
            {freeDroneIds.size ? ` · 평면 ${freeDroneIds.size}` : ''}
          </span>
          <button type="button" style={iconBtnStyle} onClick={() => setGuide(true)} aria-label="도움말">
            ?
          </button>
          <button type="button" style={iconBtnStyle} onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>
          <div
            style={{
              flex: '0 0 280px',
              borderRight: '1px solid rgba(255,255,255,0.06)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>격자 개수 (X · Y · Z)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <NumberField value={nx} min={1} max={MAX_GRID_COUNT} integer onChange={setNx} />
                <NumberField value={ny} min={1} max={MAX_GRID_COUNT} integer onChange={setNy} />
                <NumberField
                  value={nz}
                  min={1}
                  max={MAX_GRID_COUNT}
                  integer
                  onChange={(v) => {
                    const next = clamp(Math.round(v), 1, MAX_GRID_COUNT);
                    setNz(next);
                    setLayer((L) => Math.min(L, next - 1));
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>간격 (m)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <NumberField value={sx} min={1} max={60} step={0.5} onChange={setSx} />
                <NumberField value={sy} min={1} max={60} step={0.5} onChange={setSy} />
                <NumberField value={sz} min={1} max={60} step={0.5} onChange={setSz} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>기준점 · 격자 시작 (m)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <NumberField value={ax} step={0.5} free allowNegative onChange={setAx} />
                <NumberField value={ay} step={0.5} free allowNegative onChange={setAy} />
                <NumberField
                  value={az}
                  step={0.5}
                  min={0}
                  free
                  allowNegative={false}
                  onChange={setAz}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>Yaw · 일괄 기입 (°)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <NumberField value={bulkYaw} step={1} free allowNegative onChange={setBulkYaw} />
                <button
                  type="button"
                  style={{ ...btnStyle(false), flex: '0 0 auto', padding: '8px 12px', fontSize: 12 }}
                  onClick={() => applyYawToAll(bulkYaw)}
                >
                  전체 적용
                </button>
              </div>
              {selectedId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 11, opacity: 0.6, flexShrink: 0 }}>
                    {droneById[selectedId]?.label || selectedId} 개별 yaw
                  </span>
                  <NumberField
                    value={droneById[selectedId]?.yaw ?? 0}
                    step={1}
                    free
                    allowNegative
                    onChange={setSelectedDroneYaw}
                  />
                </div>
              )}
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>
                작업 평면 ·{' '}
                {laxis === 'z' ? 'X · Y' : laxis === 'y' ? 'X · Z' : 'Y · Z'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={segStyle(laxis === 'z')}
                  onClick={() => {
                    setLaxis('z');
                    setLayer((L) => Math.min(L, nz - 1));
                  }}
                >
                  X·Y
                </button>
                <button
                  type="button"
                  style={segStyle(laxis === 'y')}
                  onClick={() => {
                    setLaxis('y');
                    setLayer((L) => Math.min(L, ny - 1));
                  }}
                >
                  X·Z
                </button>
                <button
                  type="button"
                  style={segStyle(laxis === 'x')}
                  onClick={() => {
                    setLaxis('x');
                    setLayer((L) => Math.min(L, nx - 1));
                  }}
                >
                  Y·Z
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>
                활성 층 ·{' '}
                {allLayers
                  ? '전체'
                  : `L${layer + 1} · ${laxis.toUpperCase()} ${axValue(layer).toFixed(1)} m`}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, axCount - 1)}
                  step={1}
                  value={layer}
                  onChange={(e) => {
                    setLayer(parseInt(e.target.value, 10) || 0);
                    setAllLayers(false);
                  }}
                  style={{ flex: 1, accentColor: ACCENT }}
                />
                <button
                  type="button"
                  style={{ ...segStyle(allLayers), flex: '0 0 auto', padding: '8px 12px' }}
                  onClick={() => setAllLayers((v) => !v)}
                >
                  전체
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {layerRows.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => {
                      setLayer(r.index);
                      setAllLayers(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      cursor: 'pointer',
                      padding: '7px 10px',
                      border: `1px solid ${
                        r.sel ? 'rgba(78, 168, 255, 0.5)' : 'rgba(255,255,255,0.1)'
                      }`,
                      background: r.sel ? 'rgba(78, 168, 255, 0.12)' : 'rgba(255,255,255,0.02)',
                      color: 'inherit',
                      borderRadius: 8,
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{r.name}</span>
                    <span style={{ fontSize: 11, opacity: 0.5 }}>{r.alt}</span>
                    <span style={{ fontSize: 12, marginLeft: 'auto', opacity: 0.85 }}>{r.count}</span>
                  </button>
                ))}
              </div>
            </div>

            <FillDirectionPicker
              axes={PLANE_AXES[laxis]}
              value={fillDirs}
              onChange={setFillDirs}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={{ ...btnStyle(false), flex: 1, padding: '8px 10px', fontSize: 12 }} onClick={fillLayer}>
                층 채우기
              </button>
              <button type="button" style={{ ...btnStyle(false), flex: 1, padding: '8px 10px', fontSize: 12 }} onClick={clearAll}>
                전체 대기
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>평면 배치 · 격자와 별개</span>
              <button
                type="button"
                style={{ ...btnStyle(false), padding: '8px 10px', fontSize: 12 }}
                onClick={() => setImagePlaneOpen(true)}
                title="이미지·3D 모델에서 뽑은 점을 원하는 평면에 그대로 겁니다. 격자 슬롯에 맞추지 않고 계산된 좌표를 씁니다."
              >
                이미지 → 평면에 쏘기
              </button>
              {freeDroneIds.size > 0 && (
                <button
                  type="button"
                  style={{ ...btnStyle(false), padding: '8px 10px', fontSize: 12 }}
                  onClick={clearImagePlacement}
                >
                  평면 배치 {freeDroneIds.size}대 해제
                </button>
              )}
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>
                뷰 · {yaw}° / {zoom.toFixed(1)}×
              </span>
              <div style={{ fontSize: 11, opacity: 0.45, lineHeight: 1.4 }}>
                드래그로 회전 · 휠로 확대/축소
                <br />
                휠 버튼 드래그로 화면 이동 · 노란 테두리를 끌어 격자 크기 조절
              </div>
              <input
                type="range"
                min={0}
                max={359}
                step={1}
                value={yaw}
                onChange={(e) => setYaw(parseInt(e.target.value, 10) || 0)}
                style={{ accentColor: ACCENT }}
              />
              <input
                type="range"
                min={0.5}
                max={2.4}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value) || 1)}
                style={{ accentColor: ACCENT }}
              />
            </div>

            <div
              style={{
                border: '1px solid rgba(130, 190, 255, 0.14)',
                borderRadius: 10,
                padding: '12px 14px',
                background: 'rgba(245, 250, 255, 0.04)',
              }}
            >
              <div style={{ ...labStyle, marginBottom: 8 }}>배치 현황</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '4px 10px',
                  fontSize: 13,
                }}
              >
                <span style={{ opacity: 0.55 }}>격자 배치</span>
                <span>{occupiedCount}</span>
                {freeDroneIds.size > 0 && (
                  <>
                    <span style={{ opacity: 0.55 }}>평면 배치</span>
                    <span>{freeDroneIds.size}</span>
                  </>
                )}
                <span style={{ opacity: 0.55 }}>보유 드론</span>
                <span>{drones.length}</span>
                <span style={{ opacity: 0.55 }}>대기 드론</span>
                <span>{idleDrones.length}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
              <button
                type="button"
                style={{ ...btnStyle(true, placedDroneIds.size === 0), flex: 1 }}
                disabled={placedDroneIds.size === 0}
                onClick={handleConfirm}
              >
                {isEdit ? 'Phase 수정 적용' : 'Phase로 추가'}
              </button>
            </div>
          </div>

          <div
            ref={viewRef}
            onMouseDown={handleViewMouseDown}
            style={{
              position: 'relative',
              flex: '1 1 auto',
              overflow: 'hidden',
              backgroundColor: 'rgba(8, 12, 20, 0.95)',
              backgroundImage:
                'linear-gradient(rgba(80, 120, 180, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(80, 120, 180, 0.08) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
              cursor: orbiting ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
          >
            {/* 3D 뷰와 같은 위성 사진 바닥 (야외 쇼 + 위성 베이스 레이어일 때) */}
            <GridSatelliteGround project={proj} />

            {/* 이전 phase 위치: 회색 점 (참고용, 클릭 불가) */}
            {ghostDots.map((g) => (
              <div
                key={`ghost-${g.key}`}
                title={g.title}
                style={{
                  position: 'absolute',
                  left: g.px - 9,
                  top: g.py - 9,
                  width: 18,
                  height: 18,
                  zIndex: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                }}
              >
                <i
                  style={{
                    display: 'block',
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: 'rgba(190, 198, 210, 0.55)',
                    border: '1px solid rgba(230, 236, 245, 0.45)',
                  }}
                />
                {/* 드론이 많으면 회색 라벨까지 겹쳐 읽기 어려워지므로 생략 */}
                {ghostDots.length <= GHOST_LABEL_LIMIT ? (
                  <span
                    style={{
                      position: 'absolute',
                      left: 13,
                      top: 2,
                      fontSize: 9,
                      fontWeight: 600,
                      color: 'rgba(214, 222, 233, 0.6)',
                      textShadow: '0 0 4px rgba(0,0,0,0.85)',
                    }}
                  >
                    {g.label}
                  </span>
                ) : null}
              </div>
            ))}

            <svg
              width="100%"
              height="100%"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}
            >
              {scene.plate.map((l) => (
                <line
                  key={l.key}
                  x1={l.x1}
                  y1={l.y1}
                  x2={l.x2}
                  y2={l.y2}
                  stroke="rgba(140, 170, 210, 0.35)"
                  strokeWidth="1"
                />
              ))}
              {scene.axes.map((a) => (
                <g key={`axis-${a.key}`}>
                  <line
                    x1={a.x1}
                    y1={a.y1}
                    x2={a.x2}
                    y2={a.y2}
                    stroke={a.color}
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                  <polygon points={a.arrow} fill={a.color} />
                  <text
                    x={a.lx}
                    y={a.ly}
                    fill={a.color}
                    fontSize="10"
                    fontWeight="700"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ letterSpacing: '0.04em' }}
                  >
                    {a.label}
                  </text>
                </g>
              ))}
              {scene.origin ? (
                <circle
                  cx={scene.origin.px}
                  cy={scene.origin.py}
                  r="2.5"
                  fill="#fff"
                  stroke="rgba(200, 220, 255, 0.85)"
                  strokeWidth="1.25"
                />
              ) : null}
              {scene.posts.map((p) => (
                <line
                  key={p.key}
                  x1={p.x1}
                  y1={p.y1}
                  x2={p.x2}
                  y2={p.y2}
                  stroke={
                    p.onLayer ? 'rgba(78, 168, 255, 0.35)' : 'rgba(78, 168, 255, 0.1)'
                  }
                  strokeWidth="1"
                  strokeDasharray="2 4"
                />
              ))}
              {scene.planePoly ? (
                <polygon
                  points={scene.planePoly}
                  fill="rgba(78, 168, 255, 0.12)"
                  stroke="rgba(78, 168, 255, 0.55)"
                  strokeWidth="1.5"
                />
              ) : null}
              {scene.planeLines.map((l) => (
                <line
                  key={l.key}
                  x1={l.x1}
                  y1={l.y1}
                  x2={l.x2}
                  y2={l.y2}
                  stroke="rgba(78, 168, 255, 0.35)"
                  strokeWidth="1"
                />
              ))}
            </svg>

            {/* 격자 크기 조절 테두리 — 가장자리/꼭짓점을 끌어 간격 조절 */}
            <svg
              width="100%"
              height="100%"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 7 }}
            >
              <polygon
                points={resizeFrame.polygon}
                fill="none"
                stroke={resizing ? 'rgba(240, 180, 41, 0.9)' : 'rgba(240, 180, 41, 0.4)'}
                strokeWidth="1.25"
                strokeDasharray="5 4"
              />
              {resizeFrame.handles.map((h) => (
                <g key={h.id}>
                  {/* 잡기 쉬운 투명 히트 영역 */}
                  <circle
                    cx={h.px}
                    cy={h.py}
                    r="11"
                    fill="transparent"
                    style={{ pointerEvents: 'auto', cursor: 'grab' }}
                    onMouseDown={beginResize(h.id)}
                  >
                    <title>
                      {h.corner
                        ? '끌어서 X·Y 간격 동시 조절'
                        : `끌어서 ${h.axisLabel} 간격 조절`}
                    </title>
                  </circle>
                  {h.corner ? (
                    <rect
                      x={h.px - 3.5}
                      y={h.py - 3.5}
                      width="7"
                      height="7"
                      fill="rgba(240, 180, 41, 0.95)"
                      stroke="rgba(20, 24, 32, 0.85)"
                      strokeWidth="1"
                      pointerEvents="none"
                    />
                  ) : (
                    <circle
                      cx={h.px}
                      cy={h.py}
                      r="3.6"
                      fill="rgba(12, 16, 24, 0.9)"
                      stroke="rgba(240, 180, 41, 0.9)"
                      strokeWidth="1.4"
                      pointerEvents="none"
                    />
                  )}
                </g>
              ))}
            </svg>

            {/* 대기 드론: 연하게, 격자보다 뒤 */}
            {scene.dots
              .filter((d) => d.idle)
              .map((d) => {
                const selected = d.selected;
                return (
                  <div
                    key={d.key}
                    title={d.title}
                    onMouseDown={handleDroneClick(d.key)}
                    style={{
                      position: 'absolute',
                      left: d.px - 11,
                      top: d.py - 11,
                      width: 22,
                      height: 22,
                      pointerEvents: 'auto',
                      cursor: 'pointer',
                      zIndex: selected ? 6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition:
                        'left .45s cubic-bezier(.4,0,.2,1), top .45s cubic-bezier(.4,0,.2,1), opacity .15s',
                      opacity: selected ? 1 : 0.28,
                    }}
                  >
                    <i
                      style={{
                        display: 'block',
                        width: selected ? 14 : 9,
                        height: selected ? 14 : 9,
                        borderRadius: '50%',
                        background: selected ? '#f0b429' : '#c9a227',
                        border: `1px solid ${selected ? '#fff3c4' : 'rgba(138, 90, 0, 0.45)'}`,
                        boxShadow: selected ? '0 0 0 3px rgba(240,180,41,.45)' : 'none',
                      }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        left: 16,
                        top: 2,
                        fontSize: 10,
                        color: '#ff4d4d',
                        fontWeight: 700,
                        pointerEvents: 'none',
                        opacity: selected ? 1 : 0.85,
                        textShadow: '0 0 4px rgba(0,0,0,0.85), 0 1px 2px rgba(0,0,0,0.7)',
                      }}
                    >
                      {d.label}
                    </span>
                  </div>
                );
              })}

            {scene.nodes.map((n) => (
              <div
                key={n.key}
                title={n.title}
                onMouseDown={handleNodeDown(n.key, n.live)}
                onMouseEnter={handleNodeEnter(n.key, n.live)}
                style={{
                  position: 'absolute',
                  left: n.px - 11,
                  top: n.sPy - 11,
                  width: 22,
                  height: 22,
                  zIndex: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: n.live ? 'pointer' : 'not-allowed',
                  pointerEvents: n.live ? 'auto' : 'none',
                  opacity: n.onLayer ? (n.live ? 1 : 0.3) : n.on ? 0.2 : 0.1,
                  userSelect: 'none',
                }}
              >
                <i
                  style={{
                    display: 'block',
                    width: n.on ? 13 : 7,
                    height: n.on ? 13 : 7,
                    borderRadius: n.on ? 3 : 2,
                    background: n.on ? ACCENT : 'transparent',
                    border: `1px solid ${n.on ? ACCENT_SOFT : 'rgba(160, 180, 210, 0.5)'}`,
                    transition: 'transform .12s',
                  }}
                />
                {n.label ? (
                  <span
                    style={{
                      position: 'absolute',
                      left: 17,
                      top: 1,
                      fontSize: 9,
                      color: ACCENT_SOFT,
                      pointerEvents: 'none',
                      fontWeight: 600,
                    }}
                  >
                    {n.label}
                  </span>
                ) : null}
              </div>
            ))}

            {/* 배치된 드론: 격자 위 */}
            {scene.dots
              .filter((d) => !d.idle)
              .map((d) => {
              const dimmed = !d.onLayer && !d.selected;
              return (
                <div
                  key={d.key}
                  title={d.title}
                  onMouseDown={handleDroneClick(d.key)}
                  style={{
                    position: 'absolute',
                    left: d.px - 11,
                    top: d.py - 11,
                    width: 22,
                    height: 22,
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                    zIndex: d.selected ? 6 : dimmed ? 2 : 5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition:
                      'left .45s cubic-bezier(.4,0,.2,1), top .45s cubic-bezier(.4,0,.2,1), opacity .15s',
                    opacity: dimmed ? 0.22 : 1,
                  }}
                >
                  <i
                    style={{
                      display: 'block',
                      width: d.selected ? 14 : 11,
                      height: d.selected ? 14 : 11,
                      borderRadius: '50%',
                      background: '#f0b429',
                      border: `1px solid ${d.selected ? '#fff3c4' : '#8a5a00'}`,
                      boxShadow: dimmed
                        ? 'none'
                        : d.selected
                          ? '0 0 0 3px rgba(240,180,41,.45)'
                          : '0 0 0 2px rgba(240,180,41,.2)',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      left: 16,
                      top: 2,
                      fontSize: 10,
                      color: '#ff4d4d',
                      fontWeight: 700,
                      pointerEvents: 'none',
                      opacity: dimmed ? 0.55 : 1,
                      textShadow: '0 0 4px rgba(0,0,0,0.85), 0 1px 2px rgba(0,0,0,0.7)',
                    }}
                  >
                    {d.label}
                  </span>
                </div>
              );
            })}

            {/* 축 색상 범례 (3D 뷰 Colors.axes와 동일) */}
            <div
              style={{
                position: 'absolute',
                top: 10,
                left: 10,
                display: 'flex',
                gap: 8,
                padding: '5px 8px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(12, 16, 24, 0.72)',
                pointerEvents: 'none',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {[
                ['X', AXIS_COLORS.x],
                ['Y', AXIS_COLORS.y],
                ['Z', AXIS_COLORS.z],
              ].map(([label, color]) => (
                <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 3, color }}>
                  <i
                    style={{
                      display: 'block',
                      width: 10,
                      height: 2,
                      borderRadius: 1,
                      background: color,
                    }}
                  />
                  {label}
                </span>
              ))}
              {ghostDots.length ? (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'rgba(214, 222, 233, 0.7)',
                    borderLeft: '1px solid rgba(255,255,255,0.14)',
                    paddingLeft: 8,
                  }}
                >
                  <i
                    style={{
                      display: 'block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'rgba(190, 198, 210, 0.55)',
                      border: '1px solid rgba(230, 236, 245, 0.45)',
                    }}
                  />
                  {previousLabel || '이전 phase'}
                </span>
              ) : null}
            </div>

            {/* 대기중 드론 UI 스택 */}
            <div
              style={{
                position: 'absolute',
                left: 14,
                right: 14,
                bottom: 10,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: 12,
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  pointerEvents: 'auto',
                  minWidth: 0,
                  flex: 1,
                  maxWidth: 520,
                  padding: '8px 10px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(240, 180, 41, 0.28)',
                  background: 'rgba(12, 16, 24, 0.82)',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: 'rgba(240, 180, 41, 0.85)',
                    fontWeight: 600,
                    marginBottom: 8,
                    opacity: 0.95,
                  }}
                >
                  대기 드론 {idleDrones.length}대 · 이전 위치 유지
                  {selectedId ? ` · ${selectedId} 선택됨` : ' · 클릭 후 격자 배치'}
                </div>
                {idleDrones.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'rgba(190, 210, 235, 0.4)' }}>
                    대기 드론 없음 — 배치된 드론을 클릭하면 이전 위치로 돌아옵니다
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-end',
                      height: 34,
                      paddingLeft: 2,
                    }}
                  >
                    {idleDrones.map((d, idx) => {
                      const selected = selectedId === d.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          title={`${d.id} 대기중 — 이전 위치 유지`}
                          onMouseDown={handleDroneClick(d.id)}
                          style={{
                            width: 30,
                            height: 30,
                            marginLeft: idx === 0 ? 0 : -10,
                            borderRadius: '50%',
                            border: selected
                              ? '2px solid #fff3c4'
                              : '1px solid #8a5a00',
                            background: selected ? '#f0b429' : '#d4a017',
                            color: '#2a1a00',
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                            zIndex: selected ? 40 : idx + 1,
                            boxShadow: selected
                              ? '0 0 0 3px rgba(240,180,41,.35)'
                              : '0 2px 6px rgba(0,0,0,0.35)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                            flexShrink: 0,
                          }}
                        >
                          {d.label || shortLabel(d.id, idx)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div
                style={{
                  pointerEvents: 'none',
                  fontSize: 11,
                  color: 'rgba(190, 210, 235, 0.45)',
                  textAlign: 'right',
                  lineHeight: 1.4,
                  paddingBottom: 4,
                }}
              >
                <div>파란 점 = 슬롯 · 노란 점 = 드론</div>
                <div>
                  {placedDroneIds.size >= drones.length
                    ? '모두 배치됨'
                    : `배치 ${placedDroneIds.size} / ${drones.length}`}
                </div>
              </div>
            </div>
          </div>
        </div>

        {guide ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(6, 10, 16, 0.55)',
            }}
            onMouseDown={() => setGuide(false)}
          >
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                width: 520,
                maxWidth: 'calc(100% - 40px)',
                maxHeight: 'calc(100% - 64px)',
                overflowY: 'auto',
                background: 'linear-gradient(165deg, rgba(18, 24, 36, 0.98), rgba(11, 16, 26, 0.96))',
                border: '1px solid rgba(126, 200, 255, 0.22)',
                borderRadius: 14,
                boxShadow: '0 20px 48px rgba(0, 0, 0, 0.48)',
                padding: '24px 26px',
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  marginBottom: 4,
                }}
              >
                클릭하면 드론이 바로 배치됩니다
              </div>
              <div style={{ fontSize: 13, opacity: 0.55, marginBottom: 20 }}>
                격자를 클릭하는 순간 대기 드론이 그 자리로 이동합니다.
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 1fr',
                  gap: '14px 12px',
                  alignItems: 'start',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {[
                  [
                    '격자 만들기',
                    '격자 개수는 X·Y·Z 방향 점 수, 간격은 점 사이 거리(m), 기준점은 격자 시작 모서리입니다. XYZ 축은 항상 (0,0,0)에 있고, 기준점만큼 떨어진 곳에서 격자가 시작됩니다.',
                  ],
                  [
                    '바로 배치',
                    '대기 드론은 하단 스택에 모입니다. 드론을 고른 뒤 격자를 누르면 바로 배치되고, 빈 격자만 눌러도 가장 가까운 대기 드론이 올라갑니다.',
                  ],
                  [
                    '건드리지 않은 드론',
                    '격자에 올리지 않은 드론은 이전 상태(직전 phase 좌표)를 그대로 유지합니다. 배치한 드론을 다시 클릭하면 원래 자리로 돌아갑니다.',
                  ],
                  [
                    '뷰 조작',
                    '빈 배경을 드래그하거나 우클릭 드래그로 회전하고, 마우스 휠로 확대·축소합니다. 왼쪽 슬라이더로도 조절할 수 있습니다.',
                  ],
                  [
                    isEdit ? 'Phase 수정 적용' : 'Phase로 추가',
                    isEdit
                      ? '배치를 마친 뒤 Phase 수정 적용을 누르면 이 phase 좌표가 갱신되고 3D 씬에 반영됩니다.'
                      : '배치를 마친 뒤 Phase로 추가를 누르면 새 formation phase가 만들어지고 3D 씬에 반영됩니다.',
                  ],
                ].map(([stepTitle, body], idx) => (
                  <React.Fragment key={stepTitle}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        border: '1px solid rgba(78, 168, 255, 0.5)',
                        background: 'rgba(78, 168, 255, 0.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: ACCENT_SOFT,
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div>
                      <b>{stepTitle}</b>
                      <br />
                      <span style={{ opacity: 0.55 }}>{body}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ marginTop: 22, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button type="button" style={btnStyle(true)} onClick={() => setGuide(false)}>
                  시작하기
                </button>
                <span style={{ fontSize: 12, opacity: 0.45 }}>
                  우측 상단 ? 버튼으로 다시 열 수 있습니다.
                </span>
              </div>
            </div>
          </div>
        ) : null}

        <ImageToDotsModal
          open={imagePlaneOpen}
          mode="place"
          droneIds={drones.map((d) => d.id)}
          droneOrigins={drones.map((d) => ({ x: d.x, y: d.y, z: d.z }))}
          minSeparation={minSeparation}
          suggestedPlaneX={suggestedPlaneX}
          onPlacePoints={handlePlaceImagePoints}
          onClose={() => setImagePlaneOpen(false)}
        />
      </div>
    </div>,
    document.body
  );
}

FormationGridModal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  drones: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      x: PropTypes.number,
      y: PropTypes.number,
      z: PropTypes.number,
      fromPhase: PropTypes.bool,
    })
  ),
  onConfirm: PropTypes.func,
  mode: PropTypes.oneOf(['create', 'edit']),
  title: PropTypes.string,
  /** 회색 참고 점으로 깔 이전 phase 좌표 (없으면 표시하지 않음) */
  previousDrones: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      x: PropTypes.number,
      y: PropTypes.number,
      z: PropTypes.number,
    })
  ),
  /** 범례에 보여줄 이전 phase 이름 */
  previousLabel: PropTypes.string,
  /** 이미지 → 평면 배치가 지켜야 할 최소 간격 (m) */
  minSeparation: PropTypes.number,
  initialLattice: PropTypes.shape({
    nx: PropTypes.number,
    ny: PropTypes.number,
    nz: PropTypes.number,
    sx: PropTypes.number,
    sy: PropTypes.number,
    sz: PropTypes.number,
    ax: PropTypes.number,
    ay: PropTypes.number,
    az: PropTypes.number,
  }),
};
