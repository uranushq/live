import Add from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import Download from '@mui/icons-material/Download';
import FolderOpen from '@mui/icons-material/FolderOpen';
import GridOn from '@mui/icons-material/GridOn';
import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp';
import Pause from '@mui/icons-material/Pause';
import PlayArrow from '@mui/icons-material/PlayArrow';
import Replay from '@mui/icons-material/Replay';
import Save from '@mui/icons-material/Save';
import Tune from '@mui/icons-material/Tune';
import Tooltip from '@mui/material/Tooltip';
import PropTypes from 'prop-types';
import React from 'react';

import VelocityProfileChart from './VelocityProfileChart';
import {
  getProfileExp,
  getProfileLog,
  getVelocitySmoothing,
  setVelocitySmoothing,
  subscribeSmoothingKnobs,
} from './utils/pathSmoothing';

const ACCENT = '#67b4ff';
const NEUTRAL_300 = 'rgba(255,255,255,0.72)';
const NEUTRAL_400 = 'rgba(255,255,255,0.48)';
const NEUTRAL_700 = 'rgba(255,255,255,0.12)';
const NEUTRAL_900 = '#14161e';

const formatMs = (ms) => {
  const safe = Math.max(0, Math.round(Number(ms) || 0));
  const totalSec = Math.floor(safe / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

const iconButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  padding: 0,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  transition: 'background 0.15s ease, opacity 0.15s ease, color 0.15s ease',
};

const popoverStyle = {
  position: 'absolute',
  bottom: 'calc(100% + 10px)',
  width: 300,
  background: NEUTRAL_900,
  border: `1px solid ${NEUTRAL_700}`,
  borderRadius: 10,
  boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
  padding: '14px 16px',
  zIndex: 2,
  pointerEvents: 'auto',
};

const sectionLabelStyle = {
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: NEUTRAL_400,
  marginBottom: 12,
};

function ActionIconButton({
  title,
  onClick,
  disabled,
  iconColor,
  children,
  // 'wait' fits a button disabled because it is busy; a button disabled
  // because there is nothing to act on should not imply something is running.
  disabledCursor = 'wait',
}) {
  return (
    <Tooltip title={title} placement='top'>
      <button
        type='button'
        onClick={onClick}
        disabled={disabled}
        style={{
          ...iconButtonStyle,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? disabledCursor : 'pointer',
          color: iconColor,
        }}
        onMouseEnter={(e) => {
          if (!disabled)
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {React.cloneElement(children, {
          sx: { fontSize: 16, color: 'inherit' },
        })}
      </button>
    </Tooltip>
  );
}

ActionIconButton.propTypes = {
  title: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  iconColor: PropTypes.string.isRequired,
  children: PropTypes.element.isRequired,
};

function ToggleRow({ label, checked, onChange, title }) {
  const row = (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        fontSize: 13,
        padding: '6px 0',
        cursor: 'pointer',
        color: NEUTRAL_300,
        userSelect: 'none',
      }}
    >
      <span>{label}</span>
      <input
        type='checkbox'
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          accentColor: ACCENT,
          width: 16,
          height: 16,
          cursor: 'pointer',
        }}
      />
    </label>
  );

  return title ? (
    <Tooltip title={title} placement='left'>
      {row}
    </Tooltip>
  ) : (
    row
  );
}

ToggleRow.propTypes = {
  label: PropTypes.string.isRequired,
  checked: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  title: PropTypes.string,
};

export default function PathControlPanel({
  fileInputRef,
  pathProgress,
  onPathProgressChange,
  currentPositionMs,
  totalDurationMs,
  playbackSourceLabel,
  showSpecActive = false,
  showSpecIgnored = false,
  onToggleShowSpecIgnored = () => {},
  isPlaybackRunning,
  ledSyncEnabled,
  onLedSyncToggle,
  droneCount,
  onPlayAll,
  onPausePlayback,
  onResetAll,
  onResetPanelSettings,
  onLoadConfigClick,
  onSaveConfigClick,
  onSendPathsClick,
  onFileChange,
  onAddDroneClick,
  onOpenInitialGrid,
  isSendingPaths,
  pathDeliveryStatus,
}) {
  const progress = Math.min(100, Math.max(0, Number(pathProgress) || 0));

  const [smoothing, setSmoothing] = React.useState(getVelocitySmoothing());
  const handleSmoothingChange = (value) => {
    setSmoothing(setVelocitySmoothing(value));
  };

  const [profileOpen, setProfileOpen] = React.useState(false);
  const [panel, setPanel] = React.useState(null); // 'status' | 'settings' | null
  const [profileKnobs, setProfileKnobs] = React.useState(() => ({
    exp: getProfileExp(),
    log: getProfileLog(),
  }));

  React.useEffect(
    () =>
      subscribeSmoothingKnobs(() => {
        setSmoothing(getVelocitySmoothing());
        setProfileKnobs({ exp: getProfileExp(), log: getProfileLog() });
      }),
    []
  );

  const openPanel = (next) => {
    setPanel((prev) => (prev === next ? null : next));
  };

  const sourceParts = String(playbackSourceLabel || '')
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
  const sourceLabel = sourceParts[0] || '3D JSON';
  const pathModeLabel = sourceParts.slice(1).join(' · ') || '수동 경로';
  const chipLabel = `${playbackSourceLabel} · ${droneCount}대`;

  return (
    <>
      <style>{`
        .path-control-range {
          -webkit-appearance: none;
          appearance: none;
          flex: 1;
          height: 4px;
          border-radius: 999px;
          outline: none;
          cursor: pointer;
          background: linear-gradient(
            to right,
            ${ACCENT} 0%,
            ${ACCENT} ${progress}%,
            rgba(255, 255, 255, 0.12) ${progress}%,
            rgba(255, 255, 255, 0.12) 100%
          );
        }
        .path-control-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #fff;
          border: none;
          box-shadow: 0 0 0 2px rgba(103, 180, 255, 0.35);
        }
        .path-control-range::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #fff;
          border: none;
          box-shadow: 0 0 0 2px rgba(103, 180, 255, 0.35);
        }
        .path-control-range::-moz-range-track {
          height: 4px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.12);
        }
        .path-control-smooth {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 999px;
          outline: none;
          cursor: pointer;
          background: linear-gradient(
            to right,
            ${ACCENT} 0%,
            ${ACCENT} ${smoothing * 100}%,
            rgba(255, 255, 255, 0.12) ${smoothing * 100}%,
            rgba(255, 255, 255, 0.12) 100%
          );
        }
        .path-control-smooth::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #fff;
          border: none;
        }
        .path-control-smooth::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #fff;
          border: none;
        }
      `}</style>

      <input
        type='file'
        accept='application/json'
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={onFileChange}
      />

      {panel ? (
        <div
          role='presentation'
          onClick={() => setPanel(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10990,
            pointerEvents: 'auto',
          }}
        />
      ) : null}

      <div
        data-three-d-ui='true'
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 20,
          transform: 'translateX(-50%)',
          zIndex: 11000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          pointerEvents: 'none',
          width: 'min(720px, calc(100% - 32px))',
        }}
      >
        {pathDeliveryStatus && (
          <div
            style={{
              pointerEvents: 'auto',
              padding: '5px 12px',
              borderRadius: 8,
              background: 'rgba(20, 22, 26, 0.92)',
              border: `1px solid ${NEUTRAL_700}`,
              color: NEUTRAL_300,
              fontSize: 11,
              whiteSpace: 'pre-line',
              maxWidth: '100%',
              textAlign: 'center',
            }}
          >
            {pathDeliveryStatus}
          </div>
        )}

        {profileOpen && (
          <div
            style={{
              pointerEvents: 'auto',
              alignSelf: 'flex-end',
              padding: '10px 12px',
              borderRadius: 10,
              background: NEUTRAL_900,
              border: `1px solid ${NEUTRAL_700}`,
              boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
            }}
          >
            <VelocityProfileChart
              smoothing={smoothing}
              kExp={profileKnobs.exp}
              kLog={profileKnobs.log}
              width={320}
              height={140}
            />
          </div>
        )}

        <div
          style={{ position: 'relative', width: '100%', pointerEvents: 'auto' }}
        >
          {panel === 'status' && (
            <div style={{ ...popoverStyle, left: 0, width: 320 }}>
              <div style={{ ...sectionLabelStyle, marginBottom: 10 }}>
                시퀀스 정보
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '88px 1fr',
                  gap: '8px 12px',
                  fontSize: 13,
                  color: NEUTRAL_300,
                }}
              >
                <span style={{ color: NEUTRAL_400 }}>소스</span>
                <span>{sourceLabel}</span>
                <span style={{ color: NEUTRAL_400 }}>경로 모드</span>
                <span>{pathModeLabel}</span>
                <span style={{ color: NEUTRAL_400 }}>드론</span>
                <span>{droneCount}대</span>
                <span style={{ color: NEUTRAL_400 }}>길이</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMs(totalDurationMs)}
                </span>
                <span style={{ color: NEUTRAL_400 }}>LED 동기화</span>
                <span>{ledSyncEnabled ? '켜짐' : '꺼짐'}</span>
                <span style={{ color: NEUTRAL_400 }}>스무딩</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {smoothing.toFixed(2)}
                </span>
              </div>
              {showSpecActive ? (
                <button
                  type='button'
                  onClick={onToggleShowSpecIgnored}
                  title={
                    showSpecIgnored
                      ? '로드된 .skyc 쇼 스펙을 다시 표시합니다'
                      : '로드된 .skyc 쇼 스펙을 잠시 해제하고 수동 편집으로 돌아갑니다.'
                  }
                  style={{
                    marginTop: 12,
                    width: '100%',
                    border: `1px solid ${NEUTRAL_700}`,
                    background: showSpecIgnored
                      ? 'rgba(103, 180, 255, 0.18)'
                      : 'rgba(255,255,255,0.04)',
                    color: NEUTRAL_300,
                    borderRadius: 8,
                    fontSize: 12,
                    padding: '8px 10px',
                    cursor: 'pointer',
                  }}
                >
                  {showSpecIgnored ? '쇼 스펙 다시 보기' : '← 수동 편집으로'}
                </button>
              ) : null}
            </div>
          )}

          {panel === 'settings' && (
            <div style={{ ...popoverStyle, right: 0 }}>
              <div style={sectionLabelStyle}>재생 옵션</div>
              <ToggleRow
                label='LED 동기화'
                checked={ledSyncEnabled}
                onChange={onLedSyncToggle}
                title='LED 시뮬레이션과 동기화'
              />
              <ToggleRow
                label='곡선 보간'
                checked={profileOpen}
                onChange={setProfileOpen}
                title='관성 속도 프로파일 그래프 (지수 가속 · 로그 감속 곡선)'
              />
              <div
                style={{
                  height: 1,
                  background: NEUTRAL_700,
                  margin: '12px 0',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  marginBottom: 8,
                  color: NEUTRAL_300,
                }}
              >
                <span>스무딩</span>
                <span
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    color: NEUTRAL_400,
                  }}
                >
                  {smoothing.toFixed(2)}
                </span>
              </div>
              <Tooltip
                title='속도 스무딩: 0 = 기존 등속, 1 = 최대(코너에서 정지). 모든 경로에 공통 적용.'
                placement='top'
              >
                <input
                  type='range'
                  className='path-control-smooth'
                  min={0}
                  max={1}
                  step={0.05}
                  value={smoothing}
                  onChange={(e) => handleSmoothingChange(e.target.value)}
                />
              </Tooltip>
            </div>
          )}

          <div
            style={{
              background: 'linear-gradient(180deg, #1d1f2e 0%, #191b28 100%)',
              border: `1px solid ${NEUTRAL_700}`,
              borderRadius: 10,
              boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px 6px',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontVariantNumeric: 'tabular-nums',
                  color: NEUTRAL_400,
                  minWidth: 36,
                }}
              >
                {formatMs(currentPositionMs)}
              </span>
              <input
                type='range'
                className='path-control-range'
                min='0'
                max='100'
                step='0.1'
                value={pathProgress}
                onChange={(e) => onPathProgressChange(e.target.value)}
              />
              <span
                style={{
                  fontSize: 11,
                  fontVariantNumeric: 'tabular-nums',
                  color: NEUTRAL_400,
                  minWidth: 36,
                  textAlign: 'right',
                }}
              >
                {formatMs(totalDurationMs)}
              </span>
            </div>

            <div
              style={{
                height: 1,
                background: `linear-gradient(90deg, transparent 0%, ${NEUTRAL_700} 32px, ${NEUTRAL_700} calc(100% - 32px), transparent 100%)`,
              }}
            />

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px 8px',
              }}
            >
              <Tooltip
                title={isPlaybackRunning ? '일시정지' : '재생'}
                placement='top'
              >
                <button
                  type='button'
                  onClick={isPlaybackRunning ? onPausePlayback : onPlayAll}
                  style={{
                    ...iconButtonStyle,
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: ACCENT,
                    color: '#0b1020',
                  }}
                >
                  {isPlaybackRunning ? (
                    <Pause sx={{ fontSize: 17, color: 'inherit' }} />
                  ) : (
                    <PlayArrow
                      sx={{ fontSize: 18, color: 'inherit', ml: '1px' }}
                    />
                  )}
                </button>
              </Tooltip>

              <Tooltip title='원위치' placement='top'>
                <button
                  type='button'
                  onClick={onResetAll}
                  style={{
                    ...iconButtonStyle,
                    color: NEUTRAL_300,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <Replay sx={{ fontSize: 16, color: 'inherit' }} />
                </button>
              </Tooltip>

              <button
                type='button'
                onClick={() => openPanel('status')}
                style={{
                  height: 26,
                  padding: '0 10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: NEUTRAL_300,
                  borderRadius: 999,
                  border: `1px solid ${NEUTRAL_700}`,
                  background:
                    panel === 'status'
                      ? 'rgba(103, 180, 255, 0.12)'
                      : 'transparent',
                  cursor: 'pointer',
                  maxWidth: 220,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: ACCENT,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {chipLabel}
                </span>
                <KeyboardArrowUp
                  sx={{ fontSize: 12, color: 'inherit', flexShrink: 0 }}
                />
              </button>

              <div style={{ flex: 1 }} />

              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <ActionIconButton
                  title='파일 열기'
                  onClick={onLoadConfigClick}
                  iconColor={NEUTRAL_300}
                >
                  <FolderOpen />
                </ActionIconButton>
                <ActionIconButton
                  title='저장'
                  onClick={onSaveConfigClick}
                  iconColor={NEUTRAL_300}
                >
                  <Save />
                </ActionIconButton>
                <ActionIconButton
                  title='추가'
                  onClick={onAddDroneClick}
                  iconColor={NEUTRAL_300}
                >
                  <Add />
                </ActionIconButton>
                <ActionIconButton
                  title={
                    droneCount > 0
                      ? '초기 위치 일괄 배치'
                      : '드론이 없습니다'
                  }
                  onClick={onOpenInitialGrid}
                  disabled={!droneCount}
                  disabledCursor='not-allowed'
                  iconColor={NEUTRAL_300}
                >
                  <GridOn />
                </ActionIconButton>
                <ActionIconButton
                  title={isSendingPaths ? '다운로드 중...' : '내보내기'}
                  onClick={onSendPathsClick}
                  disabled={isSendingPaths}
                  iconColor={NEUTRAL_300}
                >
                  <Download />
                </ActionIconButton>
              </div>

              <div
                style={{
                  width: 1,
                  height: 18,
                  background: NEUTRAL_700,
                }}
              />

              <ActionIconButton
                title='재생 옵션'
                onClick={() => openPanel('settings')}
                iconColor={panel === 'settings' ? ACCENT : NEUTRAL_300}
              >
                <Tune />
              </ActionIconButton>
              <ActionIconButton
                title='삭제'
                onClick={onResetPanelSettings}
                iconColor={NEUTRAL_400}
              >
                <DeleteOutline />
              </ActionIconButton>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

PathControlPanel.propTypes = {
  fileInputRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  pathProgress: PropTypes.oneOfType([PropTypes.number, PropTypes.string])
    .isRequired,
  onPathProgressChange: PropTypes.func.isRequired,
  currentPositionMs: PropTypes.number.isRequired,
  totalDurationMs: PropTypes.number.isRequired,
  playbackSourceLabel: PropTypes.string.isRequired,
  showSpecActive: PropTypes.bool,
  showSpecIgnored: PropTypes.bool,
  onToggleShowSpecIgnored: PropTypes.func,
  isPlaybackRunning: PropTypes.bool.isRequired,
  ledSyncEnabled: PropTypes.bool.isRequired,
  onLedSyncToggle: PropTypes.func.isRequired,
  droneCount: PropTypes.number.isRequired,
  onPlayAll: PropTypes.func.isRequired,
  onPausePlayback: PropTypes.func.isRequired,
  onResetAll: PropTypes.func.isRequired,
  onResetPanelSettings: PropTypes.func.isRequired,
  onLoadConfigClick: PropTypes.func.isRequired,
  onSaveConfigClick: PropTypes.func.isRequired,
  onSendPathsClick: PropTypes.func.isRequired,
  onFileChange: PropTypes.func.isRequired,
  onAddDroneClick: PropTypes.func.isRequired,
  /** 모든 드론의 초기(이륙) 위치를 격자 편집기로 한꺼번에 다시 놓는다 */
  onOpenInitialGrid: PropTypes.func.isRequired,
  isSendingPaths: PropTypes.bool.isRequired,
  pathDeliveryStatus: PropTypes.string.isRequired,
};
