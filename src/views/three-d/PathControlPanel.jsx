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
import React from 'react';

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

function ActionIconButton({ title, onClick, disabled, background, iconColor, children }) {
  return (
    <Tooltip title={title} placement="top">
      <button
        type="button"
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
        type="file"
        accept="application/json"
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
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            width: '100%',
            padding: '8px 12px',
            borderRadius: 10,
            ...panelSurface,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Tooltip title={isPlaybackRunning ? '일시정지' : '재생'} placement="top">
              <button
                type="button"
                onClick={isPlaybackRunning ? onPausePlayback : onPlayAll}
                style={{
                  ...iconButtonStyle,
                  width: 34,
                  height: 34,
                  background: 'rgba(255, 255, 255, 0.14)',
                }}
              >
                {isPlaybackRunning ? (
                  <Pause sx={{ fontSize: 18, color: '#fff' }} />
                ) : (
                  <PlayArrow sx={{ fontSize: 20, color: '#fff', ml: '1px' }} />
                )}
              </button>
            </Tooltip>
            <Tooltip title="원위치" placement="top">
              <button
                type="button"
                onClick={onResetAll}
                style={{
                  ...iconButtonStyle,
                  background: 'rgba(255, 255, 255, 0.06)',
                }}
              >
                <Replay sx={{ fontSize: 17, color: 'rgba(255,255,255,0.7)' }} />
              </button>
            </Tooltip>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input
              type="range"
              className="path-control-range"
              min="0"
              max="100"
              step="0.1"
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
              title="불러오기"
              onClick={onLoadConfigClick}
              background="transparent"
              iconColor="rgba(255,255,255,0.65)"
            >
              <FolderOpen />
            </ActionIconButton>
            <ActionIconButton
              title="저장"
              onClick={onSaveConfigClick}
              background="transparent"
              iconColor="rgba(255,255,255,0.65)"
            >
              <Save />
            </ActionIconButton>
            <ActionIconButton
              title="드론 추가"
              onClick={onAddDroneClick}
              background="transparent"
              iconColor="rgba(255,255,255,0.65)"
            >
              <Add />
            </ActionIconButton>
            <ActionIconButton
              title={isSendingPaths ? '다운로드 중...' : '.skyc 저장 (로컬)'}
              onClick={onSendPathsClick}
              disabled={isSendingPaths}
              background="transparent"
              iconColor="rgba(255,255,255,0.65)"
            >
              <Download />
            </ActionIconButton>
            <ActionIconButton
              title="설정 초기화"
              onClick={onResetPanelSettings}
              background="transparent"
              iconColor="rgba(255,255,255,0.65)"
            >
              <DeleteOutline />
            </ActionIconButton>
          </div>
        </div>
      </div>
    </>
  );
}

PathControlPanel.propTypes = {
  fileInputRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  pathProgress: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  onPathProgressChange: PropTypes.func.isRequired,
  currentPositionMs: PropTypes.number.isRequired,
  totalDurationMs: PropTypes.number.isRequired,
  playbackSourceLabel: PropTypes.string.isRequired,
  isPlaybackRunning: PropTypes.bool.isRequired,
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
