import Add from '@mui/icons-material/Add';
import ContentCopy from '@mui/icons-material/ContentCopy';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import DragIndicator from '@mui/icons-material/DragIndicator';
import GpsFixed from '@mui/icons-material/GpsFixed';
import GridOn from '@mui/icons-material/GridOn';
import Groups from '@mui/icons-material/Groups';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRight from '@mui/icons-material/KeyboardArrowRight';
import LinkOff from '@mui/icons-material/LinkOff';
import NearMe from '@mui/icons-material/NearMe';
import Replay from '@mui/icons-material/Replay';
import Route from '@mui/icons-material/Route';
import Send from '@mui/icons-material/Send';
import Undo from '@mui/icons-material/Undo';
import Tooltip from '@mui/material/Tooltip';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import {
  DRONE_PATH_FLUSH_REQUEST,
  getPathPointArrivalTimesMs,
  toFiniteDurationMs,
  toFiniteHoldMs,
} from './utils/threeDViewUtils';
import {
  PROFILE_THICKNESS_MAX,
  PROFILE_THICKNESS_MIN,
  areProfileWidthsLinkedToSmoothing,
  getProfileAccelShape,
  getProfileAccelWidth,
  getProfileDecelShape,
  getProfileDecelWidth,
  getProfileExp,
  getProfileLog,
  getVelocityProfile,
  getVelocitySmoothing,
  resetProfileWidths,
  setProfileAccelShape,
  setProfileAccelWidth,
  setProfileDecelShape,
  setProfileDecelWidth,
  setProfileExp,
  setProfileLog,
  setVelocitySmoothing,
  subscribeSmoothingKnobs,
} from './utils/pathSmoothing';
import { RAMP_SHAPES, RAMP_SHAPE_LABELS } from './utils/velocityProfile';
import PlanFailureReport from './PlanFailureReport';
import VelocityProfileChart from './VelocityProfileChart';

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

const FORMATION_ACCENT = '#67b4ff';
const FORMATION_MUTED = '#8a8d95';
const FORMATION_DIM = '#6f727b';
const FORMATION_BORDER = 'rgba(255,255,255,0.12)';
const FORMATION_SURFACE = '#1b1d2a';
const FORMATION_INPUT_BG = '#14161e';
const FORMATION_LABEL = 'rgba(255,255,255,0.38)';

const formationSurfaceStyle = {
  borderRadius: 10,
  border: `1px solid ${FORMATION_BORDER}`,
  background: FORMATION_SURFACE,
};

const formationMonoStyle = {
  fontVariantNumeric: 'tabular-nums',
};

const formationFieldStyle = {
  ...formationMonoStyle,
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
  background: FORMATION_INPUT_BG,
  border: `1px solid ${FORMATION_BORDER}`,
  borderRadius: 6,
  color: '#e8e9ec',
  fontSize: 12,
  padding: '4px 6px',
};

const phaseCardLabelStyle = {
  fontSize: 9.5,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: FORMATION_LABEL,
  marginBottom: 3,
};

const phaseCardBtnStyle = {
  height: 28,
  padding: '0 9px',
  fontSize: 12,
  borderRadius: 6,
  gap: 5,
};

function useHoverState() {
  const [hover, setHover] = useState(false);
  return {
    hover,
    bind: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
    },
  };
}

function FormationActionButton({
  title,
  onClick,
  disabled = false,
  variant = 'default',
  children,
  style: styleProp,
}) {
  const { hover, bind } = useHoverState();
  const variants = {
    primary: {
      background: hover ? '#5a98ff' : FORMATION_ACCENT,
      border: 'none',
      color: '#06121f',
      fontWeight: 700,
    },
    accent: {
      background: hover ? 'rgba(76,141,255,0.26)' : 'rgba(76,141,255,0.16)',
      border: '1px solid rgba(76,141,255,0.45)',
      color: '#dfe8ff',
      fontWeight: 600,
    },
    default: {
      background: hover ? '#262932' : '#22242b',
      border: `1px solid ${hover ? '#4a4e5a' : '#33353f'}`,
      color: '#d3d5db',
      fontWeight: 500,
    },
    danger: {
      background: hover ? 'rgba(229,104,106,0.16)' : 'transparent',
      border: 'none',
      color: hover ? '#e5686a' : FORMATION_MUTED,
      fontWeight: 500,
    },
    ghost: {
      background: hover ? '#24262d' : 'transparent',
      border: 'none',
      color: hover ? '#c9cbd1' : FORMATION_MUTED,
      fontWeight: 500,
    },
    secondary: {
      background: hover ? '#262932' : '#20222a',
      border: `1px solid ${hover ? '#454956' : '#30333c'}`,
      color: '#c9cbd1',
      fontWeight: 500,
    },
  };
  const tone = variants[variant] || variants.default;
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...bind}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '8px 11px',
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        fontSize: 11.5,
        fontFamily: 'inherit',
        lineHeight: 1.2,
        transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
        ...tone,
        ...styleProp,
      }}
    >
      {children}
    </button>
  );
  if (!title) return button;
  return (
    <Tooltip title={title} placement="top">
      <span style={{ display: 'inline-flex' }}>{button}</span>
    </Tooltip>
  );
}

FormationActionButton.propTypes = {
  title: PropTypes.string,
  onClick: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  variant: PropTypes.oneOf(['primary', 'accent', 'default', 'danger', 'ghost', 'secondary']),
  children: PropTypes.node.isRequired,
  style: PropTypes.object,
};

const formatFormationHoldSec = (ms) => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '0.0';
  return (n / 1000).toFixed(1);
};

const formatHoldDuration = (ms) => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '0s';
  if (n < 1000) return `${Math.round(n)}ms`;
  const seconds = n / 1000;
  return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
};

function PathGroupToggleButton({ expanded, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={expanded ? '정지 구간 접기' : '정지 구간 펼치기'}
      style={{
        width: 22,
        height: 22,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        border: '1px solid rgba(126,200,255,0.28)',
        background: hover ? 'rgba(126,200,255,0.24)' : 'rgba(126,200,255,0.1)',
        color: '#9fd6ff',
        cursor: 'pointer',
        fontSize: 10,
        lineHeight: 1,
        padding: 0,
        transition: 'background 0.12s ease',
      }}
    >
      {expanded ? '▾' : '▸'}
    </button>
  );
}

PathGroupToggleButton.propTypes = {
  expanded: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
};

function PathGroupDeleteButton({ onClick, title }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{
        width: 22,
        height: 22,
        flexShrink: 0,
        borderRadius: 6,
        border: 'none',
        background: hover ? 'rgba(255,90,90,0.22)' : 'rgba(255,255,255,0.06)',
        color: hover ? '#ff9d9d' : 'rgba(255,255,255,0.45)',
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: 1,
        padding: 0,
        transition: 'background 0.12s ease, color 0.12s ease',
      }}
    >
      −
    </button>
  );
}

PathGroupDeleteButton.propTypes = {
  onClick: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
};

function PathGroupCoordInputs({ first, onChange, onBlur, compact }) {
  const field = (axis, value) => (
    <label
      key={axis}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flex: 1,
        minWidth: 0,
      }}
      title={`정지 구간 전체 ${axis.toUpperCase()} 일괄 수정`}
    >
      <span style={{ fontSize: 10, opacity: 0.45, flexShrink: 0 }}>{axis.toUpperCase()}</span>
      <input
        value={value ?? ''}
        onChange={(e) => onChange(axis, e.target.value)}
        onBlur={onBlur}
        placeholder={axis.toUpperCase()}
        inputMode="decimal"
        style={{
          ...smallInputStyle,
          padding: compact ? '4px 5px' : '6px 6px',
          fontSize: compact ? 11 : 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      />
    </label>
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minWidth: 0,
      }}
    >
      {field('x', first?.x)}
      {field('y', first?.y)}
      {field('z', first?.z)}
    </div>
  );
}

PathGroupCoordInputs.propTypes = {
  first: PropTypes.shape({
    x: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    y: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    z: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }),
  onChange: PropTypes.func.isRequired,
  onBlur: PropTypes.func.isRequired,
  compact: PropTypes.bool,
};

PathGroupCoordInputs.defaultProps = {
  first: null,
  compact: false,
};

function PathGroupHeaderBar({ group, count, holdTotalMs, first, onToggle, onCoordChange, onCoordBlur }) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 4,
        padding: '4px 10px 4px 12px',
        borderRadius: 6,
        background: 'rgba(126,200,255,0.06)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: 'rgba(126,200,255,0.4)',
        }}
      />
      <PathGroupToggleButton expanded onClick={onToggle} />
      <span style={{ fontSize: 11, opacity: 0.55, flexShrink: 0 }}>
        정지 구간 #{group.start + 1}-{group.end + 1} · {count}칸 · {formatHoldDuration(holdTotalMs)}
      </span>
      <PathGroupCoordInputs
        first={first}
        onChange={onCoordChange}
        onBlur={onCoordBlur}
        compact
      />
    </div>
  );
}

PathGroupHeaderBar.propTypes = {
  group: PropTypes.shape({ start: PropTypes.number, end: PropTypes.number }).isRequired,
  count: PropTypes.number.isRequired,
  holdTotalMs: PropTypes.number.isRequired,
  first: PropTypes.shape({
    x: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    y: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    z: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }),
  onToggle: PropTypes.func.isRequired,
  onCoordChange: PropTypes.func.isRequired,
  onCoordBlur: PropTypes.func.isRequired,
};

PathGroupHeaderBar.defaultProps = {
  first: null,
};

function PathGroupSummaryRow({
  group,
  count,
  holdTotalMs,
  arrivalStart,
  arrivalEnd,
  first,
  onToggle,
  onDelete,
  onCoordChange,
  onCoordBlur,
}) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 4,
        padding: '6px 10px 6px 12px',
        borderRadius: 8,
        background: 'linear-gradient(90deg, rgba(126,200,255,0.09), rgba(126,200,255,0.02))',
        border: '1px solid rgba(126,200,255,0.18)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: 'rgba(126,200,255,0.6)',
        }}
      />
      <PathGroupToggleButton expanded={false} onClick={onToggle} />
      <div
        style={{
          fontSize: 11,
          opacity: 0.5,
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}
      >
        #{group.start + 1}-{group.end + 1}
      </div>
      <PathGroupCoordInputs first={first} onChange={onCoordChange} onBlur={onCoordBlur} />
      <div
        style={{
          fontSize: 11,
          color: '#bfe6ff',
          background: 'rgba(126,200,255,0.16)',
          borderRadius: 999,
          padding: '2px 9px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        ⏸ {count}칸 · {formatHoldDuration(holdTotalMs)}
      </div>
      <div
        title="이 구간의 재생 시각 범위"
        style={{
          fontSize: 10,
          color: 'rgba(255,255,255,0.4)',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {formatPathPlaybackMs(arrivalStart)}~{formatPathPlaybackMs(arrivalEnd)}
      </div>
      <PathGroupDeleteButton onClick={onDelete} title="이 정지 구간 전체 삭제" />
    </div>
  );
}

PathGroupSummaryRow.propTypes = {
  group: PropTypes.shape({ start: PropTypes.number, end: PropTypes.number }).isRequired,
  count: PropTypes.number.isRequired,
  holdTotalMs: PropTypes.number.isRequired,
  arrivalStart: PropTypes.number,
  arrivalEnd: PropTypes.number,
  first: PropTypes.shape({
    x: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    y: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    z: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }),
  onToggle: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onCoordChange: PropTypes.func.isRequired,
  onCoordBlur: PropTypes.func.isRequired,
};

PathGroupSummaryRow.defaultProps = {
  arrivalStart: null,
  arrivalEnd: null,
  first: null,
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
  formationSendStartedAt = null,
  formationDeliveryStatus = '',
  formationFailure = null,
  onDismissFormationFailure = () => {},
  onAddFormationPhase = () => {},
  onOpenFormationGrid = () => {},
  onEditFormationPhaseGrid = () => {},
  onAppendReversedFormationPhases = () => {},
  onRecoverReversedFormationPhases = () => {},
  canRecoverReversedFormationPhases = false,
  onRemoveFormationPhase = () => {},
  onMoveFormationPhase = () => {},
  onReorderFormationPhase = () => {},
  onDuplicateFormationPhase = () => {},
  onUpdateFormationPhaseMeta = () => {},
  onUpdateFormationDronePosition = () => {},
  onCaptureDronePositionInPhase = () => {},
  onCaptureAllPositionsInPhase = () => {},
  onToggleFixedStraight = () => {},
  onSetAllFixedStraight = () => {},
  onSetAllYawInPhase = () => {},
  selectedPhaseId = null,
  onTogglePhaseSelected = () => {},
  multiSelectedDroneIds = [],
  onAddClusterToPhase = () => {},
  onRemoveClusterFromPhase = () => {},
  onOpenImageDots = () => {},
  onApplyDronePositionInPhase = () => {},
  onApplyAllDronesInPhase = () => {},
  onUpdateFormationSettings = () => {},
  onSendFormationPlan = () => {},
  onDownloadSkyc = () => {},
  isDownloadingSkyc = false,
  skycDownloadStatus = '',
}) {
  const [activeTab, setActiveTab] = useState('formation');
  const [expandedPhaseId, setExpandedPhaseId] = useState(null);
  const [dragPhaseIndex, setDragPhaseIndex] = useState(null);
  const [dragOverPhaseIndex, setDragOverPhaseIndex] = useState(null);
  /** 지금 선택된 드론 — 클러스터(그룹) 하이라이트 판정에 쓴다 */
  const multiSelectedSet = useMemo(
    () => new Set(multiSelectedDroneIds.map(String)),
    [multiSelectedDroneIds]
  );

  // 포메이션 전송 중 경과 시간 (0.5초 간격 갱신)
  const [sendElapsedSec, setSendElapsedSec] = useState(0);
  useEffect(() => {
    if (!isSendingFormation || !formationSendStartedAt) {
      setSendElapsedSec(0);
      return undefined;
    }
    const update = () =>
      setSendElapsedSec(
        Math.floor((Date.now() - formationSendStartedAt) / 1000)
      );
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [isSendingFormation, formationSendStartedAt]);
  /** phaseId -> yaw 일괄 기입 입력값 (기입 전까지 임시로 들고 있는 문자열) */
  const [bulkYawDrafts, setBulkYawDrafts] = useState({});
  const [pathPoints, setPathPoints] = useState([
    { x: '', y: '', z: '', durationMs: 0, holdMs: 0, highlighted: false },
  ]);
  const [expandedPathGroups, setExpandedPathGroups] = useState(() => new Set());
  const [initialFields, setInitialFields] = useState({ ix: '', iy: '', iz: '' });
  const [formationPositionDrafts, setFormationPositionDrafts] = useState({});
  const [formationSettingsDrafts, setFormationSettingsDrafts] = useState({});

  // 관성 속도 프로파일 노브 (전역 공유, localStorage에 저장되어 모든 생성
  // 요청이 함께 쓴다). 가속 램프 / 등속 plateau / 감속 램프 세 구간이고,
  // plateau 폭은 남는 값(1 - a - b)이라 따로 저장하지 않는다.
  const readProfileKnobs = () => ({
    smoothing: getVelocitySmoothing(),
    accelShape: getProfileAccelShape(),
    accelCurve: getProfileExp(),
    accelWidth: getProfileAccelWidth(),
    decelShape: getProfileDecelShape(),
    decelCurve: getProfileLog(),
    decelWidth: getProfileDecelWidth(),
    widthsLinked: areProfileWidthsLinkedToSmoothing(),
  });
  const [profileKnobs, setProfileKnobs] = useState(readProfileKnobs);
  const refreshProfileKnobs = () => setProfileKnobs(readProfileKnobs());

  // 실효 프로파일: plateau가 0으로 눌리면 양쪽 램프가 등속으로 고정된다.
  const effectiveProfile = useMemo(
    () => getVelocityProfile(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileKnobs]
  );
  const plateauLocked = effectiveProfile.plateauCollapsed;

  const applyKnob = (setter) => (value) => {
    setter(value);
    refreshProfileKnobs();
  };
  const handleProfileSmoothing = applyKnob(setVelocitySmoothing);
  const handleProfileExp = applyKnob(setProfileExp);
  const handleProfileLog = applyKnob(setProfileLog);
  const handleAccelShape = applyKnob(setProfileAccelShape);
  const handleDecelShape = applyKnob(setProfileDecelShape);
  const handleAccelWidth = applyKnob(setProfileAccelWidth);
  const handleDecelWidth = applyKnob(setProfileDecelWidth);
  const handleResetWidths = () => {
    resetProfileWidths();
    refreshProfileKnobs();
  };

  // 재생바 등 다른 UI에서 같은 전역값을 바꾸면 여기도 실시간 반영
  useEffect(() => subscribeSmoothingKnobs(refreshProfileKnobs), []);

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
    setExpandedPathGroups(new Set());
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

  // 좌표가 동일한 연속 행을 하나의 "정지 구간"으로 묶는다. 데이터(durationMs/holdMs)는
  // 건드리지 않고 표시만 접었다 펼 수 있게 해서, 병합 시 yaw 세트포인트와 어긋나는
  // 문제를 피한다.
  const pathPointGroups = useMemo(() => {
    const groups = [];
    let i = 0;
    while (i < pathPoints.length) {
      let j = i + 1;
      while (
        j < pathPoints.length &&
        isPathPointRowValid(pathPoints[i]) &&
        isPathPointRowValid(pathPoints[j]) &&
        Number(pathPoints[i].x) === Number(pathPoints[j].x) &&
        Number(pathPoints[i].y) === Number(pathPoints[j].y) &&
        Number(pathPoints[i].z) === Number(pathPoints[j].z)
      ) {
        j += 1;
      }
      groups.push({ start: i, end: j - 1 });
      i = j;
    }
    return groups;
  }, [pathPoints]);

  const togglePathGroupExpanded = (start) => {
    setExpandedPathGroups((prev) => {
      const next = new Set(prev);
      if (next.has(start)) {
        next.delete(start);
      } else {
        next.add(start);
      }
      return next;
    });
  };

  const computeGroupHoldMs = (group) => {
    let total = toFiniteHoldMs(pathPoints[group.start]?.holdMs, 0);
    for (let k = group.start + 1; k <= group.end; k += 1) {
      total +=
        toFiniteDurationMs(pathPoints[k]?.durationMs, 1000) +
        toFiniteHoldMs(pathPoints[k]?.holdMs, 0);
    }
    return total;
  };

  const removePathPointGroup = (group) => {
    setPathPoints((prev) => {
      if (!Array.isArray(prev) || !prev.length) return prev;
      const next = prev.filter((_, i) => i < group.start || i > group.end);
      const finalPoints = next.length
        ? next
        : [{ x: '', y: '', z: '', durationMs: 0, holdMs: 0, highlighted: false }];
      queueMicrotask(() => syncPathToConfig(finalPoints));
      return finalPoints;
    });
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

  const updatePathPointGroupCoords = (group, key, value) => {
    setPathPoints((prev) =>
      prev.map((p, i) => (i >= group.start && i <= group.end ? { ...p, [key]: value } : p))
    );
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

  const renderPathPointRow = (idx) => {
    const p = pathPoints[idx];
    return (
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
    );
  };

  const safeFormationSettings = formationSettings || {
    step_size: 1,
    cruise_speed: 0.1,
    takeoff_time: 0,
    auto_upload: false,
    output: '',
    min_separation: 1.45,
    landing_grid: false,
    landing_spacing: 4.0,
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

        {pathPointGroups.map((group) => {
          if (group.end === group.start) {
            return renderPathPointRow(group.start);
          }

          const count = group.end - group.start + 1;
          const holdTotalMs = computeGroupHoldMs(group);
          const expanded = expandedPathGroups.has(group.start);

          if (expanded) {
            return (
              <div key={`group-${group.start}`}>
                <PathGroupHeaderBar
                  group={group}
                  count={count}
                  holdTotalMs={holdTotalMs}
                  first={pathPoints[group.start]}
                  onToggle={() => togglePathGroupExpanded(group.start)}
                  onCoordChange={(axis, value) => updatePathPointGroupCoords(group, axis, value)}
                  onCoordBlur={() => queueMicrotask(() => syncPathToConfig())}
                />
                {Array.from({ length: count }, (_, k) => renderPathPointRow(group.start + k))}
              </div>
            );
          }

          return (
            <PathGroupSummaryRow
              key={`group-${group.start}`}
              group={group}
              count={count}
              holdTotalMs={holdTotalMs}
              arrivalStart={pathPointArrivalMsByRow[group.start]}
              arrivalEnd={pathPointArrivalMsByRow[group.end]}
              first={pathPoints[group.start]}
              onToggle={() => togglePathGroupExpanded(group.start)}
              onDelete={() => removePathPointGroup(group)}
              onCoordChange={(axis, value) => updatePathPointGroupCoords(group, axis, value)}
              onCoordBlur={() => queueMicrotask(() => syncPathToConfig())}
            />
          );
        })}

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
    const iconSx = { fontSize: 15, color: 'inherit' };

    return (
      <>
        <div style={{ paddingTop: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e8e9ec' }}>
            Formation Phases
          </div>
          <div style={{ fontSize: 11.5, color: '#7c7f88', marginTop: 3 }}>
            드론 {droneCount}대 · 총 {formationPhases.length}개 phase
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <FormationActionButton
              title="격자 툴로 새 formation phase 만들기"
              onClick={onOpenFormationGrid}
              variant="primary"
              style={{ flex: '1 1 160px', padding: '10px 12px', borderRadius: 9, fontSize: 12.5 }}
            >
              <Add sx={{ fontSize: 16, color: 'inherit' }} />
              그리드로 Phase 추가
            </FormationActionButton>
            <FormationActionButton
              title="현재 모든 드론의 위치를 새 phase로 캡처"
              onClick={onAddFormationPhase}
              variant="secondary"
              style={{ padding: '10px 12px', borderRadius: 9, fontSize: 12 }}
            >
              현재 배치 캡처
            </FormationActionButton>
            <FormationActionButton
              title="이미지를 올려 내용·구조를 대표하는 점들을 추출하고, 정면 수직 평면 phase로 추가"
              onClick={onOpenImageDots}
              disabled={droneCount === 0}
              variant="secondary"
              style={{ padding: '10px 12px', borderRadius: 9, fontSize: 12 }}
            >
              이미지 → 점
            </FormationActionButton>
            <FormationActionButton
              title="기존 phase를 역순으로 복제해 뒤에 추가"
              onClick={onAppendReversedFormationPhases}
              disabled={formationPhases.length === 0}
              variant="secondary"
              style={{ padding: '10px 12px', borderRadius: 9, fontSize: 12 }}
            >
              역점 추가
            </FormationActionButton>
            {canRecoverReversedFormationPhases ? (
              <FormationActionButton
                title="직전에 추가한 역점 회수"
                onClick={onRecoverReversedFormationPhases}
                variant="ghost"
                style={{ padding: '10px 10px', borderRadius: 9, fontSize: 12 }}
              >
                <Undo sx={iconSx} />
                회수
              </FormationActionButton>
            ) : null}
          </div>
        </div>

        {selectionMissing && droneId && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 10px',
              borderRadius: 8,
              ...formationSurfaceStyle,
              fontSize: 11,
              lineHeight: 1.45,
              color: FORMATION_MUTED,
            }}
          >
            3D에서 드론을 다시 클릭해 선택하세요. 지금은 <b style={{ color: '#c9cbd1' }}>{droneId}</b> 기준
            좌표를 표시합니다.
          </div>
        )}

        <div
          style={{
            marginTop: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {formationPhases.length === 0 ? (
            <div
              style={{
                padding: '18px 14px',
                textAlign: 'center',
                fontSize: 12,
                color: FORMATION_DIM,
                ...formationSurfaceStyle,
                borderStyle: 'dashed',
              }}
            >
              아직 phase가 없습니다.{' '}
              <b style={{ color: '#c9cbd1' }}>그리드로 Phase 추가</b>로 모양을 그리거나{' '}
              <b style={{ color: '#c9cbd1' }}>현재 배치 캡처</b>를 눌러주세요.
            </div>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginBottom: 2,
                }}
              >
                <span
                  style={{
                    fontSize: 10.5,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: FORMATION_LABEL,
                  }}
                >
                  Phase
                </span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)' }}>
                  그립을 잡고 드래그해 순서 변경
                </span>
              </div>
              {formationPhases.map((phase, idx) => {
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
              const holdMs = phase.holdMs ?? 0;
              const fixedIdsInPhase = Array.isArray(phase.fixedDroneIds)
                ? phase.fixedDroneIds.map(String)
                : [];
              const fixedPathCount = fixedIdsInPhase.length;
              // 그룹(여러 대)을 잡은 상태면 직선 고정은 선택 전체에 걸린다.
              const straightTargets =
                droneId && multiSelectedSet.has(String(droneId)) &&
                multiSelectedDroneIds.length > 1
                  ? multiSelectedDroneIds.map(String)
                  : droneId
                    ? [String(droneId)]
                    : [];
              const isFixedStraight =
                straightTargets.length > 0 &&
                straightTargets.every((id) => fixedIdsInPhase.includes(id));
              const clusterCount = Array.isArray(phase.clusters)
                ? phase.clusters.length
                : 0;
              const isPhaseSelected =
                selectedPhaseId != null &&
                String(phase.id) === String(selectedPhaseId);
              const isExpanded =
                expandedPhaseId != null &&
                String(expandedPhaseId) === String(phase.id);
              const isDragging = dragPhaseIndex === idx;
              const isDropTarget =
                dragOverPhaseIndex === idx && dragPhaseIndex !== idx;

              const commitFormationAxisValue = (key, raw) => {
                if (raw === '' && !hasCaptured) return;
                const next = copyCapturedFormationAxes(captured);
                if (raw === '') {
                  next[key] = 0;
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
                        yaw: Number.isFinite(Number(next.yaw))
                          ? Number(next.yaw)
                          : null,
                      },
                    })
                  );
                }
              };

              const renderAxisInput = (label, key, value) => {
                const draftKey = formationPositionDraftKey(phase.id, droneId, key);
                const displayValue =
                  formationPositionDrafts[draftKey] ??
                  (value === undefined || value === null ? '' : String(value));
                return (
                  <div key={label}>
                    <div style={phaseCardLabelStyle}>{label}</div>
                    <input
                      value={displayValue}
                      placeholder="—"
                      inputMode="decimal"
                      disabled={!droneId}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        if (!droneId) return;
                        const raw = e.target.value;
                        if (!isPartialDecimalInput(raw)) return;
                        setFormationPositionDrafts((prev) => ({
                          ...prev,
                          [draftKey]: raw,
                        }));
                        if (raw === '' || raw === '-' || raw.endsWith('.')) return;
                        if (!Number.isFinite(Number(raw))) return;
                        commitFormationAxisValue(key, raw);
                      }}
                      onBlur={() => {
                        const raw = formationPositionDrafts[draftKey];
                        if (raw === undefined) return;
                        setFormationPositionDrafts((prev) => {
                          const next = { ...prev };
                          delete next[draftKey];
                          return next;
                        });
                        commitFormationAxisValue(key, raw);
                      }}
                      style={formationFieldStyle}
                    />
                  </div>
                );
              };

              return (
                <div
                  key={phase.id}
                  onDragOver={(e) => {
                    if (dragPhaseIndex == null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverPhaseIndex !== idx) setDragOverPhaseIndex(idx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragPhaseIndex;
                    if (from != null && from !== idx) {
                      onReorderFormationPhase(from, idx);
                    }
                    setDragPhaseIndex(null);
                    setDragOverPhaseIndex(null);
                  }}
                  style={{
                    ...formationSurfaceStyle,
                    overflow: 'hidden',
                    opacity: isDragging ? 0.4 : 1,
                    borderTopColor: isDropTarget ? FORMATION_ACCENT : FORMATION_BORDER,
                    borderColor: isPhaseSelected
                      ? FORMATION_ACCENT
                      : isDropTarget
                        ? FORMATION_ACCENT
                        : FORMATION_BORDER,
                    boxShadow: isPhaseSelected
                      ? `0 0 0 1px ${FORMATION_ACCENT}44`
                      : '0 6px 16px rgba(0,0,0,0.22)',
                  }}
                >
                  <div
                    onClick={() => {
                      const willExpand = !isExpanded;
                      setExpandedPhaseId(willExpand ? phase.id : null);
                      if (willExpand) {
                        if (!isPhaseSelected) {
                          onTogglePhaseSelected(String(phase.id));
                        }
                        onApplyAllDronesInPhase(phase.id);
                      }
                    }}
                    title="클릭: 세부 옵션 펼치기 / 접기"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '7px 9px',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {isExpanded ? (
                      <KeyboardArrowDown
                        sx={{ fontSize: 14, color: FORMATION_MUTED, flexShrink: 0 }}
                      />
                    ) : (
                      <KeyboardArrowRight
                        sx={{ fontSize: 14, color: FORMATION_MUTED, flexShrink: 0 }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: 10.5,
                        ...formationMonoStyle,
                        color: FORMATION_MUTED,
                        flexShrink: 0,
                      }}
                    >
                      #{idx + 1}
                    </span>
                    <input
                      value={phase.name ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onUpdateFormationPhaseMeta(phase.id, { name: e.target.value })
                      }
                      placeholder="phase 이름"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: 'none',
                        background: 'transparent',
                        color: '#e8e9ec',
                        fontSize: 13,
                        fontWeight: 500,
                        outline: 'none',
                        padding: 0,
                        fontFamily: 'inherit',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    />
                    {hasCapturedPosition ? (
                      <span
                        style={{
                          fontSize: 9.5,
                          padding: '1px 6px',
                          borderRadius: 999,
                          background: 'rgba(103,180,255,0.18)',
                          color: FORMATION_ACCENT,
                          flexShrink: 0,
                        }}
                      >
                        캡쳐됨
                      </span>
                    ) : null}
                    {clusterCount > 0 ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#7ee787',
                          flexShrink: 0,
                        }}
                      >
                        그룹 {clusterCount}
                      </span>
                    ) : null}
                    <span
                      title="드래그해 순서 변경"
                      draggable
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(idx));
                        setDragPhaseIndex(idx);
                      }}
                      onDragEnd={() => {
                        setDragPhaseIndex(null);
                        setDragOverPhaseIndex(null);
                      }}
                      style={{
                        display: 'inline-flex',
                        color: 'rgba(255,255,255,0.28)',
                        cursor: 'grab',
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = FORMATION_ACCENT;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'rgba(255,255,255,0.28)';
                      }}
                    >
                      <DragIndicator sx={{ fontSize: 16 }} />
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.15fr 1fr 1fr 1fr 1fr',
                      gap: 5,
                      padding: '0 9px 8px',
                    }}
                  >
                    <div>
                      <div style={phaseCardLabelStyle}>지속</div>
                      <div style={{ position: 'relative' }}>
                        <input
                          value={holdMs}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            onUpdateFormationPhaseMeta(phase.id, {
                              holdMs:
                                e.target.value === '' ? 0 : Number(e.target.value),
                            })
                          }
                          placeholder="0"
                          title={`이 phase 완성 후 머무는 시간(ms) ≈ ${formatFormationHoldSec(holdMs)}초`}
                          inputMode="numeric"
                          style={{
                            ...formationFieldStyle,
                            paddingRight: 20,
                          }}
                        />
                        <span
                          style={{
                            position: 'absolute',
                            right: 5,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            fontSize: 9,
                            color: FORMATION_LABEL,
                            pointerEvents: 'none',
                          }}
                        >
                          ms
                        </span>
                      </div>
                    </div>
                    {renderAxisInput('X', 'x', px)}
                    {renderAxisInput('Y', 'y', py)}
                    {renderAxisInput('Z', 'z', pz)}
                    {renderAxisInput('Yaw°', 'yaw', pyaw)}
                  </div>

                  {isExpanded ? (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ padding: '10px 9px' }}>
                        <div style={{ ...phaseCardLabelStyle, marginBottom: 6 }}>
                          위치
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          <FormationActionButton
                            title="현재 3D 위치를 이 phase에 캡처"
                            onClick={() =>
                              droneId &&
                              onCaptureDronePositionInPhase(phase.id, droneId)
                            }
                            disabled={!droneId}
                            variant="primary"
                            style={phaseCardBtnStyle}
                          >
                            <GpsFixed sx={{ fontSize: 14, color: 'inherit' }} />
                            현재 위치 캡쳐
                          </FormationActionButton>
                          <FormationActionButton
                            title="이 phase의 위치로 드론을 이동"
                            onClick={() =>
                              droneId &&
                              onApplyDronePositionInPhase(phase.id, droneId)
                            }
                            disabled={!droneId || !hasCapturedPosition}
                            variant="ghost"
                            style={phaseCardBtnStyle}
                          >
                            <NearMe sx={{ fontSize: 14, color: 'inherit' }} />
                            이 위치로 이동
                          </FormationActionButton>
                          <FormationActionButton
                            title="이 드론의 캡처된 위치를 제거 (초기 위치로 fallback)"
                            onClick={() =>
                              droneId &&
                              onUpdateFormationDronePosition(phase.id, droneId, null)
                            }
                            disabled={!droneId || !hasCaptured}
                            variant="ghost"
                            style={phaseCardBtnStyle}
                          >
                            <LinkOff sx={{ fontSize: 14, color: 'inherit' }} />
                            캡쳐 해제
                          </FormationActionButton>
                          <FormationActionButton
                            title={
                              '이전 formation 위치에서 이 formation 위치까지 직선으로만 이동하도록 고정.\n' +
                              '고정된 드론들은 자동 회피/시차 대기 없이 전원 동시에 출발합니다.' +
                              (straightTargets.length > 1
                                ? `\n선택한 ${straightTargets.length}대(그룹)에 함께 적용됩니다.`
                                : '')
                            }
                            onClick={() =>
                              droneId && onToggleFixedStraight(phase.id, droneId)
                            }
                            disabled={!droneId}
                            variant={isFixedStraight ? 'accent' : 'ghost'}
                            style={phaseCardBtnStyle}
                          >
                            <Route sx={{ fontSize: 14, color: 'inherit' }} />
                            {isFixedStraight ? '직선 고정됨' : '직선 고정'}
                            {straightTargets.length > 1
                              ? ` (${straightTargets.length}대)`
                              : ''}
                          </FormationActionButton>
                          <FormationActionButton
                            title="등록된 모든 드론을 이 phase에서 직선 고정"
                            onClick={() => onSetAllFixedStraight(phase.id, true)}
                            disabled={droneCount === 0}
                            variant="ghost"
                            style={phaseCardBtnStyle}
                          >
                            <Groups sx={{ fontSize: 14, color: 'inherit' }} />
                            모두 직선 고정
                          </FormationActionButton>
                          {fixedPathCount > 0 ? (
                            <FormationActionButton
                              title="이 phase의 직선 고정을 모두 해제"
                              onClick={() => onSetAllFixedStraight(phase.id, false)}
                              variant="ghost"
                              style={{
                                ...phaseCardBtnStyle,
                                color: FORMATION_MUTED,
                              }}
                            >
                              <LinkOff sx={{ fontSize: 14, color: 'inherit' }} />
                              모두 해제 ({fixedPathCount})
                            </FormationActionButton>
                          ) : null}
                        </div>
                      </div>

                      <div style={{ padding: '0 9px 10px' }}>
                        <div style={{ ...phaseCardLabelStyle, marginBottom: 5 }}>
                          클러스터 (그룹 이동)
                        </div>
                        <p
                          style={{
                            margin: '0 0 7px',
                            fontSize: 11.5,
                            lineHeight: 1.5,
                            color: FORMATION_MUTED,
                          }}
                        >
                          이전 phase → 이 phase로 들어오는 전환에 적용됩니다. 그룹
                          드론은 상대 위치를 유지한 채 동시에 이동합니다.
                        </p>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                          }}
                        >
                          <FormationActionButton
                            title={
                              '좌측 "드론 선택" 탭에서 고른 드론들을 이 phase 전환의 ' +
                              '클러스터로 추가합니다 (2대 이상 선택 필요)'
                            }
                            onClick={() => onAddClusterToPhase(phase.id)}
                            disabled={multiSelectedDroneIds.length < 2}
                            variant="ghost"
                            style={phaseCardBtnStyle}
                          >
                            <Groups sx={{ fontSize: 14, color: 'inherit' }} />
                            선택 드론 그룹 추가 ({multiSelectedDroneIds.length})
                          </FormationActionButton>
                          {clusterCount === 0 ? (
                            <span
                              style={{
                                fontSize: 11,
                                color: 'rgba(255,255,255,0.28)',
                              }}
                            >
                              그룹 없음
                            </span>
                          ) : null}
                        </div>
                        {clusterCount > 0 ? (
                          <div
                            style={{
                              marginTop: 6,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                            }}
                          >
                            {phase.clusters.map((cluster, clusterIndex) => {
                              const members = (
                                Array.isArray(cluster) ? cluster : []
                              ).map(String);
                              const active =
                                members.length > 0 &&
                                members.every((memberId) =>
                                  multiSelectedSet.has(memberId)
                                );
                              return (
                                <div
                                  // eslint-disable-next-line react/no-array-index-key
                                  key={clusterIndex}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: active ? '3px 6px' : 0,
                                    borderRadius: 5,
                                    background: active
                                      ? 'rgba(195, 155, 255, 0.16)'
                                      : 'transparent',
                                    boxShadow: active
                                      ? 'inset 2px 0 0 #c39bff'
                                      : 'none',
                                    fontSize: 10.5,
                                    color: active ? '#e6dbff' : '#b9bbc2',
                                  }}
                                >
                                  <span
                                    style={{
                                      flex: 1,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      fontWeight: active ? 700 : 400,
                                    }}
                                    title={cluster.join(', ')}
                                  >
                                    그룹 {clusterIndex + 1} · {cluster.length}대
                                    {active ? ' · 선택됨' : ''} —{' '}
                                    {cluster.join(', ')}
                                  </span>
                                  <FormationActionButton
                                    title="이 그룹 해제"
                                    onClick={() =>
                                      onRemoveClusterFromPhase(
                                        phase.id,
                                        clusterIndex
                                      )
                                    }
                                    variant="danger"
                                    style={{
                                      fontSize: 10,
                                      padding: '3px 8px',
                                      height: 24,
                                    }}
                                  >
                                    해제
                                  </FormationActionButton>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>

                      <div style={{ padding: '0 9px 10px' }}>
                        <div style={{ ...phaseCardLabelStyle, marginBottom: 6 }}>
                          전체 드론 ({droneCount}대)
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          <FormationActionButton
                            title="격자 툴로 이 phase 대형 수정"
                            onClick={() => onEditFormationPhaseGrid(phase.id)}
                            variant="primary"
                            disabled={droneCount === 0}
                            style={phaseCardBtnStyle}
                          >
                            <GridOn sx={{ fontSize: 14, color: 'inherit' }} />
                            그리드 수정
                          </FormationActionButton>
                          <FormationActionButton
                            title="이 phase에 저장된 좌표로 등록된 모든 드론 이동"
                            onClick={() => onApplyAllDronesInPhase(phase.id)}
                            disabled={droneCount === 0}
                            variant="ghost"
                            style={phaseCardBtnStyle}
                          >
                            <Groups sx={{ fontSize: 14, color: 'inherit' }} />
                            모두 이 위치로 이동
                          </FormationActionButton>
                          <FormationActionButton
                            title="이 phase에 모든 드론의 현재 위치를 다시 캡처"
                            onClick={() => onCaptureAllPositionsInPhase(phase.id)}
                            variant="ghost"
                            style={phaseCardBtnStyle}
                          >
                            <Replay sx={{ fontSize: 14, color: 'inherit' }} />
                            모두 재캡쳐
                          </FormationActionButton>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            marginTop: 6,
                          }}
                        >
                          <span
                            style={{
                              ...phaseCardLabelStyle,
                              marginBottom: 0,
                              flexShrink: 0,
                            }}
                          >
                            Yaw 일괄
                          </span>
                          <input
                            value={bulkYawDrafts[phase.id] ?? ''}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setBulkYawDrafts((prev) => ({
                                ...prev,
                                [phase.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return;
                              e.preventDefault();
                              e.currentTarget.blur();
                              const value = Number(bulkYawDrafts[phase.id]);
                              if (Number.isFinite(value)) {
                                onSetAllYawInPhase(phase.id, value);
                              }
                            }}
                            placeholder="0"
                            inputMode="decimal"
                            title="이 phase에 좌표가 있는 모든 드론의 yaw를 이 값으로 덮어씁니다 (°)"
                            style={{ ...formationFieldStyle, width: 72, flex: '0 0 auto' }}
                          />
                          <FormationActionButton
                            title="이 phase의 모든 드론 yaw를 입력값으로 한 번에 기입"
                            onClick={() => {
                              const value = Number(bulkYawDrafts[phase.id]);
                              if (!Number.isFinite(value)) return;
                              onSetAllYawInPhase(phase.id, value);
                            }}
                            disabled={
                              !Number.isFinite(Number(bulkYawDrafts[phase.id])) ||
                              (bulkYawDrafts[phase.id] ?? '') === ''
                            }
                            variant="ghost"
                            style={phaseCardBtnStyle}
                          >
                            전체 기입
                          </FormationActionButton>
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '8px 9px',
                          borderTop: '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        <FormationActionButton
                          title="이 phase 복제"
                          onClick={() => onDuplicateFormationPhase(phase.id)}
                          variant="ghost"
                          style={phaseCardBtnStyle}
                        >
                          <ContentCopy sx={{ fontSize: 13, color: 'inherit' }} />
                          복제
                        </FormationActionButton>
                        <span style={{ flex: 1 }} />
                        <FormationActionButton
                          title="이 phase 삭제"
                          onClick={() => onRemoveFormationPhase(phase.id)}
                          variant="danger"
                          style={phaseCardBtnStyle}
                        >
                          <DeleteOutline sx={{ fontSize: 14, color: 'inherit' }} />
                          삭제
                        </FormationActionButton>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            </>
          )}
        </div>

        <div
          style={{
            marginTop: 18,
            padding: 14,
            ...formationSurfaceStyle,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 10, color: '#e8e9ec' }}>
            전송 옵션
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8,
            }}
          >
            {[
              { key: 'step_size', label: 'step_size', placeholder: '1.0' },
              {
                key: 'cruise_speed',
                label: 'cruise_speed',
                placeholder: '0.1',
                title: 'm/s. duration_ms 대신 전송해 서버 cruise 속도를 사용합니다.',
              },
              {
                key: 'takeoff_time',
                label: 'takeoff_time',
                placeholder: '0 = 생략',
                title: '0이면 페이로드에 포함되지 않습니다 (옵션값)',
              },
              {
                key: 'min_separation',
                label: '최소 간격 (m)',
                placeholder: '1.45',
                title:
                  '드론 간 최소 간격 (모든 축 기준, m). 절대 하한 1.45 m — ' +
                  '그보다 작은 값을 입력해도 1.45로 강제됩니다. ' +
                  '초기 배치·모든 phase 좌표·비행 중 경로 전부에 적용됩니다.',
              },
              // landing_spacing은 여기 두면 눈에 안 띄어서, 아래 landing_grid
              // 체크박스 바로 옆에 한 세트로 붙여 렌더링한다.
            ].map(({ key, label, placeholder, title }) => {
              const displayValue =
                formationSettingsDrafts[key] ??
                String(safeFormationSettings[key] ?? '');
              return (
                <div key={key}>
                  <div
                    style={{
                      fontSize: 10,
                      color: FORMATION_DIM,
                      marginBottom: 4,
                    }}
                  >
                    {label}
                  </div>
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
                    inputMode={
                      key === 'step_size' || key === 'cruise_speed'
                        ? 'decimal'
                        : 'numeric'
                    }
                    placeholder={placeholder}
                    title={title}
                    style={formationFieldStyle}
                  />
                </div>
              );
            })}
          </div>

          {/* 관성 속도 프로파일: cruise_speed 아래에서 곡선을 직접 보며
              가속 램프 / 등속 plateau / 감속 램프를 각각 조절한다. 전역
              공유값이라 모든 생성 요청(plan/delivery/skyc 패치)에 함께 적용된다.
              plateau 폭은 남는 값(1 - 가속폭 - 감속폭)이라 별도 노브가 없고,
              0이 되면 남는 등속 구간이 없으므로 양쪽 램프를 등속으로 잠근다. */}
          <div
            style={{
              marginTop: 10,
              padding: '10px 10px 8px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.09)',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            <VelocityProfileChart
              profile={effectiveProfile}
              width={252}
              height={104}
            />

            {/* 램프 모양 선택 (가속 / 감속). plateau가 눌리면 비활성화된다. */}
            {[
              {
                key: 'accel',
                label: '가속 램프',
                value: profileKnobs.accelShape,
                onChange: handleAccelShape,
                title:
                  '가속 램프의 모양. exp = 출발이 완만하고 등속 직전에 가속이 몰림, ' +
                  'log = 출발이 급하고 등속에 부드럽게 붙음, linear = 일정 가속, ' +
                  'none = 가속 램프 없이 곧바로 등속.',
              },
              {
                key: 'decel',
                label: '감속 램프',
                value: profileKnobs.decelShape,
                onChange: handleDecelShape,
                title:
                  '감속 램프의 모양. 시간이 거꾸로 대입되므로 exp = 도착 순간이 ' +
                  '가장 완만(오버슛에 유리), log = 도착 순간에 제동이 가장 강함, ' +
                  'linear = 일정 감속, none = 감속 없이 등속으로 도착.',
              },
            ].map(({ key, label, value, onChange, title }) => (
              <div
                key={key}
                title={title}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 6,
                  opacity: plateauLocked ? 0.45 : 1,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: FORMATION_DIM,
                    width: 108,
                    flexShrink: 0,
                  }}
                >
                  {label}
                </span>
                <select
                  value={value}
                  disabled={plateauLocked}
                  onChange={(e) => onChange(e.target.value)}
                  style={{
                    flex: 1,
                    fontSize: 11,
                    padding: '2px 4px',
                    borderRadius: 4,
                    background: 'rgba(255,255,255,0.06)',
                    color: '#d3d5db',
                    border: '1px solid rgba(255,255,255,0.12)',
                    cursor: plateauLocked ? 'not-allowed' : 'pointer',
                  }}
                >
                  {RAMP_SHAPES.map((s) => (
                    <option key={s} value={s} style={{ background: '#22242a' }}>
                      {RAMP_SHAPE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            ))}

            {plateauLocked && (
              <div
                style={{
                  fontSize: 10,
                  marginTop: 6,
                  padding: '4px 6px',
                  borderRadius: 4,
                  color: '#ffb26b',
                  background: 'rgba(255, 178, 107, 0.10)',
                  lineHeight: 1.4,
                }}
              >
                {profileKnobs.smoothing <= 0
                  ? '스무딩 0 — 구간 전체가 등속입니다.'
                  : '등속 구간 0% — 남는 plateau가 없어 양쪽 램프를 등속으로 고정했습니다. 폭을 줄이면 해제됩니다.'}
              </div>
            )}

            {[
              {
                label: '스무딩 (마스터)',
                value: profileKnobs.smoothing,
                min: 0,
                max: 1,
                step: 0.05,
                onChange: handleProfileSmoothing,
                disabled: false,
                title:
                  '0 = 관성 없음(구간 전체 등속). 코너에서의 감속량도 함께 정합니다 ' +
                  '(1 = 방향 전환마다 완전 정지). 램프 폭을 직접 지정하지 않았다면 폭도 이 값을 따릅니다.',
              },
              {
                label: '가속 폭 a',
                value: profileKnobs.accelWidth,
                min: 0,
                max: 1,
                step: 0.05,
                onChange: handleAccelWidth,
                disabled: false,
                title:
                  '가속 램프가 구간에서 차지하는 비율. 등속 plateau는 남는 1 - a - b이며, ' +
                  'a + b가 1을 넘지 않도록 반대쪽이 밀려납니다.',
              },
              {
                label: '감속 폭 b',
                value: profileKnobs.decelWidth,
                min: 0,
                max: 1,
                step: 0.05,
                onChange: handleDecelWidth,
                disabled: false,
                title:
                  '감속 램프가 구간에서 차지하는 비율. 등속 plateau는 남는 1 - a - b입니다.',
              },
              {
                label: '가속 곡률 kₐ',
                value: profileKnobs.accelCurve,
                min: PROFILE_THICKNESS_MIN,
                max: PROFILE_THICKNESS_MAX,
                step: 0.05,
                onChange: handleProfileExp,
                disabled: plateauLocked || profileKnobs.accelShape === 'none',
                title:
                  '가속 램프의 곡률. 작을수록 직선에 가깝고, 클수록 모양(exp/log)이 뚜렷해집니다. linear에는 영향이 없습니다.',
              },
              {
                label: '감속 곡률 k_d',
                value: profileKnobs.decelCurve,
                min: PROFILE_THICKNESS_MIN,
                max: PROFILE_THICKNESS_MAX,
                step: 0.05,
                onChange: handleProfileLog,
                disabled: plateauLocked || profileKnobs.decelShape === 'none',
                title:
                  '감속 램프의 곡률. log 모양에서는 클수록 도착 직전 제동이 강해져 오버슛이 커집니다. linear에는 영향이 없습니다.',
              },
            ].map(({ label, value, min, max, step, onChange, title, disabled }) => (
              <div
                key={label}
                title={title}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 6,
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: FORMATION_DIM,
                    width: 108,
                    flexShrink: 0,
                  }}
                >
                  {label}
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  disabled={disabled}
                  onChange={(e) => onChange(e.target.value)}
                  style={{
                    flex: 1,
                    accentColor: '#67b4ff',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: '#c9cbd2',
                    width: 30,
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {Number(value).toFixed(2)}
                </span>
              </div>
            ))}

            {/* plateau는 파생값이라 슬라이더가 없고 읽기 전용으로만 보여준다. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginTop: 8,
                paddingTop: 6,
                borderTop: '1px solid rgba(255,255,255,0.08)',
                fontSize: 10,
                color: FORMATION_DIM,
              }}
            >
              <span
                title="등속 유지 구간의 폭. 1 - 가속폭 - 감속폭으로 자동 계산됩니다."
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                등속 구간 {(effectiveProfile.plateauWidth * 100).toFixed(0)}%
              </span>
              <button
                type="button"
                onClick={handleResetWidths}
                disabled={profileKnobs.widthsLinked}
                title="가속·감속 폭을 다시 스무딩 값에 연동시킵니다."
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.06)',
                  color: profileKnobs.widthsLinked ? FORMATION_DIM : '#d3d5db',
                  cursor: profileKnobs.widthsLinked ? 'default' : 'pointer',
                  opacity: profileKnobs.widthsLinked ? 0.5 : 1,
                }}
              >
                {profileKnobs.widthsLinked ? '스무딩 연동 중' : '폭 연동 복구'}
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              marginTop: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <label
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                fontSize: 12,
                cursor: 'pointer',
                color: '#d3d5db',
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
            <div
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                fontSize: 12,
                color: '#d3d5db',
              }}
              title="복귀(return-to-start) 시 착륙 지점을 이륙 지점보다 이 간격만큼 넓게 벌립니다. 체크해야 적용됩니다."
            >
              <label
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={!!safeFormationSettings.landing_grid}
                  onChange={(e) =>
                    onUpdateFormationSettings({ landing_grid: e.target.checked })
                  }
                />
                <span>landing_grid</span>
              </label>
              <input
                value={
                  formationSettingsDrafts.landing_spacing ??
                  String(safeFormationSettings.landing_spacing ?? '')
                }
                disabled={!safeFormationSettings.landing_grid}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!isPartialDecimalInput(raw)) return;
                  setFormationSettingsDrafts((prev) => ({
                    ...prev,
                    landing_spacing: raw,
                  }));
                  if (raw === '' || raw === '-' || raw.endsWith('.')) return;
                  commitFormationSetting('landing_spacing', raw);
                }}
                onBlur={() => {
                  const raw = formationSettingsDrafts.landing_spacing;
                  if (raw === undefined) return;
                  setFormationSettingsDrafts((prev) => {
                    const next = { ...prev };
                    delete next.landing_spacing;
                    return next;
                  });
                  commitFormationSetting('landing_spacing', raw);
                }}
                inputMode="decimal"
                placeholder="4.0"
                style={{
                  ...formationFieldStyle,
                  width: 52,
                  flex: '0 0 auto',
                  opacity: safeFormationSettings.landing_grid ? 1 : 0.4,
                }}
              />
              <span style={{ fontSize: 10.5, color: FORMATION_MUTED }}>m</span>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 140 }}>
              <span style={{ fontSize: 10.5, color: FORMATION_MUTED }}>output</span>
              <select
                value={safeFormationSettings.output ?? ''}
                onChange={(e) =>
                  onUpdateFormationSettings({ output: e.target.value })
                }
                title="기본값(미지정)이면 백엔드가 .skyc 파일을 응답으로 보냅니다."
                style={{
                  ...formationFieldStyle,
                  flex: 1,
                  padding: '8px 10px',
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

        <div style={{ marginTop: 10 }}>
          <FormationActionButton
            title={
              isSendingFormation
                ? '전달 중...'
                : formationPhases.length === 0
                  ? 'phase를 먼저 추가하세요'
                  : '포메이션 전달하기'
            }
            onClick={onSendFormationPlan}
            disabled={isSendingFormation || formationPhases.length === 0}
            variant="primary"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 9,
              fontSize: 12.5,
            }}
          >
            <Send sx={{ fontSize: 16, color: 'inherit' }} />
            {isSendingFormation
              ? `전달 중... ${sendElapsedSec}s (계획 계산에는 수 분이 걸릴 수 있습니다)`
              : '포메이션 전달'}
          </FormationActionButton>
        </div>

        {formationDeliveryStatus && (
          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              fontSize: 11.5,
              whiteSpace: 'pre-line',
              color: FORMATION_MUTED,
              ...formationSurfaceStyle,
            }}
          >
            {formationDeliveryStatus}
          </div>
        )}

        <PlanFailureReport
          failure={formationFailure}
          onDismiss={onDismissFormationFailure}
        />
      </>
    );
  };

  return (
    <div
      data-three-d-ui="true"
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
        zIndex: 12050,
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(10px)',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>애니메이션 편집</div>
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

      {drone && (
        <div style={{ marginTop: 12 }}>
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
                gap: 6,
                paddingTop: 4,
                marginBottom: 4,
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
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '8px 4px 12px',
                      marginLeft: tab.id === 'formation' ? 8 : 0,
                      border: 'none',
                      borderBottom: active
                        ? `2px solid ${FORMATION_ACCENT}`
                        : '2px solid transparent',
                      background: 'transparent',
                      color: active ? '#e8e9ec' : FORMATION_MUTED,
                      cursor: 'pointer',
                      fontWeight: active ? 700 : 600,
                      fontSize: 13,
                      fontFamily: 'inherit',
                    }}
                  >
                    {tab.label}
                    {tab.id === 'formation' && formationPhases.length > 0 ? (
                      <span
                        style={{
                          background: FORMATION_ACCENT,
                          color: '#06121f',
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: '1px 7px',
                          borderRadius: 20,
                        }}
                      >
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
    cruise_speed: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    min_separation: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    takeoff_time: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    auto_upload: PropTypes.bool,
    output: PropTypes.string,
    landing_grid: PropTypes.bool,
    landing_spacing: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }),
  isSendingFormation: PropTypes.bool,
  formationSendStartedAt: PropTypes.number,
  formationDeliveryStatus: PropTypes.string,
  formationFailure: PropTypes.object,
  onDismissFormationFailure: PropTypes.func,
  onAddFormationPhase: PropTypes.func,
  onOpenFormationGrid: PropTypes.func,
  onEditFormationPhaseGrid: PropTypes.func,
  onAppendReversedFormationPhases: PropTypes.func,
  onRecoverReversedFormationPhases: PropTypes.func,
  canRecoverReversedFormationPhases: PropTypes.bool,
  onRemoveFormationPhase: PropTypes.func,
  onMoveFormationPhase: PropTypes.func,
  onReorderFormationPhase: PropTypes.func,
  onDuplicateFormationPhase: PropTypes.func,
  onUpdateFormationPhaseMeta: PropTypes.func,
  onUpdateFormationDronePosition: PropTypes.func,
  onCaptureDronePositionInPhase: PropTypes.func,
  onCaptureAllPositionsInPhase: PropTypes.func,
  onToggleFixedStraight: PropTypes.func,
  onSetAllFixedStraight: PropTypes.func,
  onSetAllYawInPhase: PropTypes.func,
  selectedPhaseId: PropTypes.string,
  onTogglePhaseSelected: PropTypes.func,
  multiSelectedDroneIds: PropTypes.arrayOf(PropTypes.string),
  onAddClusterToPhase: PropTypes.func,
  onRemoveClusterFromPhase: PropTypes.func,
  onOpenImageDots: PropTypes.func,
  onApplyDronePositionInPhase: PropTypes.func,
  onApplyAllDronesInPhase: PropTypes.func,
  onUpdateFormationSettings: PropTypes.func,
  onSendFormationPlan: PropTypes.func,
  onDownloadSkyc: PropTypes.func,
  isDownloadingSkyc: PropTypes.bool,
  skycDownloadStatus: PropTypes.string,
};
