/**
 * @file Right sidebar panel on the map view, showing UAV control actions
 * and origin-setting tools.  Replaces the popup context menu.
 */

import Assignment from '@mui/icons-material/Assignment';
import PositionHold from '@mui/icons-material/Flag';
import FlightLand from '@mui/icons-material/FlightLand';
import FlightTakeoff from '@mui/icons-material/FlightTakeoff';
import Grain from '@mui/icons-material/Grain';
import Home from '@mui/icons-material/Home';
import Moon from '@mui/icons-material/NightsStay';
import PinDrop from '@mui/icons-material/PinDrop';
import PowerSettingsNew from '@mui/icons-material/PowerSettingsNew';
import Refresh from '@mui/icons-material/Refresh';
import RotateRight from '@mui/icons-material/RotateRight';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MuiTooltip from '@mui/material/Tooltip';
import { transform } from 'ol/proj';
import PropTypes from 'prop-types';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { connect } from 'react-redux';

import Bolt from '~/icons/Bolt';
import RotationField from '~/components/RotationField';
import {
  setFlatEarthCoordinateSystemOrientation,
  setFlatEarthCoordinateSystemOrigin,
} from '~/features/map/origin';
import { updateOutdoorShowSettings } from '~/features/show/actions';
import { getOutdoorShowOrientation } from '~/features/show/selectors';
import { openUAVDetailsDialog } from '~/features/uavs/details';
import { getSelectedUAVIds } from '~/features/uavs/selectors';
import mapViewManager from '~/mapViewManager';
import { getMapOriginRotationAngle } from '~/selectors/map';
import * as messaging from '~/utils/messaging';
import { bearing, normalizeAngle } from '~/utils/geography';
import { mapOverlayShell } from '~/views/map/mapPanelStyles';

/* -------------------------------------------------------------------------- */
/*  Styles                                                                     */
/* -------------------------------------------------------------------------- */

const sidebarSx = {
  ...mapOverlayShell,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  right: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  py: 0.75,
  px: 0.25,

  '& .MuiDivider-root': {
    borderColor: 'rgba(255,255,255,0.12)',
    width: '70%',
    my: 0.4,
  },
};

const mkBtnSx = (active, danger) => ({
  color: active
    ? '#6eb6ff'
    : danger
    ? '#f06060'
    : 'rgba(255,255,255,0.88)',
  height: 34,
  width: 34,
  borderRadius: 1.5,
  backgroundColor: active ? 'rgba(94,162,255,0.18)' : 'transparent',
  transition: 'color 0.15s, background-color 0.15s',

  '&:hover': {
    backgroundColor: active
      ? 'rgba(94,162,255,0.28)'
      : danger
      ? 'rgba(240,96,96,0.12)'
      : 'rgba(255,255,255,0.10)',
  },
  '&.Mui-disabled': {
    color: 'rgba(255,255,255,0.20)',
  },
});

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const Tip = ({ label, children, placement = 'left' }) => (
  <MuiTooltip title={label} placement={placement} arrow>
    {children}
  </MuiTooltip>
);

Tip.propTypes = {
  label: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
  placement: PropTypes.string,
};

const setMapCursor = (map, cursor) => {
  const target = map?.getTargetElement?.();
  if (target?.style) {
    target.style.cursor = cursor;
  }
};

const eventToLonLat = (evt) =>
  transform(evt.coordinate, 'EPSG:3857', 'EPSG:4326');

/** Minimum map-units distance before a direction click counts as an angle. */
const MIN_ANGLE_DRAG_PX = 12;

const ANGLE_NUDGES = [-15, -1, 1, 15];
const ANGLE_PRESETS = [0, 45, 90, 180, 270];

const stopMapEvent = (event) => {
  event.stopPropagation();
};

const OriginAnglePanel = ({
  title,
  hint,
  angle,
  onAngleChange,
  onDone,
  onCancel,
}) => {
  const nudge = (delta) => {
    const current = Number.isFinite(Number(angle)) ? Number(angle) : 0;
    onAngleChange(current + delta);
  };

  return (
    <Box
      onMouseDown={stopMapEvent}
      onPointerDown={stopMapEvent}
      onClick={stopMapEvent}
      sx={{
        ...mapOverlayShell,
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        width: 320,
        maxWidth: 'calc(100% - 24px)',
        p: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        pointerEvents: 'auto',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Box sx={{ color: '#6eb6ff', fontSize: 12, fontWeight: 700 }}>
          {title}
        </Box>
        <Box sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>{hint}</Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <RotationField
          size='small'
          label='X+ 각도'
          value={angle}
          variant='filled'
          sx={{
            flex: 1,
            '& .MuiFilledInput-root': {
              backgroundColor: 'rgba(255,255,255,0.06)',
              color: '#fff',
            },
            '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.55)' },
            '& .MuiInputLabel-root.Mui-focused': { color: '#6eb6ff' },
          }}
          onChange={onAngleChange}
        />
        {ANGLE_NUDGES.map((delta) => (
          <Button
            key={delta}
            size='small'
            variant='outlined'
            onClick={() => nudge(delta)}
            sx={{
              minWidth: 40,
              px: 0.5,
              color: 'rgba(255,255,255,0.85)',
              borderColor: 'rgba(255,255,255,0.18)',
              fontSize: 11,
            }}
          >
            {delta > 0 ? `+${delta}` : delta}
          </Button>
        ))}
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {ANGLE_PRESETS.map((preset) => (
          <Button
            key={preset}
            size='small'
            variant={
              Math.abs((Number(angle) || 0) - preset) < 0.05
                ? 'contained'
                : 'text'
            }
            onClick={() => onAngleChange(preset)}
            sx={{
              minWidth: 0,
              px: 1,
              py: 0.25,
              fontSize: 11,
              color:
                Math.abs((Number(angle) || 0) - preset) < 0.05
                  ? '#0a0e14'
                  : 'rgba(255,255,255,0.75)',
              backgroundColor:
                Math.abs((Number(angle) || 0) - preset) < 0.05
                  ? '#6eb6ff'
                  : 'transparent',
            }}
          >
            {preset}°
          </Button>
        ))}
        <Box sx={{ flex: 1 }} />
        <Button
          size='small'
          onClick={onCancel}
          sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}
        >
          취소
        </Button>
        <Button
          size='small'
          variant='contained'
          onClick={onDone}
          sx={{
            backgroundColor: '#3d8bfd',
            fontSize: 12,
            '&:hover': { backgroundColor: '#5aa2ff' },
          }}
        >
          완료
        </Button>
      </Box>
    </Box>
  );
};

OriginAnglePanel.propTypes = {
  title: PropTypes.string.isRequired,
  hint: PropTypes.string,
  angle: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onAngleChange: PropTypes.func.isRequired,
  onDone: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

const MapRightSidebar = ({
  dispatch,
  hintContainerRef,
  mapOriginAngle,
  onPickModeChange,
  selectedUAVIds,
  showOrientation,
}) => {
  const hasUAVs = selectedUAVIds && selectedUAVIds.length > 0;

  /* ── UAV commands ── */
  const takeoff = () => messaging.takeoffUAVs(selectedUAVIds);
  const land = () => messaging.landUAVs(selectedUAVIds);
  const positionHold = () => messaging.positionHoldUAVs(selectedUAVIds);
  const returnToHome = () => messaging.returnToHomeUAVs(selectedUAVIds);
  const wakeUp = () => messaging.wakeUpUAVs(selectedUAVIds);
  const sleep = () => messaging.sleepUAVs(selectedUAVIds);
  const reboot = () => messaging.resetUAVs(selectedUAVIds);
  const shutdown = () => messaging.shutdownUAVs(selectedUAVIds);
  const openDetails = () => {
    if (hasUAVs) dispatch(openUAVDetailsDialog(selectedUAVIds[0]));
  };

  /* ── Pick-mode for origin + orientation ──
   * Step 1 (`position`): click to set origin location
   * Step 2 (`angle`): type angle in panel and/or click X+ direction
   */
  const [pickMode, setPickMode] = useState(null); // 'mapOrigin' | 'showOrigin'
  const [pickStep, setPickStep] = useState('position'); // 'position' | 'angle'
  const [previewAngle, setPreviewAngle] = useState(null);
  const [angleOnlyOpen, setAngleOnlyOpen] = useState(false);
  const pickHandlerRef = useRef(null);
  const moveHandlerRef = useRef(null);
  const pendingOriginRef = useRef(null);
  const lastPreviewAngleRef = useRef(null);
  const pickSessionRef = useRef(0);

  const clearMapHandlers = useCallback(() => {
    const map = mapViewManager.map;
    if (map) {
      if (pickHandlerRef.current) {
        map.un('singleclick', pickHandlerRef.current);
        pickHandlerRef.current = null;
      }
      if (moveHandlerRef.current) {
        map.un('pointermove', moveHandlerRef.current);
        moveHandlerRef.current = null;
      }
      setMapCursor(map, '');
    }
  }, []);

  const cancelPickMode = useCallback(() => {
    pickSessionRef.current += 1;
    clearMapHandlers();
    pendingOriginRef.current = null;
    lastPreviewAngleRef.current = null;
    setPreviewAngle(null);
    setPickStep('position');
    setPickMode(null);
  }, [clearMapHandlers]);

  const applyOrientation = useCallback(
    (angle) => {
      const normalized = normalizeAngle(angle);
      // Keep map and show frames in sync so Map axes and 3D ground agree.
      dispatch(setFlatEarthCoordinateSystemOrientation(normalized));
      dispatch(updateOutdoorShowSettings({ orientation: normalized }));
      return normalized;
    },
    [dispatch]
  );

  const finishPickMode = useCallback(() => {
    pickSessionRef.current += 1;
    clearMapHandlers();
    pendingOriginRef.current = null;
    lastPreviewAngleRef.current = null;
    setPreviewAngle(null);
    setPickStep('position');
    setPickMode(null);
  }, [clearMapHandlers]);

  const attachAngleHandlers = useCallback(
    (originCoords, sessionId) => {
      if (pickSessionRef.current !== sessionId) return;

      const map = mapViewManager.map;
      if (!map) return;

      clearMapHandlers();
      pendingOriginRef.current = originCoords;
      setPickStep('angle');
      setMapCursor(map, 'crosshair');

      const onMove = (evt) => {
        if (pickSessionRef.current !== sessionId) return;
        if (!pendingOriginRef.current) return;
        const originPixel = map.getPixelFromCoordinate(
          transform(pendingOriginRef.current, 'EPSG:4326', 'EPSG:3857')
        );
        if (
          originPixel &&
          Math.hypot(evt.pixel[0] - originPixel[0], evt.pixel[1] - originPixel[1]) <
            MIN_ANGLE_DRAG_PX
        ) {
          return;
        }

        const tip = eventToLonLat(evt);
        const angle = bearing(pendingOriginRef.current, tip);
        const normalized = normalizeAngle(angle);
        if (lastPreviewAngleRef.current === normalized) return;
        lastPreviewAngleRef.current = normalized;
        setPreviewAngle(Number.parseFloat(normalized));
        applyOrientation(angle);
      };

      const onClick = (evt) => {
        if (pickSessionRef.current !== sessionId) return;
        if (!pendingOriginRef.current) return;
        const originPixel = map.getPixelFromCoordinate(
          transform(pendingOriginRef.current, 'EPSG:4326', 'EPSG:3857')
        );
        if (
          originPixel &&
          Math.hypot(evt.pixel[0] - originPixel[0], evt.pixel[1] - originPixel[1]) <
            MIN_ANGLE_DRAG_PX
        ) {
          // Same spot as origin — keep current angle and finish
          finishPickMode();
          return;
        }

        applyOrientation(
          bearing(pendingOriginRef.current, eventToLonLat(evt))
        );
        finishPickMode();
      };

      moveHandlerRef.current = onMove;
      pickHandlerRef.current = onClick;
      map.on('pointermove', onMove);
      map.once('singleclick', onClick);
    },
    [applyOrientation, clearMapHandlers, finishPickMode]
  );

  const startPickMode = useCallback(
    (mode) => {
      if (pickMode === mode) {
        cancelPickMode();
        return;
      }

      setAngleOnlyOpen(false);
      pickSessionRef.current += 1;
      const sessionId = pickSessionRef.current;

      clearMapHandlers();
      pendingOriginRef.current = null;
      lastPreviewAngleRef.current = null;
      setPreviewAngle(null);
      setPickStep('position');

      const map = mapViewManager.map;
      if (!map) return;

      setPickMode(mode);
      setMapCursor(map, 'crosshair');

      const handler = (evt) => {
        if (pickSessionRef.current !== sessionId) return;
        const coords = eventToLonLat(evt);

        if (mode === 'mapOrigin') {
          dispatch(setFlatEarthCoordinateSystemOrigin(coords));
        } else {
          dispatch(
            updateOutdoorShowSettings({ origin: coords, setupMission: true })
          );
        }

        // Defer angle step so this same click does not also set the heading.
        setTimeout(() => attachAngleHandlers(coords, sessionId), 0);
      };

      pickHandlerRef.current = handler;
      map.once('singleclick', handler);
    },
    [attachAngleHandlers, cancelPickMode, clearMapHandlers, dispatch, pickMode]
  );

  /* Cancel pick mode on Escape; Enter confirms angle step */
  useEffect(() => {
    if (!pickMode && !angleOnlyOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (pickMode) cancelPickMode();
        else setAngleOnlyOpen(false);
      } else if (e.key === 'Enter' && (pickStep === 'angle' || angleOnlyOpen)) {
        if (pickMode) finishPickMode();
        else setAngleOnlyOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    pickMode,
    pickStep,
    angleOnlyOpen,
    cancelPickMode,
    finishPickMode,
  ]);

  /* Clean up on unmount */
  useEffect(() => () => cancelPickMode(), [cancelPickMode]);

  useEffect(() => {
    onPickModeChange?.(pickMode);
  }, [onPickModeChange, pickMode]);

  const panelOpen = Boolean(pickMode) || angleOnlyOpen;
  const [panelContainer, setPanelContainer] = useState(null);

  useEffect(() => {
    if (!panelOpen) {
      setPanelContainer(null);
      return;
    }

    setPanelContainer(hintContainerRef?.current ?? null);
  }, [hintContainerRef, panelOpen]);

  const openAngleOnly = useCallback(() => {
    if (pickMode) {
      cancelPickMode();
    }
    setAngleOnlyOpen((open) => !open);
  }, [cancelPickMode, pickMode]);

  const displayedAngle =
    previewAngle != null
      ? previewAngle
      : pickMode === 'showOrigin'
        ? showOrientation
        : mapOriginAngle;

  const panelTitle =
    pickMode === 'showOrigin'
      ? '쇼 원점 각도'
      : pickMode === 'mapOrigin'
        ? '맵 원점 각도'
        : '원점 각도';

  const panelHint =
    pickMode && pickStep === 'position'
      ? '지도에서 위치를 클릭하세요'
      : pickMode && pickStep === 'angle'
        ? '각도 입력 또는 지도에서 X+ 방향 클릭'
        : 'X+ 축 방향 (북=0°)';

  /* ── Render ── */
  return (
    <Box sx={sidebarSx}>
      {/* Flight commands */}
      <Tip label='이륙 (Takeoff)'>
        <span>
          <IconButton size='small' disabled={!hasUAVs} onClick={takeoff} sx={mkBtnSx(false, false)}>
            <FlightTakeoff fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      <Tip label='위치 유지 (Position Hold)'>
        <span>
          <IconButton size='small' disabled={!hasUAVs} onClick={positionHold} sx={mkBtnSx(false, false)}>
            <PositionHold fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      <Tip label='귀환 (Return to Home)'>
        <span>
          <IconButton size='small' disabled={!hasUAVs} onClick={returnToHome} sx={mkBtnSx(false, false)}>
            <Home fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      <Tip label='착륙 (Land)'>
        <span>
          <IconButton size='small' disabled={!hasUAVs} onClick={land} sx={mkBtnSx(false, false)}>
            <FlightLand fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      <Divider flexItem />

      {/* System commands */}
      <Tip label='상세 정보 (Details)'>
        <span>
          <IconButton size='small' disabled={!hasUAVs} onClick={openDetails} sx={mkBtnSx(false, false)}>
            <Assignment fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      <Tip label='전원 켜기 (Power On)'>
        <span>
          <IconButton size='small' disabled={!hasUAVs} onClick={wakeUp} sx={mkBtnSx(false, false)}>
            <Bolt fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      <Tip label='슬립 (Sleep)'>
        <span>
          <IconButton size='small' disabled={!hasUAVs} onClick={sleep} sx={mkBtnSx(false, false)}>
            <Moon fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      <Tip label='재부팅 (Reboot)'>
        <span>
          <IconButton size='small' disabled={!hasUAVs} onClick={reboot} sx={mkBtnSx(false, false)}>
            <Refresh fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      <Tip label='전원 끄기 (Power Off)'>
        <span>
          <IconButton size='small' disabled={!hasUAVs} onClick={shutdown} sx={mkBtnSx(false, true)}>
            <PowerSettingsNew fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      <Divider flexItem />

      {/* Origin setters */}
      <Tip
        label={
          pickMode === 'mapOrigin'
            ? '맵 원점: 위치 클릭 후 각도 입력 (ESC 취소)'
            : '맵 원점 위치 설정'
        }
      >
        <span>
          <IconButton
            size='small'
            onClick={() => startPickMode('mapOrigin')}
            sx={mkBtnSx(pickMode === 'mapOrigin', false)}
          >
            <PinDrop fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      <Tip
        label={
          pickMode === 'showOrigin'
            ? '쇼 원점: 위치 클릭 후 각도 입력 (ESC 취소)'
            : '쇼 원점 위치 설정'
        }
      >
        <span>
          <IconButton
            size='small'
            onClick={() => startPickMode('showOrigin')}
            sx={mkBtnSx(pickMode === 'showOrigin', false)}
          >
            <Grain fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      <Tip label='원점 각도 입력'>
        <span>
          <IconButton
            size='small'
            onClick={openAngleOnly}
            sx={mkBtnSx(angleOnlyOpen && !pickMode, false)}
          >
            <RotateRight fontSize='small' />
          </IconButton>
        </span>
      </Tip>

      {panelOpen &&
        panelContainer &&
        ReactDOM.createPortal(
          <OriginAnglePanel
            title={panelTitle}
            hint={panelHint}
            angle={displayedAngle}
            onAngleChange={(value) => {
              const next = applyOrientation(value);
              setPreviewAngle(Number.parseFloat(next));
            }}
            onDone={() => {
              if (pickMode) finishPickMode();
              else setAngleOnlyOpen(false);
            }}
            onCancel={() => {
              if (pickMode) cancelPickMode();
              else setAngleOnlyOpen(false);
            }}
          />,
          panelContainer
        )}
    </Box>
  );
};

MapRightSidebar.propTypes = {
  dispatch: PropTypes.func.isRequired,
  hintContainerRef: PropTypes.object,
  mapOriginAngle: PropTypes.number,
  onPickModeChange: PropTypes.func,
  selectedUAVIds: PropTypes.arrayOf(PropTypes.string),
  showOrientation: PropTypes.number,
};

export default connect((state) => ({
  selectedUAVIds: getSelectedUAVIds(state),
  mapOriginAngle: getMapOriginRotationAngle(state),
  showOrientation: getOutdoorShowOrientation(state),
}))(MapRightSidebar);
