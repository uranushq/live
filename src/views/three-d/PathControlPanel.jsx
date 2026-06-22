import Add from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import Download from '@mui/icons-material/Download';
import FolderOpen from '@mui/icons-material/FolderOpen';
import Pause from '@mui/icons-material/Pause';
import PlayArrow from '@mui/icons-material/PlayArrow';
import Replay from '@mui/icons-material/Replay';
import Save from '@mui/icons-material/Save';
import Tooltip from '@mui/material/Tooltip';
import PropTypes from 'prop-types';
import React, { useState } from 'react';

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
  width: 32,
  height: 32,
  padding: 0,
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  transition: 'background 0.15s ease, opacity 0.15s ease',
};

const panelSurface = {
  background: 'rgba(20, 22, 26, 0.88)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  backdropFilter: 'blur(10px)',
};

function ActionIconButton({
  title,
  onClick,
  disabled,
  background,
  iconColor,
  children,
}) {
  return (
    <Tooltip title={title} placement='top'>
      <button
        type='button'
        onClick={onClick}
        disabled={disabled}
        style={{
          ...iconButtonStyle,
          background,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? 'wait' : 'pointer',
        }}
      >
        {React.cloneElement(children, {
          sx: { fontSize: 18, color: iconColor },
        })}
      </button>
    </Tooltip>
  );
}

ActionIconButton.propTypes = {
  title: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  background: PropTypes.string.isRequired,
  iconColor: PropTypes.string.isRequired,
  children: PropTypes.element.isRequired,
};

export default function PathControlPanel({
  fileInputRef,
  pathProgress,
  onPathProgressChange,
  currentPositionMs,
  totalDurationMs,
  playbackSourceLabel,
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
  isSendingPaths,
  pathDeliveryStatus,
}) {
  const [collapsed, setCollapsed] = useState(false);

  const progress = Math.min(100, Math.max(0, Number(pathProgress) || 0));

  return (
    <>
      <style>{`
        .path-control-range {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 2px;
          border-radius: 999px;
          outline: none;
          cursor: pointer;
          background: linear-gradient(
            to right,
            rgba(255, 255, 255, 0.55) 0%,
            rgba(255, 255, 255, 0.55) ${progress}%,
            rgba(255, 255, 255, 0.12) ${progress}%,
            rgba(255, 255, 255, 0.12) 100%
          );
        }
        .path-control-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #fff;
          border: none;
        }
        .path-control-range::-moz-range-thumb {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #fff;
          border: none;
        }
        .path-control-range::-moz-range-track {
          height: 2px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.12);
        }
      `}</style>

      <input
        type='file'
        accept='application/json'
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={onFileChange}
      />

      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 20,
          transform: 'translateX(-50%)',
          zIndex: 11000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'none',
          width: 'min(860px, calc(100% - 32px))',
        }}
      >
        {pathDeliveryStatus && (
          <div
            style={{
              pointerEvents: 'auto',
              padding: '5px 12px',
              borderRadius: 6,
              ...panelSurface,
              color: 'rgba(255, 255, 255, 0.75)',
              fontSize: 11,
              whiteSpace: 'pre-line',
              maxWidth: '100%',
              textAlign: 'center',
            }}
          >
            {pathDeliveryStatus}
          </div>
        )}

        <div
          style={{
            marginBottom: collapsed ? 0 : 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            role='button'
            tabIndex={0}
            onClick={() => setCollapsed((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setCollapsed((v) => !v);
              }
            }}
            style={{ cursor: 'pointer', userSelect: 'none', flex: 1 }}
            title={collapsed ? '펼치기' : '접기'}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: 0.2,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                  fontSize: 10,
                  opacity: 0.8,
                }}
              >
                ▼
              </span>
              Path Control
            </div>
            <div style={{ opacity: 0.66, fontSize: 11, marginTop: 1 }}>
              {playbackSourceLabel} · {droneCount}대
            </div>
          </div>
          {!collapsed && (
            <button
              type='button'
              onClick={onAddDroneClick}
              style={{
                padding: '6px 11px',
                borderRadius: 8,
                border: '1px solid rgba(96,173,255,0.72)',
                background:
                  'linear-gradient(140deg, rgba(56,141,255,0.32), rgba(40,104,194,0.34))',
                color: '#d8ecff',
                cursor: 'pointer',
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: 0.2,
              }}
            >
              + 드론
            </button>
          )}
        </div>
        {!collapsed && (
          <>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                marginBottom: 10,
                cursor: 'pointer',
                userSelect: 'none',
                fontSize: 11.5,
              }}
            >
              <input
                type='checkbox'
                checked={ledSyncEnabled}
                onChange={(e) => onLedSyncToggle(e.target.checked)}
                style={{ accentColor: '#67b4ff', cursor: 'pointer' }}
              />
              <span style={{ opacity: 0.9 }}>LED 시뮬레이션과 동기화</span>
            </label>
            <div style={{ marginBottom: 6 }}>
              <div style={{ marginBottom: 4, fontSize: 11.5, opacity: 0.84 }}>
                재생 위치
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type='range'
                  className='path-control-range'
                  min='0'
                  max='100'
                  step='0.1'
                  value={pathProgress}
                  onChange={(e) => onPathProgressChange(e.target.value)}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontSize: 10,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <span>{formatMs(currentPositionMs)}</span>
                  <span style={{ color: 'rgba(255,255,255,0.65)' }}>
                    {playbackSourceLabel} · {droneCount}대
                  </span>
                  <span>{formatMs(totalDurationMs)}</span>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  flexShrink: 0,
                  paddingLeft: 8,
                  borderLeft: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <ActionIconButton
                  title='불러오기'
                  onClick={onLoadConfigClick}
                  background='transparent'
                  iconColor='rgba(255,255,255,0.65)'
                >
                  <FolderOpen />
                </ActionIconButton>
                <ActionIconButton
                  title='저장'
                  onClick={onSaveConfigClick}
                  background='transparent'
                  iconColor='rgba(255,255,255,0.65)'
                >
                  <Save />
                </ActionIconButton>
                <ActionIconButton
                  title='드론 추가'
                  onClick={onAddDroneClick}
                  background='transparent'
                  iconColor='rgba(255,255,255,0.65)'
                >
                  <Add />
                </ActionIconButton>
                <ActionIconButton
                  title={
                    isSendingPaths ? '다운로드 중...' : '.skyc 저장 (로컬)'
                  }
                  onClick={onSendPathsClick}
                  disabled={isSendingPaths}
                  background='transparent'
                  iconColor='rgba(255,255,255,0.65)'
                >
                  <Download />
                </ActionIconButton>
                <ActionIconButton
                  title='설정 초기화'
                  onClick={onResetPanelSettings}
                  background='transparent'
                  iconColor='rgba(255,255,255,0.65)'
                >
                  <DeleteOutline />
                </ActionIconButton>
              </div>
            </div>
          </>
        )}
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
  isSendingPaths: PropTypes.bool.isRequired,
  pathDeliveryStatus: PropTypes.string.isRequired,
};
