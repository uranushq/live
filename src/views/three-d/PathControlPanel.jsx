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

import VelocityProfileChart from './VelocityProfileChart';
import {
  getVelocityProfile,
  getVelocitySmoothing,
  setVelocitySmoothing,
  subscribeSmoothingKnobs,
} from './utils/pathSmoothing';

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
  showSpecActive = false,
  showSpecIgnored = false,
  onToggleShowSpecIgnored = () => {},
  isPlaybackRunning,
  ledSyncEnabled,
  onLedSyncToggle,
  sphereRender = true,
  onSphereRenderChange = () => {},
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

  // Global velocity-smoothing default (shared, persisted to localStorage).
  // Applied to every generated / delivered / locally-patched path.
  const [smoothing, setSmoothing] = React.useState(getVelocitySmoothing());
  const handleSmoothingChange = (value) => {
    setSmoothing(setVelocitySmoothing(value));
  };

  // 관성 속도 프로파일 그래프 (모양·폭·곡률이 바뀌면 실시간 갱신)
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [profile, setProfile] = React.useState(getVelocityProfile);

  // formation 탭 등 다른 UI에서 같은 전역값을 바꾸면 여기도 실시간 반영
  React.useEffect(
    () =>
      subscribeSmoothingKnobs(() => {
        setSmoothing(getVelocitySmoothing());
        setProfile(getVelocityProfile());
      }),
    []
  );

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

        {profileOpen && (
          <div
            style={{
              pointerEvents: 'auto',
              alignSelf: 'flex-end',
              padding: '10px 12px',
              borderRadius: 10,
              ...panelSurface,
            }}
          >
            <VelocityProfileChart profile={profile} width={320} height={140} />
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
          <Tooltip title="LED 시뮬레이션과 동기화" placement="top">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
                paddingRight: 8,
                borderRight: '1px solid rgba(255,255,255,0.08)',
                fontSize: 11,
                color: 'rgba(255,255,255,0.75)',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <input
                type="checkbox"
                checked={ledSyncEnabled}
                onChange={(e) => onLedSyncToggle(e.target.checked)}
                style={{ accentColor: '#67b4ff', cursor: 'pointer' }}
              />
              LED 동기화
            </label>
          </Tooltip>

          <Tooltip
            title="켜면 드론 전체를 InstancedMesh 구체 하나로 그려 100대 이상에서도 프레임을 유지합니다 (LED 쇼 색 반영). 렌더링만 바뀌고 클릭 선택·기즈모 이동·phase 편집 등 모든 기능은 동일하게 동작합니다."
            placement="top"
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
                paddingRight: 8,
                borderRight: '1px solid rgba(255,255,255,0.08)',
                fontSize: 11,
                color: 'rgba(255,255,255,0.75)',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <input
                type="checkbox"
                checked={sphereRender}
                onChange={(e) => onSphereRenderChange(e.target.checked)}
                style={{ accentColor: '#67b4ff', cursor: 'pointer' }}
              />
              시뮬 구체
            </label>
          </Tooltip>

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
              <span
                style={{
                  color: 'rgba(255,255,255,0.65)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {playbackSourceLabel} · {droneCount}대
                {showSpecActive ? (
                  <button
                    type='button'
                    onClick={onToggleShowSpecIgnored}
                    title={
                      showSpecIgnored
                        ? '로드된 .skyc 쇼 스펙을 다시 표시합니다'
                        : '로드된 .skyc 쇼 스펙을 잠시 해제하고 수동 편집(드론·formation)으로 돌아갑니다. 수동 데이터는 그대로 유지됩니다.'
                    }
                    style={{
                      border: '1px solid rgba(255,255,255,0.25)',
                      background: showSpecIgnored
                        ? 'rgba(76, 141, 255, 0.25)'
                        : 'rgba(255,255,255,0.08)',
                      color: 'rgba(255,255,255,0.85)',
                      borderRadius: 5,
                      fontSize: 10,
                      padding: '1px 7px',
                      cursor: 'pointer',
                    }}
                  >
                    {showSpecIgnored ? '쇼 스펙 다시 보기' : '← 수동 편집으로'}
                  </button>
                ) : null}
              </span>
              <span>{formatMs(totalDurationMs)}</span>
            </div>
          </div>

          <Tooltip
            title="속도 스무딩: 0 = 기존 등속(관성 있음), 1 = 최대(코너에서 정지). 출발·도착·정지 지점은 항상 부드럽게 가감속합니다. 모든 경로에 공통 적용."
            placement="top"
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexShrink: 0,
                paddingLeft: 8,
                borderLeft: '1px solid rgba(255,255,255,0.08)',
                fontSize: 11,
                color: 'rgba(255,255,255,0.75)',
                whiteSpace: 'nowrap',
              }}
            >
              <span>스무딩</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={smoothing}
                onChange={(e) => handleSmoothingChange(e.target.value)}
                style={{ width: 84, accentColor: '#67b4ff', cursor: 'pointer' }}
              />
              <span
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  color: 'rgba(255,255,255,0.6)',
                  width: 26,
                  textAlign: 'right',
                }}
              >
                {smoothing.toFixed(2)}
              </span>
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                title="관성 속도 프로파일 그래프 (지수 가속 · 로그 감속 곡선)"
                style={{
                  border: '1px solid rgba(255,255,255,0.25)',
                  background: profileOpen
                    ? 'rgba(103, 180, 255, 0.25)'
                    : 'rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.85)',
                  borderRadius: 5,
                  fontSize: 10,
                  padding: '1px 7px',
                  cursor: 'pointer',
                }}
              >
                곡선
              </button>
            </div>
          </Tooltip>

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
  showSpecActive: PropTypes.bool,
  showSpecIgnored: PropTypes.bool,
  onToggleShowSpecIgnored: PropTypes.func,
  isPlaybackRunning: PropTypes.bool.isRequired,
  ledSyncEnabled: PropTypes.bool.isRequired,
  onLedSyncToggle: PropTypes.func.isRequired,
  sphereRender: PropTypes.bool,
  onSphereRenderChange: PropTypes.func,
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
