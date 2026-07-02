import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';

const STATUS_OPTIONS = ['Idle', 'Flying', 'Charging', 'Returning'];
const MAX_GRID_DIM = 25;
const DEFAULT_ALTITUDE = 0;

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

const cellKey = (col, row) => `${col},${row}`;

/** 화면 위= X+, 오른쪽= Y+ (Z=고도) */
const gridCellToWorldPosition = (col, row, cols, rows, spacing, altitude = DEFAULT_ALTITUDE) => {
  const totalX = (rows - 1) * spacing;
  const totalY = (cols - 1) * spacing;
  const startX = -totalX / 2;
  const startY = -totalY / 2;
  const x = startX + (rows - 1 - row) * spacing;
  const y = startY + col * spacing;
  return [x, y, altitude];
};

const buildGridPositions = (cols, rows, spacing, altitude = DEFAULT_ALTITUDE) => {
  const positions = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      positions.push(gridCellToWorldPosition(col, row, cols, rows, spacing, altitude));
    }
  }

  return positions;
};

const buildManualPositions = (selectedCells, cols, rows, spacing, altitude = DEFAULT_ALTITUDE) => {
  return [...selectedCells]
    .sort((a, b) => {
      const [ac, ar] = a.split(',').map(Number);
      const [bc, br] = b.split(',').map(Number);
      return ar - br || ac - bc;
    })
    .map((key) => {
      const [col, row] = key.split(',').map(Number);
      return gridCellToWorldPosition(col, row, cols, rows, spacing, altitude);
    });
};

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

function GridPreview({ cols, rows, mode, selectedCells, onToggleCell }) {
  const activeKeys = useMemo(() => {
    if (mode === 'auto') {
      const keys = new Set();
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          keys.add(cellKey(col, row));
        }
      }
      return keys;
    }
    return selectedCells;
  }, [cols, rows, mode, selectedCells]);

  const dotCount = activeKeys.size;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 280,
      }}
    >
      <div
        style={{
          fontSize: 11,
          opacity: 0.58,
          marginBottom: 10,
        }}
      >
        {mode === 'auto'
          ? '자동으로 그리드 전체에 배치됩니다'
          : '그리드를 클릭해 드론 위치를 지정하세요'}
      </div>

      <div
        style={{
          flex: 1,
          position: 'relative',
          borderRadius: 12,
          border: '1px solid rgba(130, 190, 255, 0.14)',
          background:
            'radial-gradient(circle at 50% 40%, rgba(46, 120, 220, 0.12), rgba(8, 12, 20, 0.92))',
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* 축: 위=X+, 오른쪽=Y+ */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 10,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              color: 'rgba(255, 90, 90, 0.85)',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <span style={{ lineHeight: 1 }}>↑</span>
            <span style={{ marginTop: 2 }}>x+</span>
          </div>
          <div
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: 'rgba(255, 90, 90, 0.85)',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <span>y+</span>
            <span>→</span>
          </div>
        </div>

        <div
          style={{
            width: '100%',
            maxWidth: 280,
            aspectRatio: '1 / 1',
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
            gap: Math.max(2, Math.min(6, 14 - Math.max(cols, rows) * 0.3)),
          }}
        >
          {Array.from({ length: rows }).map((_, row) =>
            Array.from({ length: cols }).map((__, col) => {
              const key = cellKey(col, row);
              const active = activeKeys.has(key);
              const clickable = mode === 'manual';

              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`그리드 ${col + 1}, ${row + 1}${active ? ' (선택됨)' : ''}`}
                  onClick={() => clickable && onToggleCell?.(col, row)}
                  style={{
                    border: 'none',
                    padding: 0,
                    margin: 0,
                    background: 'transparent',
                    cursor: clickable ? 'pointer' : 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    style={{
                      width: '72%',
                      height: '72%',
                      borderRadius: '50%',
                      background: active
                        ? 'radial-gradient(circle, #7ec8ff 0%, #3b82f6 55%, #1d4ed8 100%)'
                        : 'rgba(255,255,255,0.06)',
                      boxShadow: active
                        ? '0 0 10px rgba(78, 168, 255, 0.85), 0 0 18px rgba(59, 130, 246, 0.45)'
                        : 'none',
                      border: active
                        ? '1px solid rgba(180, 220, 255, 0.55)'
                        : '1px solid rgba(255,255,255,0.08)',
                      transition: 'all 0.15s ease',
                      transform: active ? 'scale(1)' : 'scale(0.85)',
                      opacity: active ? 1 : mode === 'manual' ? 0.45 : 0.9,
                    }}
                  />
                </button>
              );
            })
          )}
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
        <strong style={{ color: '#7ec8ff', fontSize: 14 }}>{dotCount}</strong> 대
      </div>
    </div>
  );
}

GridPreview.propTypes = {
  cols: PropTypes.number.isRequired,
  rows: PropTypes.number.isRequired,
  mode: PropTypes.oneOf(['auto', 'manual']).isRequired,
  selectedCells: PropTypes.instanceOf(Set),
  onToggleCell: PropTypes.func,
};

export default function AddDroneModal({ open, onClose, onAdd, existingIds }) {
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
        const [col, row] = key.split(',').map(Number);
        if (col < safeGridX && row < safeGridY) next.add(key);
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

  const handleToggleCell = (col, row) => {
    const key = cellKey(col, row);
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
      positions = buildManualPositions(manualCells, safeGridX, safeGridY, safeSpacing);
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
              그리드로 한 번에 배치하거나 직접 찍어서 배치
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
                    ariaLabel="가로"
                  />
                  <div style={{ fontSize: 10, opacity: 0.45, marginTop: 4, textAlign: 'center' }}>
                    가로 {safeGridX}
                  </div>
                </div>
                <span style={{ opacity: 0.4, fontSize: 14, paddingTop: 4 }}>×</span>
                <div style={{ flex: 1 }}>
                  <NumberStepper
                    value={safeGridY}
                    onChange={setGridY}
                    ariaLabel="세로"
                  />
                  <div style={{ fontSize: 10, opacity: 0.45, marginTop: 4, textAlign: 'center' }}>
                    세로 {safeGridY}
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

          {/* Right: preview */}
          <GridPreview
            cols={safeGridX}
            rows={safeGridY}
            mode={mode}
            selectedCells={manualCells}
            onToggleCell={handleToggleCell}
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
            {safeGridX} × {safeGridY} grid · {safeSpacing}m
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
};
