import Add from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import GpsFixed from '@mui/icons-material/GpsFixed';
import Groups from '@mui/icons-material/Groups';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp';
import LinkOff from '@mui/icons-material/LinkOff';
import NearMe from '@mui/icons-material/NearMe';
import Replay from '@mui/icons-material/Replay';
import Send from '@mui/icons-material/Send';
import Tooltip from '@mui/material/Tooltip';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import {
  DRONE_PATH_FLUSH_REQUEST,
  getPathPointArrivalTimesMs,
  toFiniteDurationMs,
  toFiniteHoldMs,
} from './utils/threeDViewUtils';

// 첫 번째 항목 ''은 "백엔드 기본값(.skyc 다운로드) 사용". payload에서 output 키를 생략.
const FORMATION_OUTPUT_OPTIONS = [
  { value: '', label: '(기본값) skyc 다운로드' },
  { value: 'path', label: 'path (디버그 JSON)' },
  { value: 'show', label: 'show' },
  { value: 'skyc', label: 'skyc (명시)' },
];

const formationPositionDraftKey = (phaseId, droneId, axis) =>
  `${phaseId}:${droneId}:${axis}`;

const isPartialDecimalInput = (raw) => raw === '' || /^-?\d*\.?\d*$/.test(raw);

/** phase.points에 이미 들어 있는 축만 복사 (부분 입력 시 다른 축이 사라지지 않게) */
const copyCapturedFormationAxes = (captured) => {
  const next = {};
  if (!captured || typeof captured !== 'object') return next;
  const x = Number(captured.x);
  const y = Number(captured.y);
  const z = Number(captured.z);
  const yaw = Number(captured.yaw);
  if (Number.isFinite(x)) next.x = x;
  if (Number.isFinite(y)) next.y = y;
  if (Number.isFinite(z)) next.z = z;
  if (Number.isFinite(yaw)) next.yaw = yaw;
  return next;
};

const formationSurfaceStyle = {
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.03)',
};

const formationIconBtnStyle = {
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.5)',
};

function FormationIconButton({
  title,
  onClick,
  disabled = false,
  size = 26,
  children,
}) {
  return (
    <Tooltip title={title} placement="top">
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            padding: 0,
            borderRadius: 6,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.3 : 1,
            ...formationIconBtnStyle,
          }}
        >
          {React.cloneElement(children, {
            sx: { fontSize: size <= 26 ? 15 : 17, color: 'inherit' },
          })}
        </button>
      </span>
    </Tooltip>
  );
}

FormationIconButton.propTypes = {
  title: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  size: PropTypes.number,
  children: PropTypes.element.isRequired,
};

const resolveFormationDroneId = (drone, droneIds, formationPhases) => {
  const fromSelection =
    drone?.id != null && String(drone.id).trim() !== '' ? String(drone.id) : '';
  if (fromSelection) return fromSelection;
  if (Array.isArray(droneIds) && droneIds.length) {
    const first = droneIds.find((id) => id != null && String(id).trim() !== '');
    if (first != null) return String(first);
  }
  for (const phase of formationPhases) {
    const keys = Object.keys(phase?.points || {});
    if (keys.length) return String(keys[0]);
  }
  return '';
};

export default function DroneInfoPanel({
  open,
  drone,
  onClose,
  droneCount = 0,
  droneIds = [],
  formationPhases = [],
  formationSettings = null,
  isSendingFormation = false,
  formationDeliveryStatus = '',
  onAddFormationPhase = () => {},
  onRemoveFormationPhase = () => {},
  onMoveFormationPhase = () => {},
  onUpdateFormationPhaseMeta = () => {},
  onUpdateFormationDronePosition = () => {},
  onCaptureDronePositionInPhase = () => {},
  onCaptureAllPositionsInPhase = () => {},
  onApplyDronePositionInPhase = () => {},
  onApplyAllDronesInPhase = () => {},
  onUpdateFormationSettings = () => {},
  onSendFormationPlan = () => {},
  onDownloadSkyc = () => {},
  isDownloadingSkyc = false,
  skycDownloadStatus = '',
}) {
  const [activeTab, setActiveTab] = useState('path');
  const [pathPoints, setPathPoints] = useState([
    { x: '', y: '', z: '', durationMs: 0, holdMs: 0, highlighted: false },
  ]);
  const [initialFields, setInitialFields] = useState({ ix: '', iy: '', iz: '' });
  const [formationPositionDrafts, setFormationPositionDrafts] = useState({});
  const [formationSettingsDrafts, setFormationSettingsDrafts] = useState({});

  // 드론 바뀔 때 경로 초기화 / JSON에서 path가 오면 반영
  useEffect(() => {
    if (drone && Array.isArray(drone.path) && drone.path.length) {
      setPathPoints(
        drone.path.map((p, index) => {
          const row = {
            x: String(p.x ?? ''),
            y: String(p.y ?? ''),
            z: String(p.z ?? ''),
            durationMs: toFiniteDurationMs(p.durationMs, index === 0 ? 0 : 1000),
            holdMs: toFiniteHoldMs(p.holdMs, 0),
            highlighted: Boolean(p.highlighted),
          };
          if (Number.isFinite(Number(p.yaw))) {
            row.yaw = String(p.yaw);
          }
          return row;
        })
      );
    } else {
      setPathPoints([{ x: '', y: '', z: '', durationMs: 0, holdMs: 0, highlighted: false }]);
    }
  }, [drone?.id, drone?.path]);

  const initialPositionSyncKey = useMemo(() => {
    const ip = drone?.initialPosition;
    if (!ip) return '';
    const a = Number(ip.x);
    const b = Number(ip.y);
    const c = Number(ip.z);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return '';
    return `${a},${b},${c}`;
  }, [drone?.initialPosition]);

  useEffect(() => {
    if (!drone?.id) return;
    const ip = drone.initialPosition;
    if (
      ip &&
      Number.isFinite(Number(ip.x)) &&
      Number.isFinite(Number(ip.y)) &&
      Number.isFinite(Number(ip.z))
    ) {
      setInitialFields({
        ix: String(ip.x),
        iy: String(ip.y),
        iz: String(ip.z),
      });
      return;
    }
    const cp = drone.currentPosition;
    if (
      cp &&
      Number.isFinite(Number(cp.x)) &&
      Number.isFinite(Number(cp.y)) &&
      Number.isFinite(Number(cp.z))
    ) {
      setInitialFields({
        ix: String(cp.x),
        iy: String(cp.y),
        iz: String(cp.z),
      });
      return;
    }
    setInitialFields({ ix: '0', iy: '1', iz: '1' });
  }, [drone?.id, initialPositionSyncKey]);

  useEffect(() => {
    setFormationPositionDrafts({});
    setFormationSettingsDrafts({});
  }, [drone?.id]);

  const isPathPointRowValid = (p) => {
    if (
      p.x === undefined ||
      p.y === undefined ||
      p.z === undefined ||
      String(p.x).trim() === '' ||
      String(p.y).trim() === '' ||
      String(p.z).trim() === ''
    ) {
      return false;
    }

    const nx = Number(p.x);
    const ny = Number(p.y);
    const nz = Number(p.z);

    return Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz);
  };

  const pathPointArrivalMsByRow = useMemo(() => {
    const rows = Array.isArray(pathPoints) ? pathPoints : [];
    const validRows = [];
    const rowIndexMap = [];

    rows.forEach((p, rowIdx) => {
      if (!isPathPointRowValid(p)) return;
      rowIndexMap.push(rowIdx);
      validRows.push({
        x: Number(p.x),
        y: Number(p.y),
        z: Number(p.z),
        durationMs: toFiniteDurationMs(p.durationMs, validRows.length === 0 ? 0 : 1000),
        holdMs: toFiniteHoldMs(p.holdMs, 0),
      });
    });

    const arrivals = getPathPointArrivalTimesMs(validRows);
    const result = rows.map(() => null);
    rowIndexMap.forEach((rowIdx, validIdx) => {
      result[rowIdx] = arrivals[validIdx];
    });
    return result;
  }, [pathPoints]);

  const canPlayPath = useMemo(() => {
    if (!drone?.id) return false;

    return pathPoints.some((p) => {
      const hasAll =
        p.x !== undefined &&
        p.y !== undefined &&
        p.z !== undefined &&
        String(p.x).trim() !== '' &&
        String(p.y).trim() !== '' &&
        String(p.z).trim() !== '';

      if (!hasAll) return false;

      const nx = Number(p.x);
      const ny = Number(p.y);
      const nz = Number(p.z);

      return Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz);
    });
  }, [drone?.id, pathPoints]);

  const updatePathPoint = (index, key, value) => {
    setPathPoints((prev) => prev.map((p, i) => (i === index ? { ...p, [key]: value } : p)));
  };

  const updatePathPointMs = (index, key, raw) => {
    if (raw === '') {
      updatePathPoint(index, key, '');
      return;
    }
    const n = Number(raw);
    updatePathPoint(index, key, Number.isFinite(n) && n >= 0 ? n : raw);
  };

  const addPathPoint = () => {
    setPathPoints((prev) => {
      const last = Array.isArray(prev) && prev.length ? prev[prev.length - 1] : null;
      const durationMs = last ? toFiniteDurationMs(last.durationMs, 1000) : 1000;
      const next = [
        ...prev,
        { x: '', y: '', z: '', durationMs, holdMs: 0, highlighted: false },
      ];
      queueMicrotask(() => syncPathToConfig(next));
      return next;
    });
  };

  const addCurrentPositionPathPoint = () => {
    if (!drone?.id || typeof document === 'undefined') return;

    const safeId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(drone.id)
        : drone.id;
    const target = document.querySelector(`a-scene [data-drone-id="${safeId}"]`);
    const pos = target?.getAttribute?.('position');
    if (!pos || typeof pos !== 'object') return;

    const nx = Number(pos.x);
    const ny = Number(pos.y);
    const nz = Number(pos.z);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) return;

    const formatCoord = (value) => String(Math.round(value * 1000) / 1000);
    setPathPoints((prev) => {
      const last = Array.isArray(prev) && prev.length ? prev[prev.length - 1] : null;
      const nextPoint = {
        x: formatCoord(nx),
        y: formatCoord(ny),
        z: formatCoord(nz),
        durationMs: last ? toFiniteDurationMs(last.durationMs, 1000) : 1000,
        holdMs: 0,
        highlighted: false,
      };

      // 기본 빈 1행만 있는 경우에는 교체하고, 아니면 맨 뒤에 추가
      let next;
      if (
        Array.isArray(prev) &&
        prev.length === 1 &&
        String(prev[0]?.x ?? '').trim() === '' &&
        String(prev[0]?.y ?? '').trim() === '' &&
        String(prev[0]?.z ?? '').trim() === ''
      ) {
        next = [nextPoint];
      } else {
        next = [...(Array.isArray(prev) ? prev : []), nextPoint];
      }
      queueMicrotask(() => syncPathToConfig(next));
      return next;
    });
  };

  const removePathPoint = (index) => {
    setPathPoints((prev) => {
      if (!Array.isArray(prev) || !prev.length) {
        const empty = [{ x: '', y: '', z: '', durationMs: 0, holdMs: 0, highlighted: false }];
        queueMicrotask(() => syncPathToConfig(empty));
        return empty;
      }

      const next = prev.filter((_, i) => i !== index);
      if (!next.length) {
        const empty = [{ x: '', y: '', z: '', durationMs: 0, holdMs: 0, highlighted: false }];
        queueMicrotask(() => syncPathToConfig(empty));
        return empty;
      }
      queueMicrotask(() => syncPathToConfig(next));
      return next;
    });
  };

  const buildPathPointsForConfig = useCallback(
    (source = pathPoints) =>
      source
        .filter((p) => isPathPointRowValid(p))
        .map((p, index) => {
          const point = {
            x: Number(p.x),
            y: Number(p.y),
            z: Number(p.z),
            durationMs: toFiniteDurationMs(p.durationMs, index === 0 ? 0 : 1000),
            holdMs: toFiniteHoldMs(p.holdMs, 0),
          };
          const yaw = Number(p.yaw);
          if (Number.isFinite(yaw)) {
            point.yaw = yaw;
          }
          if (p.highlighted) {
            point.highlighted = true;
          }
          return point;
        }),
    [pathPoints]
  );

  const syncPathToConfig = useCallback(
    (source = pathPoints) => {
      if (!drone?.id) return;

      const points = buildPathPointsForConfig(source);
      if (!points.length) return;

      window.dispatchEvent(
        new CustomEvent('drone-path-updated', {
          detail: {
            id: drone.id,
            path: points,
          },
        })
      );
    },
    [buildPathPointsForConfig, drone?.id, pathPoints]
  );

  useEffect(() => {
    const onFlush = () => syncPathToConfig();
    window.addEventListener(DRONE_PATH_FLUSH_REQUEST, onFlush);
    return () => window.removeEventListener(DRONE_PATH_FLUSH_REQUEST, onFlush);
  }, [syncPathToConfig]);

  const togglePathPointHighlight = (index) => {
    setPathPoints((prev) => {
      const next = prev.map((p, i) =>
        i === index ? { ...p, highlighted: !p.highlighted } : p
      );
      queueMicrotask(() => syncPathToConfig(next));
      return next;
    });
  };

  const requestPath = () => {
    if (!drone?.id) return;

    const points = buildPathPointsForConfig();
    if (!points.length) return;

    window.dispatchEvent(
      new CustomEvent('drone-path-request', {
        detail: {
          id: drone.id,
          points,
          durationPerSegment: 1000,
          startFromInitial: true,
        },
      })
    );

    // JSON 저장용으로 현재 경로를 ThreeDView에 알려줌
    window.dispatchEvent(
      new CustomEvent('drone-path-updated', {
        detail: {
          id: drone.id,
          path: points,
        },
      })
    );
  };

  const fillInitialFromCurrentPosition = () => {
    const pos = drone?.currentPosition;
    if (!pos) return;
    const px = Number(pos.x);
    const py = Number(pos.y);
    const pz = Number(pos.z);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
    setInitialFields({
      ix: String(Math.round(px * 1000) / 1000),
      iy: String(Math.round(py * 1000) / 1000),
      iz: String(Math.round(pz * 1000) / 1000),
    });
  };

  const applyInitialPosition = ({ moveDrone } = { moveDrone: false }) => {
    if (!drone?.id) return;
    const nx = Number(initialFields.ix);
    const ny = Number(initialFields.iy);
    const nz = Number(initialFields.iz);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) return;

    window.dispatchEvent(
      new CustomEvent('drone-initial-pos-set', {
        detail: { id: drone.id, x: nx, y: ny, z: nz },
      })
    );

    if (moveDrone) {
      window.dispatchEvent(
        new CustomEvent('drone-move-request', {
          detail: { id: drone.id, x: nx, y: ny, z: nz },
        })
      );
    }
  };

  const safeFormationSettings = formationSettings || {
    step_size: 1,
    duration_ms: 1000,
    takeoff_time: 0,
    auto_upload: false,
    output: '',
  };

  const renderPathTab = () => (
    <>
      <div style={{ marginTop: 2 }}>
        <div style={{ fontSize: 11, opacity: 0.45, marginBottom: 8 }}>Animation Path</div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: PATH_ROW_GRID_COLUMNS,
            gap: 4,
            alignItems: 'center',
            marginBottom: 4,
            fontSize: 10,
            opacity: 0.35,
            padding: '0 2px',
          }}
        >
          <span />
          <span style={{ textAlign: 'center' }}>#</span>
          <span>X</span>
          <span>Y</span>
          <span>Z</span>
          <span style={{ textAlign: 'center' }}>이동(ms)</span>
          <span style={{ textAlign: 'center' }}>대기(ms)</span>
          <span style={{ textAlign: 'center' }}>재생</span>
          <span />
        </div>

        {pathPoints.map((p, idx) => (
          <div
            key={idx}
            style={{
              display: 'grid',
              gridTemplateColumns: PATH_ROW_GRID_COLUMNS,
              gap: 4,
              alignItems: 'center',
              marginBottom: 4,
              fontSize: 12,
              padding: '2px 2px',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title="3D 경로에서 이 점을 빨간색으로 표시"
            >
              <input
                type="checkbox"
                checked={!!p.highlighted}
                onChange={() => togglePathPointHighlight(idx)}
                style={{ width: 14, height: 14, cursor: 'pointer' }}
              />
            </label>
            <div style={{ fontSize: 11, opacity: 0.6, textAlign: 'center' }}>
              {idx + 1}
            </div>

            <input
              value={p.x}
              onChange={(e) => updatePathPoint(idx, 'x', e.target.value)}
              onBlur={() => queueMicrotask(() => syncPathToConfig())}
              placeholder="X"
              inputMode="decimal"
              style={smallInputStyle}
            />
            <input
              value={p.y}
              onChange={(e) => updatePathPoint(idx, 'y', e.target.value)}
              onBlur={() => queueMicrotask(() => syncPathToConfig())}
              placeholder="Y"
              inputMode="decimal"
              style={smallInputStyle}
            />
            <input
              value={p.z}
              onChange={(e) => updatePathPoint(idx, 'z', e.target.value)}
              onBlur={() => queueMicrotask(() => syncPathToConfig())}
              placeholder="Z"
              inputMode="decimal"
              style={smallInputStyle}
            />
            <input
              value={p.durationMs === '' || p.durationMs === undefined ? '' : String(p.durationMs)}
              onChange={(e) => updatePathPointMs(idx, 'durationMs', e.target.value)}
              onBlur={() => queueMicrotask(() => syncPathToConfig())}
              placeholder={idx === 0 ? '0' : '1000'}
              inputMode="numeric"
              title={
                idx === 0
                  ? '시작 위치에서 다음 점으로 이동하기 전 대기 시간(ms)'
                  : '이전 점에서 이 점까지 이동 시간(ms)'
              }
              style={pathTimingInputStyle}
            />
            <input
              value={p.holdMs === '' || p.holdMs === undefined ? '' : String(p.holdMs)}
              onChange={(e) => updatePathPointMs(idx, 'holdMs', e.target.value)}
              onBlur={() => queueMicrotask(() => syncPathToConfig())}
              placeholder="0"
              inputMode="numeric"
              title="이 점 도착 후 머무는 시간(ms)"
              style={pathTimingInputStyle}
            />
            <div
              title="이 점에 도달하는 재생 시각"
              style={{
                fontSize: 10,
                textAlign: 'center',
                color: 'rgba(255,255,255,0.45)',
                fontVariantNumeric: 'tabular-nums',
                opacity: pathPointArrivalMsByRow[idx] == null ? 0.3 : 1,
              }}
            >
              {formatPathPlaybackMs(pathPointArrivalMsByRow[idx])}
            </div>
            <button
              type="button"
              onClick={() => removePathPoint(idx)}
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                border: 'none',
                background: 'rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.45)',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                padding: 0,
              }}
              title="이 점 삭제"
            >
              -
            </button>
          </div>
        ))}

        <div style={{ display: 'flex', marginTop: 8, gap: 8 }}>
          <button
            type="button"
            onClick={addPathPoint}
            style={secondaryBtnStyle}
          >
            점 추가
          </button>
          <button
            type="button"
            onClick={addCurrentPositionPathPoint}
            style={secondaryBtnStyle}
          >
            현재 위치 점 추가
          </button>

          <button
            type="button"
            disabled={!canPlayPath}
            onClick={requestPath}
            style={{
              ...secondaryBtnStyle,
              background: canPlayPath
                ? 'rgba(255,255,255,0.14)'
                : 'rgba(255,255,255,0.07)',
              cursor: canPlayPath ? 'pointer' : 'not-allowed',
              opacity: canPlayPath ? 1 : 0.8,
            }}
          >
            경로 재생
          </button>
        </div>
        <button
          type="button"
          disabled={!canPlayPath || isDownloadingSkyc}
          onClick={() => {
            syncPathToConfig();
            onDownloadSkyc();
          }}
          style={{
            marginTop: 10,
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.85)',
            cursor: !canPlayPath || isDownloadingSkyc ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            fontSize: 12,
            opacity: !canPlayPath || isDownloadingSkyc ? 0.45 : 1,
          }}
        >
          {isDownloadingSkyc ? '다운로드 중...' : '수정된 경로로 .skyc 저장 (로컬)'}
        </button>

        {skycDownloadStatus && (
          <div
            style={{
              marginTop: 8,
              padding: '6px 8px',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.6)',
              whiteSpace: 'pre-line',
              fontSize: 11,
            }}
          >
            {skycDownloadStatus}
          </div>
        )}
      </div>
    </>
  );

  const commitFormationSetting = (key, raw) => {
    if (raw === '' || raw === '-' || raw.endsWith('.')) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onUpdateFormationSettings({ [key]: parsed });
  };

  const renderFormationTab = () => {
    const droneId = resolveFormationDroneId(drone, droneIds, formationPhases);
    const selectionMissing =
      !drone?.id || String(drone.id).trim() === '';
    return (
      <>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 4,
            marginBottom: 6,
          }}
        >
          <div>
            <div style={{ fontWeight: 700 }}>Formation Phases</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              현재 드론 {droneCount}대 · phase {formationPhases.length}개
            </div>
          </div>
          <FormationIconButton
            title="현재 모든 드론의 위치를 새 phase로 캡처"
            onClick={onAddFormationPhase}
          >
            <Add />
          </FormationIconButton>
        </div>

        <div style={{ fontSize: 11, opacity: 0.45, marginBottom: 8, lineHeight: 1.4 }}>
          드론 배치 후 + 로 phase 저장 (공유)
        </div>
        {selectionMissing && droneId && (
          <div
            style={{
              marginBottom: 8,
              padding: '8px 10px',
              borderRadius: 8,
              ...formationSurfaceStyle,
              fontSize: 11,
              lineHeight: 1.45,
              opacity: 0.75,
            }}
          >
            3D에서 드론을 다시 클릭해 선택하세요. 지금은 <b>{droneId}</b> 기준 좌표를
            표시합니다.
          </div>
        )}

        {formationPhases.length === 0 ? (
          <div
            style={{
              padding: '14px 12px',
              textAlign: 'center',
              fontSize: 12,
              opacity: 0.45,
              ...formationSurfaceStyle,
              borderStyle: 'dashed',
            }}
          >
            아직 phase가 없습니다. 드론을 배치하고 <b>+</b>를 눌러주세요.
          </div>
        ) : (
          formationPhases.map((phase, idx) => {
            const captured = phase.points?.[droneId];
            const hasCapturedPosition =
              captured &&
              Number.isFinite(Number(captured.x)) &&
              Number.isFinite(Number(captured.y)) &&
              Number.isFinite(Number(captured.z));
            const hasCapturedYaw =
              captured && Number.isFinite(Number(captured.yaw));
            const hasCaptured = !!captured && (hasCapturedPosition || hasCapturedYaw);
            const px = captured?.x;
            const py = captured?.y;
            const pz = captured?.z;
            const pyaw = captured?.yaw;
            return (
              <div
                key={phase.id}
                style={{
                  marginBottom: 8,
                  padding: 8,
                  ...formationSurfaceStyle,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 4,
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      width: 22,
                      flexShrink: 0,
                      textAlign: 'center',
                      opacity: 0.5,
                    }}
                  >
                    #{idx + 1}
                  </div>
                  <input
                    value={phase.name ?? ''}
                    onChange={(e) =>
                      onUpdateFormationPhaseMeta(phase.id, { name: e.target.value })
                    }
                    placeholder="phase 이름"
                    style={{ ...smallInputStyle, flex: 1, minWidth: 0 }}
                  />
                  <input
                    value={phase.holdMs ?? 0}
                    onChange={(e) =>
                      onUpdateFormationPhaseMeta(phase.id, {
                        holdMs: e.target.value === '' ? 0 : Number(e.target.value),
                      })
                    }
                    placeholder="hold"
                    title="이 phase 완성 후 머무는 시간(ms)"
                    inputMode="numeric"
                    style={{ ...smallInputStyle, width: 64, flexShrink: 0 }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 2,
                    marginTop: 6,
                    alignItems: 'center',
                    flexWrap: 'nowrap',
                  }}
                >
                  <FormationIconButton
                    title="위로 이동"
                    onClick={() => onMoveFormationPhase(phase.id, 'up')}
                    disabled={idx === 0}
                  >
                    <KeyboardArrowUp />
                  </FormationIconButton>
                  <FormationIconButton
                    title="아래로 이동"
                    onClick={() => onMoveFormationPhase(phase.id, 'down')}
                    disabled={idx === formationPhases.length - 1}
                  >
                    <KeyboardArrowDown />
                  </FormationIconButton>
                  <FormationIconButton
                    title="이 phase에 모든 드론의 현재 위치를 다시 캡처"
                    onClick={() => onCaptureAllPositionsInPhase(phase.id)}
                  >
                    <Replay />
                  </FormationIconButton>
                  <FormationIconButton
                    title="이 phase 삭제"
                    onClick={() => onRemoveFormationPhase(phase.id)}
                  >
                    <DeleteOutline />
                  </FormationIconButton>
                  <FormationIconButton
                    title="이 phase에 저장된 좌표로 등록된 모든 드론 이동 (미캡처 드론은 초기 위치)"
                    onClick={() => onApplyAllDronesInPhase(phase.id)}
                    disabled={droneCount === 0}
                  >
                    <Groups />
                  </FormationIconButton>
                  <FormationIconButton
                    title="현재 3D 위치를 이 phase에 캡처"
                    onClick={() => droneId && onCaptureDronePositionInPhase(phase.id, droneId)}
                    disabled={!droneId}
                  >
                    <GpsFixed />
                  </FormationIconButton>
                  <FormationIconButton
                    title="이 phase의 위치로 드론을 이동"
                    onClick={() => droneId && onApplyDronePositionInPhase(phase.id, droneId)}
                    disabled={!droneId || !hasCapturedPosition}
                  >
                    <NearMe />
                  </FormationIconButton>
                  <FormationIconButton
                    title="이 드론의 캡처된 위치를 제거 (초기 위치로 fallback)"
                    onClick={() =>
                      droneId && onUpdateFormationDronePosition(phase.id, droneId, null)
                    }
                    disabled={!droneId || !hasCaptured}
                  >
                    <LinkOff />
                  </FormationIconButton>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 4,
                    marginTop: 6,
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr 1fr',
                      gap: 4,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {[
                      { label: 'X', key: 'x', value: px },
                      { label: 'Y', key: 'y', value: py },
                      { label: 'Z', key: 'z', value: pz },
                      { label: 'Yaw', key: 'yaw', value: pyaw },
                    ].map(({ label, key, value }) => {
                      const draftKey = formationPositionDraftKey(phase.id, droneId, key);
                      const displayValue =
                        formationPositionDrafts[draftKey] ??
                        (value === undefined || value === null ? '' : String(value));

                      const commitFormationAxisValue = (raw) => {
                        if (raw === '' && !hasCaptured) return;

                        const next = copyCapturedFormationAxes(captured);
                        if (raw === '') {
                          if (key === 'yaw') {
                            delete next.yaw;
                          } else {
                            next[key] = 0;
                          }
                        } else {
                          const parsed = Number(raw);
                          if (!Number.isFinite(parsed)) return;
                          next[key] = parsed;
                        }
                        onUpdateFormationDronePosition(
                          phase.id,
                          droneId,
                          Object.keys(next).length ? next : null
                        );
                        if (key === 'yaw') {
                          window.dispatchEvent(
                            new CustomEvent('drone-yaw-set', {
                              detail: {
                                id: droneId,
                                yaw: Number.isFinite(Number(next.yaw)) ? Number(next.yaw) : null,
                              },
                            })
                          );
                        }
                      };

                      return (
                        <input
                          key={label}
                          value={displayValue}
                          placeholder={label}
                          inputMode="decimal"
                          disabled={!droneId}
                          onChange={(e) => {
                            if (!droneId) return;
                            const raw = e.target.value;
                            if (!isPartialDecimalInput(raw)) return;

                            setFormationPositionDrafts((prev) => ({
                              ...prev,
                              [draftKey]: raw,
                            }));

                            if (raw === '' || raw === '-' || raw.endsWith('.')) return;

                            const parsed = Number(raw);
                            if (!Number.isFinite(parsed)) return;

                            commitFormationAxisValue(raw);
                          }}
                          onBlur={() => {
                            const raw = formationPositionDrafts[draftKey];
                            if (raw === undefined) return;

                            setFormationPositionDrafts((prev) => {
                              const next = { ...prev };
                              delete next[draftKey];
                              return next;
                            });

                            commitFormationAxisValue(raw);
                          }}
                          style={smallInputStyle}
                        />
                      );
                    })}
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      opacity: hasCaptured ? 0.55 : 0.35,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                    title={`${droneId || '-'} · ${
                      hasCapturedPosition ? '캡처됨' : hasCapturedYaw ? 'yaw만' : '미캡처'
                    }`}
                  >
                    {hasCapturedPosition ? '●' : hasCapturedYaw ? '◐' : '○'}
                  </span>
                </div>
              </div>
            );
          })
        )}

        {/* Global formation settings */}
        <div
          style={{
            marginTop: 18,
            padding: 10,
            ...formationSurfaceStyle,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>
            전송 옵션
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 6,
            }}
          >
            {[
              { key: 'step_size', label: 'step_size', placeholder: '1.0' },
              { key: 'duration_ms', label: 'duration_ms', placeholder: '1000' },
              {
                key: 'takeoff_time',
                label: 'takeoff_time',
                placeholder: '0 = 생략',
                title: '0이면 페이로드에 포함되지 않습니다 (옵션값)',
              },
            ].map(({ key, label, placeholder, title }) => {
              const displayValue =
                formationSettingsDrafts[key] ??
                String(safeFormationSettings[key] ?? '');
              return (
                <div key={key}>
                  <div style={settingLabelStyle}>{label}</div>
                  <input
                    value={displayValue}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (!isPartialDecimalInput(raw)) return;
                      setFormationSettingsDrafts((prev) => ({
                        ...prev,
                        [key]: raw,
                      }));
                      if (raw === '' || raw === '-' || raw.endsWith('.')) return;
                      commitFormationSetting(key, raw);
                    }}
                    onBlur={() => {
                      const raw = formationSettingsDrafts[key];
                      if (raw === undefined) return;
                      setFormationSettingsDrafts((prev) => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      });
                      commitFormationSetting(key, raw);
                    }}
                    inputMode={key === 'step_size' ? 'decimal' : 'numeric'}
                    placeholder={placeholder}
                    title={title}
                    style={smallInputStyle}
                  />
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              marginTop: 8,
              alignItems: 'center',
            }}
          >
            <label
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={!!safeFormationSettings.auto_upload}
                onChange={(e) =>
                  onUpdateFormationSettings({ auto_upload: e.target.checked })
                }
              />
              <span>auto_upload</span>
            </label>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ ...settingLabelStyle, marginBottom: 0 }}>output</span>
              <select
                value={safeFormationSettings.output ?? ''}
                onChange={(e) =>
                  onUpdateFormationSettings({ output: e.target.value })
                }
                title="기본값(미지정)이면 백엔드가 .skyc 파일을 응답으로 보냅니다."
                style={{
                  ...smallInputStyle,
                  flex: 1,
                  padding: '6px 8px',
                }}
              >
                {FORMATION_OUTPUT_OPTIONS.map((opt) => (
                  <option
                    key={opt.value || '__default'}
                    value={opt.value}
                    style={{ color: '#000' }}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <Tooltip
          title={
            isSendingFormation
              ? '전달 중...'
              : formationPhases.length === 0
                ? 'phase를 먼저 추가하세요'
                : '포메이션 전달하기'
          }
          placement="top"
        >
          <span style={{ display: 'block', marginTop: 10 }}>
            <button
              type="button"
              disabled={isSendingFormation || formationPhases.length === 0}
              onClick={onSendFormationPlan}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
                background:
                  isSendingFormation || formationPhases.length === 0
                    ? 'rgba(255,255,255,0.02)'
                    : 'rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.75)',
                cursor:
                  isSendingFormation || formationPhases.length === 0
                    ? 'not-allowed'
                    : 'pointer',
                fontWeight: 600,
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                opacity: isSendingFormation || formationPhases.length === 0 ? 0.45 : 1,
              }}
            >
              <Send sx={{ fontSize: 16, color: 'inherit', opacity: 0.7 }} />
              {isSendingFormation ? '전달 중...' : '포메이션 전달'}
            </button>
          </span>
        </Tooltip>

        {formationDeliveryStatus && (
          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              fontSize: 11.5,
              whiteSpace: 'pre-line',
              opacity: 0.7,
              ...formationSurfaceStyle,
            }}
          >
            {formationDeliveryStatus}
          </div>
        )}
      </>
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 420,
        maxWidth: 'min(420px, 92vw)',
        height: '100%',
        background: 'rgba(18, 20, 24, 0.92)',
        color: 'rgba(255,255,255,0.88)',
        padding: 14,
        boxSizing: 'border-box',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 200ms ease',
        zIndex: 10,
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(10px)',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Drone Info</div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            borderRadius: 4,
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          닫기
        </button>
      </div>

      <div style={{ marginTop: 14 }}>
        {!drone ? (
          <div style={{ opacity: 0.5 }}>드론을 선택하세요.</div>
        ) : (
          <>
            {/* ID */}
            <div style={{ marginBottom: 10, fontSize: 13, opacity: 0.85 }}>
              <span style={{ opacity: 0.45, marginRight: 6 }}>ID</span>
              {drone.id}
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, opacity: 0.45, marginBottom: 6 }}>초기 위치</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <input
                  value={initialFields.ix}
                  onChange={(e) => setInitialFields((p) => ({ ...p, ix: e.target.value }))}
                  placeholder="X"
                  inputMode="decimal"
                  style={smallInputStyle}
                />
                <input
                  value={initialFields.iy}
                  onChange={(e) => setInitialFields((p) => ({ ...p, iy: e.target.value }))}
                  placeholder="Y"
                  inputMode="decimal"
                  style={smallInputStyle}
                />
                <input
                  value={initialFields.iz}
                  onChange={(e) => setInitialFields((p) => ({ ...p, iz: e.target.value }))}
                  placeholder="Z"
                  inputMode="decimal"
                  style={smallInputStyle}
                />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  onClick={fillInitialFromCurrentPosition}
                  style={{ ...secondaryBtnStyle, flex: '1 1 120px' }}
                >
                  현재 위치로 채우기
                </button>
                <button
                  type="button"
                  onClick={() => applyInitialPosition({ moveDrone: false })}
                  style={{
                    ...secondaryBtnStyle,
                    flex: '1 1 120px',
                    fontWeight: 600,
                  }}
                >
                  초기 위치 적용
                </button>
                <button
                  type="button"
                  onClick={() => applyInitialPosition({ moveDrone: true })}
                  title="씬에서 드론 마커를 입력 좌표로 즉시 이동합니다."
                  style={{ ...secondaryBtnStyle, flex: '1 1 120px' }}
                >
                  적용 후 이동
                </button>
              </div>
            </div>

            {/* Tab switcher */}
            <div
              style={{
                display: 'flex',
                gap: 0,
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                marginBottom: 12,
              }}
            >
              {[
                { id: 'path', label: 'Path' },
                { id: 'formation', label: 'Formation' },
              ].map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      padding: '8px 12px',
                      border: 'none',
                      borderBottom: active ? '2px solid rgba(255,255,255,0.7)' : '2px solid transparent',
                      background: 'transparent',
                      color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
                      cursor: 'pointer',
                      fontWeight: active ? 600 : 400,
                      fontSize: 12,
                      marginBottom: -1,
                    }}
                  >
                    {tab.label}
                    {tab.id === 'formation' && formationPhases.length > 0 ? (
                      <span style={{ marginLeft: 5, opacity: 0.5, fontSize: 10 }}>
                        {formationPhases.length}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {activeTab === 'path' ? renderPathTab() : renderFormationTab()}
          </>
        )}

        {/* 드론 삭제 */}
        {drone && (
          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (!drone?.id) return;
                window.dispatchEvent(
                  new CustomEvent('drone-delete-request', { detail: { id: drone.id } })
                );
              }}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 6,
                border: 'none',
                background: 'rgba(255,255,255,0.04)',
                color: 'rgba(255,120,120,0.85)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              이 드론 삭제
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const PATH_ROW_GRID_COLUMNS =
  '28px 22px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 52px 48px 50px 24px';

const pathTimingInputStyle = {
  padding: '6px 4px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.85)',
  fontSize: 11,
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
  textAlign: 'center',
  fontVariantNumeric: 'tabular-nums',
};

const formatPathPlaybackMs = (ms) => {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const safe = Math.max(0, Math.round(Number(ms)));
  const totalSec = Math.floor(safe / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

const smallInputStyle = {
  padding: '6px 6px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.85)',
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
};

const secondaryBtnStyle = {
  flex: 1,
  padding: '7px 8px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.8)',
  cursor: 'pointer',
  fontSize: 12,
};

const settingLabelStyle = {
  fontSize: 10.5,
  opacity: 0.6,
  marginBottom: 3,
};

DroneInfoPanel.propTypes = {
  open: PropTypes.bool.isRequired,
  drone: PropTypes.shape({
    id: PropTypes.string,
    battery: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    batteryPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    batteryVoltage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    gpsFix: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    heading: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    ahl: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    agl: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    amsl: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    mode: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    satellites: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    currentPosition: PropTypes.shape({
      x: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      y: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      z: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    }),
    path: PropTypes.array,
    status: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }),
  onClose: PropTypes.func.isRequired,
  droneCount: PropTypes.number,
  droneIds: PropTypes.arrayOf(PropTypes.string),
  formationPhases: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string,
      holdMs: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      points: PropTypes.object,
    })
  ),
  formationSettings: PropTypes.shape({
    step_size: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    duration_ms: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    takeoff_time: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    auto_upload: PropTypes.bool,
    output: PropTypes.string,
  }),
  isSendingFormation: PropTypes.bool,
  formationDeliveryStatus: PropTypes.string,
  onAddFormationPhase: PropTypes.func,
  onRemoveFormationPhase: PropTypes.func,
  onMoveFormationPhase: PropTypes.func,
  onUpdateFormationPhaseMeta: PropTypes.func,
  onUpdateFormationDronePosition: PropTypes.func,
  onCaptureDronePositionInPhase: PropTypes.func,
  onCaptureAllPositionsInPhase: PropTypes.func,
  onApplyDronePositionInPhase: PropTypes.func,
  onApplyAllDronesInPhase: PropTypes.func,
  onUpdateFormationSettings: PropTypes.func,
  onSendFormationPlan: PropTypes.func,
  onDownloadSkyc: PropTypes.func,
  isDownloadingSkyc: PropTypes.bool,
  skycDownloadStatus: PropTypes.string,
};
