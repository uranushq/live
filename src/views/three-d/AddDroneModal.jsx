import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';

import Colors from '~/components/colors';

import GridSatelliteGround from './GridSatelliteGround';
import { fitIsoView, isoRaw } from './utils/isoProjection';

const STATUS_OPTIONS = ['Idle', 'Flying', 'Charging', 'Returning'];
const MAX_GRID_DIM = 25;
/** 초기 배치는 항상 지면(z = 0) — 3D 뷰의 XY 평면 위에 놓인다. */
const DEFAULT_ALTITUDE = 0;

/** 3D 뷰 CoordinateSystemAxes와 동일한 축 색 */
const AXIS_COLORS = { x: Colors.axes.x, y: Colors.axes.y };

const clampInt = (value, min, max) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};

const clampSpacing = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(100, n);
};

/** 셀 좌표는 월드 축과 그대로 대응한다: ix = +X 칸수, iy = +Y 칸수 */
const cellKey = (ix, iy) => `${ix},${iy}`;
const parseCellKey = (key) => {
  const [ix, iy] = key.split(',').map(Number);
  return { ix, iy };
};

/**
 * 격자는 월드 원점에서 시작해 +X · +Y 방향으로 자란다 (z = 0).
 * 3D 뷰와 같은 좌표계라서 미리보기에서 본 자리에 그대로 놓인다.
 */
const gridCellToWorldPosition = (ix, iy, spacing, altitude = DEFAULT_ALTITUDE) => [
  ix * spacing,
  iy * spacing,
  altitude,
];

/** +X 방향을 먼저 채우고 한 칸씩 +Y로 넘어간다 (드론 번호 순서) */
const buildGridPositions = (countX, countY, spacing, altitude = DEFAULT_ALTITUDE) => {
  const positions = [];

  for (let iy = 0; iy < countY; iy += 1) {
    for (let ix = 0; ix < countX; ix += 1) {
      positions.push(gridCellToWorldPosition(ix, iy, spacing, altitude));
    }
  }

  return positions;
};

const buildManualPositions = (selectedCells, spacing, altitude = DEFAULT_ALTITUDE) =>
  [...selectedCells]
    .map(parseCellKey)
    .sort((a, b) => a.iy - b.iy || a.ix - b.ix)
    .map(({ ix, iy }) => gridCellToWorldPosition(ix, iy, spacing, altitude));

const generateDroneBatch = ({
  positions,
  existingIds,
  namePrefix,
  battery,
  status,
}) => {
  const ids = new Set(existingIds || []);
  const drones = [];
  const prefix = namePrefix.trim() || 'Drone';
  let serial = 1;

  const nextUniqueId = () => {
    let idx = (existingIds?.length || 0) + drones.length + 1;
    let candidate = `drone-${idx}`;
    while (ids.has(candidate)) {
      idx += 1;
      candidate = `drone-${idx}`;
    }
    ids.add(candidate);
    return candidate;
  };

  positions.forEach((pos) => {
    const id = nextUniqueId();
    drones.push({
      id,
      name: `${prefix}-${serial}`,
      battery,
      status,
      pos,
      initialPos: pos.slice(),
      path: [],
    });
    serial += 1;
  });

  return drones;
};

const modalOverlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 20000,
  background: 'rgba(6, 10, 16, 0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const modalStyle = {
  background: 'linear-gradient(165deg, rgba(18, 24, 36, 0.98), rgba(11, 16, 26, 0.96))',
  borderRadius: 16,
  color: '#f3f8ff',
  width: 'min(760px, 100%)',
  maxHeight: 'calc(100vh - 32px)',
  border: '1px solid rgba(126, 200, 255, 0.22)',
  boxShadow: '0 20px 48px rgba(0, 0, 0, 0.48)',
  overflowY: 'auto',
};

const fieldLabelStyle = {
  fontSize: 11,
  opacity: 0.68,
  marginBottom: 6,
  letterSpacing: 0.2,
};

const fieldInputStyle = {
  width: '100%',
  background: 'rgba(245, 250, 255, 0.06)',
  border: '1px solid rgba(130, 190, 255, 0.2)',
  borderRadius: 8,
  color: '#ecf5ff',
  padding: '9px 10px',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

function NumberStepper({ value, onChange, min = 1, max = MAX_GRID_DIM, ariaLabel }) {
  const safe = clampInt(value, min, max);

  const step = (delta) => {
    onChange(clampInt(safe + delta, min, max));
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(245, 250, 255, 0.06)',
        border: '1px solid rgba(130, 190, 255, 0.2)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        aria-label={`${ariaLabel} 감소`}
        onClick={() => step(-1)}
        disabled={safe <= min}
        style={{
          width: 34,
          height: 38,
          border: 'none',
          background: 'transparent',
          color: safe <= min ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.75)',
          cursor: safe <= min ? 'not-allowed' : 'pointer',
          fontSize: 16,
        }}
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={safe}
        aria-label={ariaLabel}
        onChange={(e) => onChange(clampInt(e.target.value, min, max))}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          background: 'transparent',
          color: '#ecf5ff',
          textAlign: 'center',
          fontSize: 14,
          fontWeight: 600,
          outline: 'none',
          MozAppearance: 'textfield',
        }}
      />
      <button
        type="button"
        aria-label={`${ariaLabel} 증가`}
        onClick={() => step(1)}
        disabled={safe >= max}
        style={{
          width: 34,
          height: 38,
          border: 'none',
          background: 'transparent',
          color: safe >= max ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.75)',
          cursor: safe >= max ? 'not-allowed' : 'pointer',
          fontSize: 16,
        }}
      >
        +
      </button>
    </div>
  );
}

NumberStepper.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  onChange: PropTypes.func.isRequired,
  min: PropTypes.number,
  max: PropTypes.number,
  ariaLabel: PropTypes.string,
};

const wrapYaw = (value) => {
  let next = Math.round(value) % 360;
  if (next < 0) next += 360;
  return next;
};

/**
 * 3D 뷰와 같은 등축 시선으로 배치를 미리 보여주는 지면 뷰.
 * 위성 사진 바닥 · 월드 원점 · +X/+Y 축이 함께 보이므로, 여기서 본 자리가
 * 실제 3D 뷰에서 드론이 놓이는 자리다.
 */
function PlacementPreview({
  countX,
  countY,
  spacing,
  mode,
  selectedCells,
  onToggleCell,
  existingDrones,
}) {
  const viewRef = useRef(null);
  const orbitRef = useRef(null);
  const [size, setSize] = useState({ w: 320, h: 300 });
  const [yaw, setYaw] = useState(35);
  const [zoom, setZoom] = useState(1);
  const [orbiting, setOrbiting] = useState(false);

  useEffect(() => {
    const el = viewRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    });
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    setSize({ w: rect.width, h: rect.height });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!orbitRef.current) return;
      setYaw(wrapYaw(orbitRef.current.startYaw + (e.clientX - orbitRef.current.startX) * 0.45));
    };
    const onUp = () => {
      if (!orbitRef.current) return;
      orbitRef.current = null;
      setOrbiting(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return undefined;

    const onWheel = (e) => {
      e.preventDefault();
      const step = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((z) => Math.min(2.4, Math.max(0.5, Math.round((z + step) * 10) / 10)));
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const spanX = Math.max(0, countX - 1) * spacing;
  const spanY = Math.max(0, countY - 1) * spacing;

  const fit = useMemo(() => {
    const pad = spacing * 1.2;
    const points = [{ x: 0, y: 0, z: 0 }];
    for (const x of [-pad, spanX + pad]) {
      for (const y of [-pad, spanY + pad]) {
        points.push({ x, y, z: 0 });
      }
    }

    return fitIsoView({
      points,
      yaw,
      zoom,
      width: size.w,
      height: size.h,
      padX: 26,
      padTop: 26,
      padBottom: 26,
    });
  }, [size, spacing, spanX, spanY, yaw, zoom]);

  const project = useCallback(
    (x, y, z) => {
      const r = isoRaw(x, y, z, yaw);
      return { px: fit.ox + r.u * fit.s, py: fit.oy + r.v * fit.s };
    },
    [fit, yaw]
  );

  const cells = useMemo(() => {
    const list = [];
    let serial = 0;
    for (let iy = 0; iy < countY; iy += 1) {
      for (let ix = 0; ix < countX; ix += 1) {
        const key = cellKey(ix, iy);
        const active = mode === 'auto' || selectedCells.has(key);
        if (active) serial += 1;
        const p = project(ix * spacing, iy * spacing, 0);
        list.push({ key, ix, iy, active, order: active ? serial : null, ...p });
      }
    }
    return list;
  }, [countX, countY, mode, project, selectedCells, spacing]);

  const activeCount = cells.filter((c) => c.active).length;

  // 격자 바닥 선 (칸 경계가 아니라 열·행을 잇는 선 — 방향을 읽기 쉽게)
  const gridLines = useMemo(() => {
    const lines = [];
    for (let ix = 0; ix < countX; ix += 1) {
      const a = project(ix * spacing, 0, 0);
      const b = project(ix * spacing, spanY, 0);
      lines.push({ key: `x${ix}`, x1: a.px, y1: a.py, x2: b.px, y2: b.py });
    }
    for (let iy = 0; iy < countY; iy += 1) {
      const a = project(0, iy * spacing, 0);
      const b = project(spanX, iy * spacing, 0);
      lines.push({ key: `y${iy}`, x1: a.px, y1: a.py, x2: b.px, y2: b.py });
    }
    return lines;
  }, [countX, countY, project, spacing, spanX, spanY]);

  const axes = useMemo(() => {
    const origin = project(0, 0, 0);
    const length = Math.max(spacing * 1.6, Math.max(spanX, spanY) * 0.28);
    return {
      origin,
      x: { ...project(length, 0, 0), color: AXIS_COLORS.x, label: '+X' },
      y: { ...project(0, length, 0), color: AXIS_COLORS.y, label: '+Y' },
    };
  }, [project, spacing, spanX, spanY]);

  const ghosts = useMemo(
    () =>
      (Array.isArray(existingDrones) ? existingDrones : []).map((d, index) => ({
        key: `${d.id ?? index}`,
        ...project(d.x, d.y, d.z),
      })),
    [existingDrones, project]
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 300,
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.58, marginBottom: 10 }}>
        {mode === 'auto'
          ? '3D 뷰와 같은 시선 · z=0 지면에 +X · +Y 방향으로 배치됩니다'
          : '지면 격자를 클릭해 놓을 자리를 지정하세요 (배경 드래그로 회전)'}
      </div>

      <div
        ref={viewRef}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const tag = String(e.target.tagName || '').toLowerCase();
          if (tag === 'circle' && e.target.dataset?.cell) return;
          e.preventDefault();
          orbitRef.current = { startX: e.clientX, startYaw: yaw };
          setOrbiting(true);
        }}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 12,
          border: '1px solid rgba(130, 190, 255, 0.14)',
          backgroundColor: 'rgba(8, 12, 20, 0.92)',
          backgroundImage:
            'linear-gradient(rgba(80, 120, 180, 0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(80, 120, 180, 0.07) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
          cursor: orbiting ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
      >
        <GridSatelliteGround project={project} />

        <svg
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}
        >
          {gridLines.map((l) => (
            <line
              key={l.key}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="rgba(120, 170, 225, 0.28)"
              strokeWidth="1"
            />
          ))}

          {/* 기존 드론 — 겹치지 않게 참고만 */}
          {ghosts.map((g) => (
            <circle
              key={`ghost-${g.key}`}
              cx={g.px}
              cy={g.py}
              r="3.4"
              fill="rgba(190, 198, 210, 0.5)"
              stroke="rgba(230, 236, 245, 0.4)"
              strokeWidth="1"
            />
          ))}

          {[axes.x, axes.y].map((axis) => (
            <g key={axis.label}>
              <line
                x1={axes.origin.px}
                y1={axes.origin.py}
                x2={axis.px}
                y2={axis.py}
                stroke={axis.color}
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <text
                x={axis.px}
                y={axis.py}
                dx={(axis.px - axes.origin.px) * 0.12}
                dy={(axis.py - axes.origin.py) * 0.12}
                fill={axis.color}
                fontSize="10"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {axis.label}
              </text>
            </g>
          ))}
          <circle
            cx={axes.origin.px}
            cy={axes.origin.py}
            r="2.6"
            fill="#fff"
            stroke="rgba(200, 220, 255, 0.85)"
            strokeWidth="1.2"
          />

          {cells.map((cell) => (
            <g key={cell.key}>
              <circle
                cx={cell.px}
                cy={cell.py}
                r={cell.active ? 4.6 : 3}
                fill={cell.active ? '#4ea8ff' : 'rgba(255,255,255,0.14)'}
                stroke={
                  cell.active ? 'rgba(200, 230, 255, 0.85)' : 'rgba(255,255,255,0.22)'
                }
                strokeWidth="1"
              />
              {mode === 'manual' ? (
                <circle
                  cx={cell.px}
                  cy={cell.py}
                  r="9"
                  fill="transparent"
                  data-cell={cell.key}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleCell?.(cell.ix, cell.iy);
                  }}
                >
                  <title>{`X ${cell.ix * spacing}m · Y ${cell.iy * spacing}m`}</title>
                </circle>
              ) : null}
              {cell.order === 1 ? (
                <text
                  x={cell.px + 8}
                  y={cell.py - 6}
                  fill="rgba(200, 230, 255, 0.9)"
                  fontSize="9"
                  fontWeight="700"
                >
                  1
                </text>
              ) : null}
            </g>
          ))}
        </svg>

        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: 6,
            fontSize: 10,
            color: 'rgba(236, 245, 255, 0.45)',
            pointerEvents: 'none',
          }}
        >
          {yaw}° / {zoom.toFixed(1)}× · 드래그 회전 · 휠 확대
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          textAlign: 'right',
          fontSize: 12,
          color: 'rgba(236, 245, 255, 0.72)',
        }}
      >
        생성할 드론{' '}
        <strong style={{ color: '#7ec8ff', fontSize: 14 }}>{activeCount}</strong> 대
      </div>
    </div>
  );
}

PlacementPreview.propTypes = {
  countX: PropTypes.number.isRequired,
  countY: PropTypes.number.isRequired,
  spacing: PropTypes.number.isRequired,
  mode: PropTypes.oneOf(['auto', 'manual']).isRequired,
  selectedCells: PropTypes.instanceOf(Set),
  onToggleCell: PropTypes.func,
  existingDrones: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      x: PropTypes.number,
      y: PropTypes.number,
      z: PropTypes.number,
    })
  ),
};

export default function AddDroneModal({
  open,
  onClose,
  onAdd,
  existingIds,
  existingDrones,
}) {
  const [mode, setMode] = useState('auto');
  const [gridX, setGridX] = useState(10);
  const [gridY, setGridY] = useState(10);
  const [spacing, setSpacing] = useState('5');
  const [namePrefix, setNamePrefix] = useState('Drone');
  const [battery, setBattery] = useState('100');
  const [status, setStatus] = useState('Idle');
  const [manualCells, setManualCells] = useState(() => new Set());
  const [error, setError] = useState('');

  const safeGridX = clampInt(gridX, 1, MAX_GRID_DIM);
  const safeGridY = clampInt(gridY, 1, MAX_GRID_DIM);
  const safeSpacing = clampSpacing(spacing);

  useEffect(() => {
    if (!open) return;
    setMode('auto');
    setGridX(10);
    setGridY(10);
    setSpacing('5');
    setNamePrefix('Drone');
    setBattery('100');
    setStatus('Idle');
    setManualCells(new Set());
    setError('');
  }, [open]);

  useEffect(() => {
    setManualCells((prev) => {
      const next = new Set();
      prev.forEach((key) => {
        const { ix, iy } = parseCellKey(key);
        if (ix < safeGridX && iy < safeGridY) next.add(key);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [safeGridX, safeGridY]);

  const droneCount = useMemo(() => {
    if (mode === 'auto') return safeGridX * safeGridY;
    return manualCells.size;
  }, [mode, safeGridX, safeGridY, manualCells.size]);

  const isValid = useMemo(() => {
    if (!namePrefix.trim()) return false;
    if (mode === 'manual') return manualCells.size > 0;
    return safeGridX > 0 && safeGridY > 0;
  }, [namePrefix, mode, manualCells.size, safeGridX, safeGridY]);

  if (!open) return null;

  const handleToggleCell = (ix, iy) => {
    const key = cellKey(ix, iy);
    setManualCells((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAdd = () => {
    setError('');

    const prefix = namePrefix.trim();
    if (!prefix) {
      setError('이름 접두어를 입력해주세요.');
      return;
    }

    const bat = Number(battery);
    const safeBat = Number.isFinite(bat) ? Math.min(100, Math.max(0, bat)) : 100;

    let positions = [];
    if (mode === 'auto') {
      positions = buildGridPositions(safeGridX, safeGridY, safeSpacing);
    } else {
      if (manualCells.size === 0) {
        setError('그리드에서 최소 1개 이상의 위치를 선택해주세요.');
        return;
      }
      positions = buildManualPositions(manualCells, safeSpacing);
    }

    const drones = generateDroneBatch({
      positions,
      existingIds,
      namePrefix: prefix,
      battery: safeBat,
      status,
    });

    if (!drones.length) {
      setError('생성할 드론이 없습니다.');
      return;
    }

    onAdd(drones);
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
  };

  return ReactDOM.createPortal(
    <div
      style={modalOverlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={modalStyle} onKeyDown={handleKeyDown} role="dialog" aria-modal="true">
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '20px 22px 0',
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 17,
                fontWeight: 700,
              }}
            >
              <span style={{ fontSize: 18, opacity: 0.9 }}>✈</span>
              드론 추가
            </div>
            <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>
              3D 뷰와 같은 지면(z=0)에 배치 · 원점에서 +X · +Y 방향
            </div>
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{ padding: '16px 22px 0', display: 'flex', gap: 8 }}>
          {[
            { id: 'auto', label: '자동 그리드', icon: '▦' },
            { id: 'manual', label: '직접 배치', icon: '+' },
          ].map(({ id, label, icon }) => {
            const selected = mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: selected
                    ? '1px solid rgba(78, 168, 255, 0.5)'
                    : '1px solid rgba(255,255,255,0.1)',
                  background: selected
                    ? 'linear-gradient(135deg, #4ea8ff, #2a79d9)'
                    : 'rgba(255,255,255,0.04)',
                  color: selected ? '#fff' : 'rgba(255,255,255,0.72)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: selected ? 600 : 500,
                }}
              >
                <span style={{ fontSize: 14, opacity: 0.9 }}>{icon}</span>
                {label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 20,
            padding: '18px 22px 0',
          }}
        >
          {/* Left: settings */}
          <div>
            <div style={{ marginBottom: 14 }}>
              <div style={fieldLabelStyle}>그리드 (X × Y)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <NumberStepper
                    value={safeGridX}
                    onChange={setGridX}
                    ariaLabel="X 방향 개수"
                  />
                  <div
                    style={{
                      fontSize: 10,
                      marginTop: 4,
                      textAlign: 'center',
                      color: AXIS_COLORS.x,
                      opacity: 0.85,
                    }}
                  >
                    +X {safeGridX}대
                  </div>
                </div>
                <span style={{ opacity: 0.4, fontSize: 14, paddingTop: 4 }}>×</span>
                <div style={{ flex: 1 }}>
                  <NumberStepper
                    value={safeGridY}
                    onChange={setGridY}
                    ariaLabel="Y 방향 개수"
                  />
                  <div
                    style={{
                      fontSize: 10,
                      marginTop: 4,
                      textAlign: 'center',
                      color: AXIS_COLORS.y,
                      opacity: 0.85,
                    }}
                  >
                    +Y {safeGridY}대
                  </div>
                </div>
              </div>
            </div>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <div style={fieldLabelStyle}>간격 (m)</div>
              <input
                type="number"
                min="0.1"
                step="0.5"
                value={spacing}
                onChange={(e) => setSpacing(e.target.value)}
                style={fieldInputStyle}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <div style={fieldLabelStyle}>이름 접두어</div>
              <input
                value={namePrefix}
                onChange={(e) => setNamePrefix(e.target.value)}
                placeholder="Drone"
                style={fieldInputStyle}
              />
              <div style={{ fontSize: 10, opacity: 0.42, marginTop: 4 }}>
                {namePrefix.trim() || 'Drone'}-1, {namePrefix.trim() || 'Drone'}-2 …
              </div>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'block' }}>
                <div style={fieldLabelStyle}>배터리 %</div>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={battery}
                  onChange={(e) => setBattery(e.target.value)}
                  style={fieldInputStyle}
                />
              </label>
              <label style={{ display: 'block' }}>
                <div style={fieldLabelStyle}>상태</div>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  style={{ ...fieldInputStyle, cursor: 'pointer' }}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s} style={{ background: '#1a1a2e' }}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Right: 3D 뷰와 같은 시선의 배치 미리보기 */}
          <PlacementPreview
            countX={safeGridX}
            countY={safeGridY}
            spacing={safeSpacing}
            mode={mode}
            selectedCells={manualCells}
            onToggleCell={handleToggleCell}
            existingDrones={existingDrones}
          />
        </div>

        {error && (
          <div
            style={{
              margin: '14px 22px 0',
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(255, 80, 80, 0.12)',
              border: '1px solid rgba(255, 80, 80, 0.35)',
              color: '#ff9090',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 22px 20px',
            marginTop: 8,
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.45 }}>
            {safeGridX} × {safeGridY} grid · {safeSpacing}m · z=0 지면, 원점에서 +X ·
            +Y 방향
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 18px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.05)',
                color: 'rgba(243,248,255,0.86)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!isValid}
              style={{
                padding: '9px 20px',
                borderRadius: 8,
                border: 'none',
                background: isValid
                  ? 'linear-gradient(135deg, #4ea8ff, #2a79d9)'
                  : 'rgba(255,255,255,0.1)',
                color: isValid ? '#ffffff' : 'rgba(255,255,255,0.35)',
                cursor: isValid ? 'pointer' : 'not-allowed',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              + {droneCount} 대 추가
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

AddDroneModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onAdd: PropTypes.func.isRequired,
  existingIds: PropTypes.arrayOf(PropTypes.string),
  /** 이미 있는 드론의 현재 위치 — 미리보기에 회색 점으로 겹쳐 보여준다 */
  existingDrones: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      x: PropTypes.number,
      y: PropTypes.number,
      z: PropTypes.number,
    })
  ),
};
