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
  width: 36,
  height: 36,
  padding: 0,
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
  transition: 'background 0.15s ease, opacity 0.15s ease',
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
  const progressRounded = Math.round(progress);

  return (
    <>
      <style>{`
        .path-control-range {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 3px;
          border-radius: 999px;
          outline: none;
          cursor: pointer;
          background: linear-gradient(
            to right,
            rgba(120, 180, 255, 0.85) 0%,
            rgba(120, 180, 255, 0.85) ${progress}%,
            rgba(255, 255, 255, 0.14) ${progress}%,
            rgba(255, 255, 255, 0.14) 100%
          );
        }
        .path-control-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 11px;
          height: 11px;
          border-radius: 50%;
          background: #7ec8ff;
          border: none;
          box-shadow: 0 0 0 2px rgba(126, 200, 255, 0.25);
        }
        .path-control-range::-moz-range-thumb {
          width: 11px;
          height: 11px;
          border-radius: 50%;
          background: #7ec8ff;
          border: none;
          box-shadow: 0 0 0 2px rgba(126, 200, 255, 0.25);
        }
        .path-control-range::-moz-range-track {
          height: 3px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.14);
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
          bottom: 28,
          transform: 'translateX(-50%)',
          zIndex: 11000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          pointerEvents: 'none',
          width: 'min(920px, calc(100% - 32px))',
        }}
      >
        {pathDeliveryStatus && (
          <div
            style={{
              pointerEvents: 'auto',
              padding: '6px 14px',
              borderRadius: 999,
              background: 'rgba(30, 36, 48, 0.92)',
              border: '1px solid rgba(126, 200, 255, 0.28)',
              color: '#cce8ff',
              fontSize: 11.5,
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
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            borderRadius: 999,
            background: 'rgba(28, 30, 36, 0.88)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.28)',
            backdropFilter: 'blur(10px)',
            color: '#eef2f7',
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: 0.15,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#4da3ff',
              boxShadow: '0 0 8px rgba(77, 163, 255, 0.65)',
              flexShrink: 0,
            }}
          />
          <span>
            Path Control · {playbackSourceLabel} · {droneCount}대
          </span>
        </div>

        <div
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            width: '100%',
            padding: '10px 16px',
            borderRadius: 18,
            background: 'rgba(24, 26, 32, 0.9)',
            border: '1px solid rgba(255, 255, 255, 0.07)',
            boxShadow: '0 10px 32px rgba(0, 0, 0, 0.38)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Tooltip title={isPlaybackRunning ? '일시정지' : '재생'} placement="top">
              <button
                type="button"
                onClick={isPlaybackRunning ? onPausePlayback : onPlayAll}
                style={{
                  ...iconButtonStyle,
                  width: 40,
                  height: 40,
                  borderRadius: 11,
                  background: 'linear-gradient(145deg, #4da3ff, #2f7fd6)',
                  boxShadow: '0 4px 14px rgba(47, 127, 214, 0.35)',
                }}
              >
                {isPlaybackRunning ? (
                  <Pause sx={{ fontSize: 20, color: '#fff' }} />
                ) : (
                  <PlayArrow sx={{ fontSize: 22, color: '#fff', ml: '1px' }} />
                )}
              </button>
            </Tooltip>
            <Tooltip title="원위치" placement="top">
              <button
                type="button"
                onClick={onResetAll}
                style={{
                  ...iconButtonStyle,
                  background: 'rgba(255, 255, 255, 0.08)',
                }}
              >
                <Replay sx={{ fontSize: 18, color: 'rgba(255,255,255,0.82)' }} />
              </button>
            </Tooltip>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                color: 'rgba(255, 255, 255, 0.72)',
                fontSize: 11,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span>{formatMs(currentPositionMs)}</span>
              <span style={{ color: '#a9d4ff', fontWeight: 700 }}>{progressRounded}%</span>
              <span>{formatMs(totalDurationMs)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <ActionIconButton
              title="불러오기"
              onClick={onLoadConfigClick}
              background="rgba(255, 255, 255, 0.07)"
              iconColor="#f5c84c"
            >
              <FolderOpen />
            </ActionIconButton>
            <ActionIconButton
              title="저장"
              onClick={onSaveConfigClick}
              background="rgba(255, 255, 255, 0.07)"
              iconColor="#b48cff"
            >
              <Save />
            </ActionIconButton>
            <ActionIconButton
              title="드론 추가"
              onClick={onAddDroneClick}
              background="rgba(255, 255, 255, 0.07)"
              iconColor="#5eb3ff"
            >
              <Add />
            </ActionIconButton>
            <ActionIconButton
              title={isSendingPaths ? '다운로드 중...' : '.skyc 저장 (로컬)'}
              onClick={onSendPathsClick}
              disabled={isSendingPaths}
              background="rgba(255, 255, 255, 0.07)"
              iconColor="#5fd68a"
            >
              <Download />
            </ActionIconButton>
            <ActionIconButton
              title="설정 초기화"
              onClick={onResetPanelSettings}
              background="rgba(255, 255, 255, 0.07)"
              iconColor="#ff7b7b"
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
