import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';

import Colors from '~/components/colors';

const RAD = (d) => (d * Math.PI) / 180;
const COS30 = Math.cos(RAD(30));

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
    nx: clamp(nx, 1, 14),
    ny: clamp(ny, 1, 14),
    nz: clamp(nz, 1, 10),
    sx: clamp(sx, 1, 60),
    sy: clamp(sy, 1, 60),
    sz: clamp(sz, 1, 60),
    ax,
    ay,
    az: Math.max(0, az),
  };
};

/** 드론 좌표를 격자 슬롯에 매칭해 occupancy 생성 */
const matchOccupancyToLattice = (positions, lattice) => {
  const occupancy = {};
  if (!lattice || !Array.isArray(positions) || !positions.length) return occupancy;
  const { nx, ny, nz, sx, sy, sz, ax, ay, az } = lattice;
  const tol = Math.min(sx, sy, sz) * 0.35;
  const tol2 = tol * tol;

  positions.forEach((p) => {
    if (!p?.id) return;
    let best = null;
    let bd = Infinity;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          const x = ax + (i - (nx - 1) / 2) * sx;
          const y = ay + (j - (ny - 1) / 2) * sy;
          const z = az + k * sz;
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
  const nx = clamp(xs.length, 1, 14);
  const ny = clamp(ys.length, 1, 14);
  const nz = clamp(zs.length, 1, 10);
  const ax = (xs[0] + xs[xs.length - 1]) / 2;
  const ay = (ys[0] + ys[ys.length - 1]) / 2;
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

/** 대기 드론을 격자 앞 바닥(z=0)에 일렬 스택으로 배치 */
const buildIdleStackPositions = (idleIds, { ax, ay, ny, sy, sx }) => {
  const n = idleIds.length;
  if (!n) return {};
  const hy = ((ny - 1) / 2) * sy;
  const gap = Math.max(2.5, Math.min(4.5, Math.min(sx, sy) * 0.5));
  const y = ay - hy - Math.max(8, sy * 1.25);
  const startX = ax - ((n - 1) * gap) / 2;
  const map = {};
  idleIds.forEach((id, idx) => {
    map[id] = { x: startX + idx * gap, y, z: 0 };
  });
  return map;
};

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
  return {
    x: ax + (i - (nx - 1) / 2) * sx,
    y: ay + (j - (ny - 1) / 2) * sy,
    z: az + k * sz,
  };
};

/** occupancy 기준으로 배치 드론은 슬롯, 대기 드론은 바닥 스택으로 재배치 */
const relayoutDrones = (drones, occupancy, lattice) => {
  if (!Array.isArray(drones) || !drones.length) return drones;
  const placedPos = {};
  const validOcc = {};
  Object.entries(occupancy || {}).forEach(([key, droneId]) => {
    const pos = slotWorldPos(key, lattice);
    if (!pos || !droneId) return;
    validOcc[key] = droneId;
    placedPos[droneId] = pos;
  });
  const idleIds = drones
    .map((d) => d.id)
    .filter((id) => !placedPos[id])
    .sort(compareDroneId);
  const idlePos = buildIdleStackPositions(idleIds, lattice);
  return drones.map((d) => {
    if (placedPos[d.id]) return { ...d, ...placedPos[d.id] };
    if (idlePos[d.id]) return { ...d, ...idlePos[d.id] };
    return { ...d, z: 0 };
  });
};

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 21000,
  background: 'rgba(6, 10, 16, 0.78)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
};

const panelStyle = {
  position: 'relative',
  width: 'min(1180px, 100%)',
  height: 'min(820px, calc(100vh - 24px))',
  display: 'flex',
  flexDirection: 'column',
  background: 'linear-gradient(165deg, rgba(18, 24, 36, 0.99), rgba(11, 16, 26, 0.97))',
  border: '1px solid rgba(126, 200, 255, 0.22)',
  borderRadius: 16,
  boxShadow: '0 24px 56px rgba(0, 0, 0, 0.55)',
  color: '#eef5ff',
  overflow: 'hidden',
};

const labStyle = {
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'rgba(190, 210, 235, 0.55)',
  fontWeight: 600,
};

const inputStyle = {
  flex: 1,
  minWidth: 0,
  width: 56,
  padding: '6px 8px',
  fontSize: 13,
  color: '#ecf5ff',
  background: 'rgba(245, 250, 255, 0.06)',
  border: '1px solid rgba(130, 190, 255, 0.22)',
  borderRadius: 7,
  outline: 'none',
  boxSizing: 'border-box',
};

const segStyle = (on) => ({
  flex: 1,
  border: `1px solid ${on ? 'rgba(96, 165, 250, 0.85)' : 'rgba(130, 190, 255, 0.22)'}`,
  background: on ? 'rgba(59, 130, 246, 0.85)' : 'transparent',
  color: on ? '#fff' : 'rgba(230, 240, 255, 0.85)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  padding: '7px 8px',
  cursor: 'pointer',
  fontWeight: 600,
});

const btnStyle = (solid = false, disabled = false) => ({
  border: `1px solid ${solid ? 'rgba(96, 165, 250, 0.9)' : 'rgba(130, 190, 255, 0.35)'}`,
  background: solid ? 'rgba(59, 130, 246, 0.92)' : 'transparent',
  color: solid ? '#fff' : 'rgba(190, 220, 255, 0.95)',
  fontSize: 12,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  padding: '8px 14px',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.4 : 1,
  borderRadius: 8,
  fontWeight: 600,
});

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
}) {
  const isEdit = mode === 'edit';
  const viewRef = useRef(null);
  const paintRef = useRef(null);
  /** 뷰 드래그 회전: { startX, startYaw } */
  const orbitRef = useRef(null);
  const yawRef = useRef(35);
  const placementRef = useRef({ drones: [], occupancy: {}, homeDrones: [], selectedId: null });
  const [drones, setDrones] = useState([]);
  const [homeDrones, setHomeDrones] = useState([]);
  /** key -> droneId : 격자에 바로 배치된 드론 */
  const [occupancy, setOccupancy] = useState({});
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
  const [yaw, setYaw] = useState(35);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState({ w: 900, h: 560 });
  const [guide, setGuide] = useState(true);
  const [orbiting, setOrbiting] = useState(false);
  const [, setPaintTick] = useState(0);

  useEffect(() => {
    placementRef.current = { drones, occupancy, homeDrones, selectedId };
  }, [drones, occupancy, homeDrones, selectedId]);

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
            fromPhase: !!d.fromPhase,
            label: shortLabel(d.id, i),
          }))
        : makeFallbackDrones(16).map((d, i) => ({ ...d, label: shortLabel(d.id, i) }));
    setSelectedId(null);

    // 편집: 저장된 격자를 우선 복원. 없으면 phase에 속한 드론 좌표만으로 추론
    // (대기/홈 위치 드론이 섞이면 격자가 깨져 빈 화면처럼 보임)
    let lattice = DEFAULT_LATTICE;
    let occ = {};
    if (isEdit) {
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
    const laidOut = relayoutDrones(seeded, occ, lattice);

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
    setDrones(laidOut);
    setHomeDrones(laidOut.map((d) => ({ ...d })));
    setLayer(0);
    setAllLayers(false);
    setLaxis('z');
    setYaw(35);
    setZoom(1);
    setGuide(!isEdit);
    paintRef.current = null;
    // dronesProp / mode / initialLattice는 open 시점에만 시드
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- seed on open only

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
      if (!orbitRef.current) return;
      const dx = e.clientX - orbitRef.current.startX;
      setYaw(wrapYaw(orbitRef.current.startYaw + dx * 0.45));
    };
    const onUp = () => {
      if (paintRef.current !== null) {
        paintRef.current = null;
        setPaintTick((t) => t + 1);
      }
      endOrbit();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
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
    };
  }, [open, guide, onClose]);

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
      // 우클릭·휠클릭: 어디서든 회전 / 좌클릭: 빈 배경에서만 회전 (슬롯 배치와 분리)
      if (e.button === 2 || e.button === 1) {
        e.preventDefault();
        beginOrbit(e.clientX);
        return;
      }
      if (e.button === 0 && isViewBackgroundTarget(e.target, e.currentTarget)) {
        e.preventDefault();
        beginOrbit(e.clientX);
      }
    },
    [guide, beginOrbit]
  );

  const nodePos = useCallback(
    (i, j, k) => ({
      x: ax + (i - (nx - 1) / 2) * sx,
      y: ay + (j - (ny - 1) / 2) * sy,
      z: az + k * sz,
    }),
    [ax, ay, az, nx, ny, sx, sy, sz]
  );

  // spacing / anchor / lattice·occupancy 바뀌면 배치 드론은 슬롯, 대기 드론은 바닥 스택으로 재배치
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
      const next = relayoutDrones(prev, nextOcc, lattice);
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
      if (laxis === 'x') return ax + (idx - (nx - 1) / 2) * sx;
      if (laxis === 'y') return ay + (idx - (ny - 1) / 2) * sy;
      return az + idx * sz;
    },
    [laxis, ax, ay, az, nx, ny, sx, sy, sz]
  );

  const raw = useCallback(
    (x, y, z) => {
      const c = Math.cos(RAD(yaw));
      const s = Math.sin(RAD(yaw));
      const dx = x - ax;
      const dy = y - ay;
      const rx = dx * c - dy * s;
      const ry = dx * s + dy * c;
      return { u: (rx - ry) * COS30, v: (rx + ry) * 0.5 - z, depth: rx + ry };
    },
    [yaw, ax, ay]
  );

  const fit = useMemo(() => {
    const pts = [];
    for (const k of [0, nz - 1]) {
      for (const j of [0, ny - 1]) {
        for (const i of [0, nx - 1]) pts.push(nodePos(i, j, k));
      }
    }
    const hx = ((nx - 1) / 2) * sx + sx * 0.6;
    const hy = ((ny - 1) / 2) * sy + sy * 0.6;
    for (const sxn of [-1, 1]) {
      for (const syn of [-1, 1]) {
        pts.push({ x: ax + sxn * hx, y: ay + syn * hy, z: 0 });
      }
    }
    drones.forEach((d) => pts.push(d));

    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    pts.forEach((p) => {
      const r = raw(p.x, p.y, p.z);
      if (r.u < uMin) uMin = r.u;
      if (r.u > uMax) uMax = r.u;
      if (r.v < vMin) vMin = r.v;
      if (r.v > vMax) vMax = r.v;
    });

    const pad = 54;
    const w = Math.max(120, view.w - pad * 2);
    const h = Math.max(120, view.h - pad * 2);
    const du = Math.max(1, uMax - uMin);
    const dv = Math.max(1, vMax - vMin);
    const s = Math.min(w / du, h / dv) * zoom;
    return {
      s,
      ox: view.w / 2 - ((uMin + uMax) / 2) * s,
      oy: view.h / 2 - ((vMin + vMax) / 2) * s,
    };
  }, [nx, ny, nz, sx, sy, ax, ay, drones, raw, nodePos, view, zoom]);

  const proj = useCallback(
    (x, y, z) => {
      const r = raw(x, y, z);
      return { px: fit.ox + r.u * fit.s, py: fit.oy + r.v * fit.s, depth: r.depth };
    },
    [raw, fit]
  );

  const planeGeom = useMemo(() => {
    const P = (i, j, k) => nodePos(i, j, k);
    if (laxis === 'z') return { A: nx, B: ny, mk: (a, b) => P(a, b, layer) };
    if (laxis === 'y') return { A: nx, B: nz, mk: (a, b) => P(a, layer, b) };
    return { A: ny, B: nz, mk: (a, b) => P(layer, a, b) };
  }, [laxis, nx, ny, nz, layer, nodePos]);

  const occupiedCount = Object.keys(occupancy).length;
  const placedDroneIds = useMemo(() => new Set(Object.values(occupancy)), [occupancy]);
  const idleDrones = useMemo(
    () =>
      drones
        .filter((d) => !placedDroneIds.has(d.id))
        .slice()
        .sort((a, b) => compareDroneId(a.id, b.id)),
    [drones, placedDroneIds]
  );

  const commitPlacement = useCallback((next) => {
    if (!next) return;
    placementRef.current = {
      ...placementRef.current,
      drones: next.drones,
      occupancy: next.occupancy,
      selectedId: next.selectedId !== undefined ? next.selectedId : placementRef.current.selectedId,
    };
    setDrones(next.drones);
    setOccupancy(next.occupancy);
    if (next.selectedId !== undefined) setSelectedId(next.selectedId);
  }, []);

  const latticeParams = useCallback(
    () => ({ ax, ay, az, nx, ny, nz, sx, sy, sz }),
    [ax, ay, az, nx, ny, nz, sx, sy, sz]
  );

  const placeAtKey = useCallback(
    (key, preferredId) => {
      const { drones: prevDrones, occupancy: prevOcc } = placementRef.current;
      if (prevOcc[key]) return null;
      const lattice = latticeParams();
      const pos = slotWorldPos(key, lattice);
      if (!pos) return null;
      const used = new Set(Object.values(prevOcc));
      let droneId = preferredId && !used.has(preferredId) ? preferredId : null;
      // 선택 없이 배치할 때는 대기 스택 순서(id 정렬)대로 꺼냄
      if (!droneId) {
        const idleIds = prevDrones
          .map((d) => d.id)
          .filter((id) => !used.has(id))
          .sort(compareDroneId);
        droneId = idleIds[0] || null;
      }
      if (!droneId) return null;

      const nextOcc = { ...prevOcc };
      for (const [slot, id] of Object.entries(nextOcc)) {
        if (id === droneId) delete nextOcc[slot];
      }
      nextOcc[key] = droneId;
      const nextDrones = relayoutDrones(prevDrones, nextOcc, lattice);
      return { drones: nextDrones, occupancy: nextOcc, selectedId: null };
    },
    [latticeParams]
  );

  const releaseAtKey = useCallback(
    (key) => {
      const { drones: prevDrones, occupancy: prevOcc } = placementRef.current;
      if (!prevOcc[key]) return null;
      const nextOcc = { ...prevOcc };
      delete nextOcc[key];
      const nextDrones = relayoutDrones(prevDrones, nextOcc, latticeParams());
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

  const fillLayer = () => {
    let { drones: d, occupancy: occ } = placementRef.current;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
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
      drones: relayoutDrones(prevDrones, {}, latticeParams()),
      occupancy: {},
      selectedId: null,
    });
  };

  const handleConfirm = () => {
    const points = {};
    const { drones: cur, occupancy: occ } = placementRef.current;
    const placed = new Set(Object.values(occ));
    cur.forEach((d) => {
      if (!placed.has(d.id)) return;
      points[d.id] = {
        x: Math.round(d.x * 10000) / 10000,
        y: Math.round(d.y * 10000) / 10000,
        z: Math.round(d.z * 10000) / 10000,
      };
    });
    if (!Object.keys(points).length) return;
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
    onConfirm?.(points, lattice);
    onClose();
  };

  const droneById = useMemo(() => {
    const map = {};
    drones.forEach((d) => {
      map[d.id] = d;
    });
    return map;
  }, [drones]);

  const scene = useMemo(() => {
    const plate = [];
    const hx = ((nx - 1) / 2) * sx + sx * 0.6;
    const hy = ((ny - 1) / 2) * sy + sy * 0.6;
    for (let i = 0; i <= nx; i += 1) {
      const x = ax - hx + (i / nx) * hx * 2;
      const a = proj(x, ay - hy, 0);
      const b = proj(x, ay + hy, 0);
      plate.push({ x1: a.px, y1: a.py, x2: b.px, y2: b.py, key: `px${i}` });
    }
    for (let j = 0; j <= ny; j += 1) {
      const y = ay - hy + (j / ny) * hy * 2;
      const a = proj(ax - hx, y, 0);
      const b = proj(ax + hx, y, 0);
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
    Object.entries(occupancy).forEach(([key]) => {
      const { i, j, k } = parseNodeKey(key);
      const p = nodePos(i, j, k);
      const top = proj(p.x, p.y, p.z);
      const ground = proj(p.x, p.y, 0);
      posts.push({
        x1: top.px,
        y1: top.py,
        x2: ground.px,
        y2: ground.py,
        key: `post${key}`,
      });
    });

    // 대기 드론 바닥 스택 가이드 라인
    let idleRail = null;
    const idleList = drones
      .filter((d) => !placedDroneIds.has(d.id))
      .slice()
      .sort((a, b) => compareDroneId(a.id, b.id));
    if (idleList.length >= 1) {
      const a = proj(idleList[0].x, idleList[0].y, 0);
      const b = proj(
        idleList[idleList.length - 1].x,
        idleList[idleList.length - 1].y,
        0
      );
      idleRail = { x1: a.px, y1: a.py, x2: b.px, y2: b.py };
    }

    const atCap = occupiedCount >= drones.length;
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
      return {
        key: d.id,
        label: d.label || shortLabel(d.id, idx),
        title: placed
          ? `${d.id} · 클릭하면 대기 스택으로`
          : selected
            ? `${d.id} · 선택됨 — 격자 클릭으로 배치`
            : `${d.id} · 대기중 — 클릭 후 격자 배치`,
        px: s.px,
        py: s.py,
        placed,
        selected,
        idle: !placed,
      };
    });

    // 3D 뷰와 동일: 원점(0,0,0) 기준 +X/+Y/+Z 축 (짧게 표시)
    const axisLen = Math.max(2.5, Math.min(hx, hy) * 0.18, Math.max(sx, sy, sz) * 0.85);
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

    return { plate, planePoly, planeLines, posts, nodes, dots, idleRail, axes, origin };
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
    occupiedCount,
    drones,
    droneById,
    placedDroneIds,
    selectedId,
    axIndex,
    layer,
    nodePos,
  ]);

  const layerRows = useMemo(() => {
    const rows = [];
    for (let k = 0; k < axCount; k += 1) {
      let c = 0;
      Object.keys(occupancy).forEach((key) => {
        if (parseInt(key.split('_')[axIndex], 10) === k) c += 1;
      });
      const sel = !allLayers && k === layer;
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
            padding: '12px 18px',
            borderBottom: '1px solid rgba(130, 190, 255, 0.14)',
            flex: '0 0 auto',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.06em' }}>
            {title || (isEdit ? 'Formation · 그리드 수정' : 'Formation · Lattice')}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(190, 210, 235, 0.55)', flex: 1 }}>
            {selectedId
              ? `드론 ${selectedId} 선택됨 — 빈 격자를 클릭하면 바로 배치됩니다`
              : '빈 곳 드래그·우클릭 드래그로 회전, 휠로 확대. 대기 드론은 하단 스택에서 배치하세요.'}
          </div>
          <span style={{ fontSize: 12, color: 'rgba(190, 210, 235, 0.65)' }}>
            {occupiedCount} / {drones.length} 배치
          </span>
          <button type="button" style={btnStyle(false)} onClick={() => setGuide(true)}>
            ?
          </button>
          <button type="button" style={btnStyle(false)} onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>
          <div
            style={{
              flex: '0 0 280px',
              borderRight: '1px solid rgba(130, 190, 255, 0.14)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>Lattice X · Y · Z (개수)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <NumberField value={nx} min={1} max={14} integer onChange={setNx} />
                <NumberField value={ny} min={1} max={14} integer onChange={setNy} />
                <NumberField
                  value={nz}
                  min={1}
                  max={10}
                  integer
                  onChange={(v) => {
                    const next = clamp(Math.round(v), 1, 10);
                    setNz(next);
                    setLayer((L) => Math.min(L, next - 1));
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>Spacing X · Y · Z (m)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <NumberField value={sx} min={1} max={60} step={0.5} onChange={setSx} />
                <NumberField value={sy} min={1} max={60} step={0.5} onChange={setSy} />
                <NumberField value={sz} min={1} max={60} step={0.5} onChange={setSz} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>Anchor X · Y · Z (m)</span>
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

            <div style={{ height: 1, background: 'rgba(130, 190, 255, 0.12)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>
                작업 평면 ·{' '}
                {laxis === 'z' ? 'X · Y 평면' : laxis === 'y' ? 'X · Z 평면' : 'Y · Z 평면'}
              </span>
              <div style={{ display: 'flex', gap: 0 }}>
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
                  style={{ flex: 1, accentColor: '#3b82f6' }}
                />
                <button
                  type="button"
                  style={{ ...segStyle(allLayers), flex: '0 0 auto' }}
                  onClick={() => setAllLayers((v) => !v)}
                >
                  All
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
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
                      padding: '5px 8px',
                      border: `1px solid ${
                        r.sel ? 'rgba(96, 165, 250, 0.85)' : 'rgba(130, 190, 255, 0.18)'
                      }`,
                      background: r.sel ? 'rgba(59, 130, 246, 0.18)' : 'transparent',
                      color: 'inherit',
                      borderRadius: 6,
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ letterSpacing: '0.06em', fontSize: 12, fontWeight: 600 }}>
                      {r.name}
                    </span>
                    <span style={{ fontSize: 11, color: 'rgba(190, 210, 235, 0.5)' }}>{r.alt}</span>
                    <span style={{ fontSize: 12, marginLeft: 'auto' }}>{r.count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={{ ...btnStyle(false), flex: 1, fontSize: 11 }} onClick={fillLayer}>
                층 채우기
              </button>
              <button type="button" style={{ ...btnStyle(false), flex: 1, fontSize: 11 }} onClick={clearAll}>
                전체 대기 위치로
              </button>
            </div>

            <div style={{ height: 1, background: 'rgba(130, 190, 255, 0.12)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labStyle}>
                View · {yaw}° / zoom {zoom.toFixed(1)}×
              </span>
              <div style={{ fontSize: 11, color: 'rgba(190, 210, 235, 0.45)', lineHeight: 1.4 }}>
                드래그로 회전 · 휠로 확대/축소
              </div>
              <input
                type="range"
                min={0}
                max={359}
                step={1}
                value={yaw}
                onChange={(e) => setYaw(parseInt(e.target.value, 10) || 0)}
                style={{ accentColor: '#3b82f6' }}
              />
              <input
                type="range"
                min={0.5}
                max={2.4}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value) || 1)}
                style={{ accentColor: '#3b82f6' }}
              />
            </div>

            <div
              style={{
                border: '1px solid rgba(130, 190, 255, 0.2)',
                borderRadius: 10,
                padding: '12px 14px',
                background: 'rgba(245, 250, 255, 0.03)',
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
                <span style={{ color: 'rgba(190, 210, 235, 0.55)' }}>배치된 드론</span>
                <span>{occupiedCount}</span>
                <span style={{ color: 'rgba(190, 210, 235, 0.55)' }}>보유 드론</span>
                <span>{drones.length}</span>
                <span style={{ color: 'rgba(190, 210, 235, 0.55)' }}>대기 드론</span>
                <span>{Math.max(0, drones.length - occupiedCount)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
              <button
                type="button"
                style={{ ...btnStyle(true, occupiedCount === 0), flex: 1 }}
                disabled={occupiedCount === 0}
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
            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
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
              {scene.planePoly ? (
                <polygon
                  points={scene.planePoly}
                  fill="rgba(59, 130, 246, 0.12)"
                  stroke="rgba(96, 165, 250, 0.75)"
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
                  stroke="rgba(96, 165, 250, 0.35)"
                  strokeWidth="1"
                />
              ))}
              {scene.posts.map((p) => (
                <line
                  key={p.key}
                  x1={p.x1}
                  y1={p.y1}
                  x2={p.x2}
                  y2={p.y2}
                  stroke="rgba(96, 165, 250, 0.35)"
                  strokeWidth="1"
                  strokeDasharray="2 4"
                />
              ))}
              {scene.idleRail ? (
                <line
                  x1={scene.idleRail.x1}
                  y1={scene.idleRail.y1}
                  x2={scene.idleRail.x2}
                  y2={scene.idleRail.y2}
                  stroke="rgba(240, 180, 41, 0.55)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              ) : null}
            </svg>

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
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: n.live ? 'pointer' : 'not-allowed',
                  pointerEvents: n.live ? 'auto' : 'none',
                  opacity: n.onLayer ? (n.live ? 1 : 0.3) : n.on ? 0.5 : 0.16,
                  userSelect: 'none',
                }}
              >
                <i
                  style={{
                    display: 'block',
                    width: n.on ? 13 : 7,
                    height: n.on ? 13 : 7,
                    background: n.on ? '#3b82f6' : 'transparent',
                    border: `1px solid ${n.on ? '#93c5fd' : 'rgba(160, 180, 210, 0.55)'}`,
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
                      letterSpacing: '0.06em',
                      color: '#93c5fd',
                      pointerEvents: 'none',
                      fontWeight: 600,
                    }}
                  >
                    {n.label}
                  </span>
                ) : null}
              </div>
            ))}

            {scene.dots.map((d) => (
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
                  zIndex: d.selected ? 6 : d.idle ? 3 : 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'left .45s cubic-bezier(.4,0,.2,1), top .45s cubic-bezier(.4,0,.2,1)',
                }}
              >
                <i
                  style={{
                    display: 'block',
                    width: d.selected ? 14 : d.idle ? 10 : 11,
                    height: d.selected ? 14 : d.idle ? 10 : 11,
                    borderRadius: '50%',
                    background: d.selected || d.placed ? '#f0b429' : '#c9a227',
                    border: `1px solid ${d.selected ? '#fff3c4' : '#8a5a00'}`,
                    boxShadow: d.selected
                      ? '0 0 0 3px rgba(240,180,41,.45)'
                      : d.placed
                        ? '0 0 0 2px rgba(240,180,41,.2)'
                        : 'none',
                    opacity: d.idle && !d.selected ? 0.85 : 1,
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    left: 16,
                    top: 2,
                    fontSize: 9,
                    letterSpacing: '0.06em',
                    color: '#d4a017',
                    fontWeight: 600,
                    pointerEvents: 'none',
                  }}
                >
                  {d.label}
                </span>
              </div>
            ))}

            {/* 축 색상 범례 (3D 뷰 Colors.axes와 동일) */}
            <div
              style={{
                position: 'absolute',
                top: 10,
                left: 10,
                display: 'flex',
                gap: 7,
                padding: '4px 7px',
                borderRadius: 6,
                border: '1px solid rgba(130, 190, 255, 0.2)',
                background: 'rgba(12, 16, 24, 0.72)',
                pointerEvents: 'none',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
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
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'rgba(240, 180, 41, 0.8)',
                    fontWeight: 700,
                    marginBottom: 8,
                  }}
                >
                  대기중 드론 · {idleDrones.length}대
                  {selectedId ? ` · ${selectedId} 선택됨` : ' · 클릭 후 격자 배치'}
                </div>
                {idleDrones.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'rgba(190, 210, 235, 0.4)' }}>
                    대기 드론 없음 — 배치된 드론을 클릭하면 여기로 돌아옵니다
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
                          title={`${d.id} 대기중`}
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
                  {occupiedCount >= drones.length
                    ? '모두 배치됨'
                    : `배치 ${occupiedCount} / ${drones.length}`}
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
                background: 'rgba(14, 20, 32, 0.98)',
                border: '1px solid rgba(130, 190, 255, 0.28)',
                borderRadius: 14,
                padding: '26px 28px',
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                클릭하면 드론이 바로 갑니다
              </div>
              <div style={{ fontSize: 13, color: 'rgba(190, 210, 235, 0.6)', marginBottom: 20 }}>
                켠 점 → 미리보기 단계 없이, 격자를 클릭하는 순간 드론이 그 자리로 이동합니다.
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '26px 1fr',
                  gap: '14px 12px',
                  alignItems: 'start',
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                {[
                  [
                    '격자 만들기',
                    'Lattice는 X·Y·Z 방향 점 개수, Spacing은 점 사이 거리(m), Anchor는 격자 기준 좌표입니다.',
                  ],
                  [
                    '바로 배치',
                    '대기 드론은 바닥 직선 스택과 하단 UI에 모입니다. 스택에서 드론을 고른 뒤 격자를 누르면 바로 배치됩니다. 빈 격자만 눌러도 가장 가까운 대기 드론이 올라갑니다.',
                  ],
                  [
                    '뷰 조작',
                    '빈 배경을 드래그하거나 우클릭 드래그로 회전하고, 마우스 휠로 확대·축소합니다. 왼쪽 슬라이더로도 동일하게 조절할 수 있습니다.',
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
                        width: 26,
                        height: 26,
                        border: '1px solid rgba(96, 165, 250, 0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#93c5fd',
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div>
                      <b style={{ letterSpacing: '0.04em' }}>{stepTitle}</b>
                      <br />
                      <span style={{ color: 'rgba(190, 210, 235, 0.55)' }}>{body}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ marginTop: 22, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button type="button" style={btnStyle(true)} onClick={() => setGuide(false)}>
                  시작하기
                </button>
                <span style={{ fontSize: 12, color: 'rgba(190, 210, 235, 0.45)' }}>
                  우측 상단 ? 버튼으로 다시 열 수 있습니다.
                </span>
              </div>
            </div>
          </div>
        ) : null}
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
