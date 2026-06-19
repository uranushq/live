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
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MuiTooltip from '@mui/material/Tooltip';
import { transform } from 'ol/proj';
import PropTypes from 'prop-types';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { connect } from 'react-redux';

import Bolt from '~/icons/Bolt';
import { setFlatEarthCoordinateSystemOrigin } from '~/features/map/origin';
import { updateOutdoorShowSettings } from '~/features/show/actions';
import { openUAVDetailsDialog } from '~/features/uavs/details';
import { getSelectedUAVIds } from '~/features/uavs/selectors';
import mapViewManager from '~/mapViewManager';
import * as messaging from '~/utils/messaging';
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

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

const MapRightSidebar = ({
  dispatch,
  hintContainerRef,
  onPickModeChange,
  selectedUAVIds,
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

  /* ── Pick-mode for origin setting ── */
  const [pickMode, setPickMode] = useState(null); // 'mapOrigin' | 'showOrigin'
  const pickHandlerRef = useRef(null);

  const startPickMode = useCallback(
    (mode) => {
      // If already in this mode, cancel it
      if (pickMode === mode) {
        cancelPickMode();
        return;
      }

      // Clean up any existing pick handler first
      if (pickHandlerRef.current) {
        const map = mapViewManager.map;
        if (map) map.un('singleclick', pickHandlerRef.current);
        pickHandlerRef.current = null;
      }

      const map = mapViewManager.map;
      if (!map) return;

      setPickMode(mode);

      const handler = (evt) => {
        const [lon, lat] = transform(evt.coordinate, 'EPSG:3857', 'EPSG:4326');
        const coords = [lon, lat];

        if (mode === 'mapOrigin') {
          dispatch(setFlatEarthCoordinateSystemOrigin(coords));
        } else {
          dispatch(updateOutdoorShowSettings({ origin: coords, setupMission: true }));
        }

        pickHandlerRef.current = null;
        setPickMode(null);
        setMapCursor(map, '');
      };

      pickHandlerRef.current = handler;
      map.once('singleclick', handler);
      setMapCursor(map, 'crosshair');
    },
    [dispatch, pickMode]
  );

  const cancelPickMode = useCallback(() => {
    const map = mapViewManager.map;
    if (map) {
      if (pickHandlerRef.current) {
        map.un('singleclick', pickHandlerRef.current);
        pickHandlerRef.current = null;
      }
      setMapCursor(map, '');
    }
    setPickMode(null);
  }, []);

  /* Cancel pick mode on Escape */
  useEffect(() => {
    if (!pickMode) return;
    const onKey = (e) => {
      if (e.key === 'Escape') cancelPickMode();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickMode, cancelPickMode]);

  /* Clean up on unmount */
  useEffect(() => () => cancelPickMode(), [cancelPickMode]);

  useEffect(() => {
    onPickModeChange?.(pickMode);
  }, [onPickModeChange, pickMode]);

  const [hintContainer, setHintContainer] = useState(null);

  useEffect(() => {
    if (!pickMode) {
      setHintContainer(null);
      return;
    }

    setHintContainer(hintContainerRef?.current ?? null);
  }, [hintContainerRef, pickMode]);

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
            ? '맵 원점: 지도 클릭 (ESC 취소)'
            : '맵 원점 설정 (클릭 후 지도에서 위치 선택)'
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
            ? '쇼 원점: 지도 클릭 (ESC 취소)'
            : '쇼 원점 설정 (클릭 후 지도에서 위치 선택)'
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

      {/* Pick-mode hint — anchored to the bottom of the map panel */}
      {pickMode &&
        hintContainer &&
        ReactDOM.createPortal(
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: 'rgba(18,21,26,0.92)',
              border: '1px solid rgba(94,162,255,0.5)',
              borderRadius: 6,
              padding: '5px 14px',
              color: '#6eb6ff',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              zIndex: 20,
              pointerEvents: 'none',
              boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
            }}
          >
            {pickMode === 'mapOrigin' ? '맵 원점' : '쇼 원점'}: 지도에서 위치를 클릭하세요 &nbsp;·&nbsp; ESC로 취소
          </div>,
          hintContainer
        )}
    </Box>
  );
};

MapRightSidebar.propTypes = {
  dispatch: PropTypes.func.isRequired,
  hintContainerRef: PropTypes.object,
  onPickModeChange: PropTypes.func,
  selectedUAVIds: PropTypes.arrayOf(PropTypes.string),
};

export default connect((state) => ({
  selectedUAVIds: getSelectedUAVIds(state),
}))(MapRightSidebar);
