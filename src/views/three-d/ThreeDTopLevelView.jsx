/**
 * @file Component that shows a three-dimensional view of the drone flock.
 */

import loadable from '@loadable/component';
import Settings from '@mui/icons-material/Settings';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import debounce from 'lodash-es/debounce';
import PropTypes from 'prop-types';
import React, { useCallback, useEffect, useRef } from 'react';
import { IgnoreKeys } from 'react-hotkeys';
import { connect } from 'react-redux';
import useResizeObserver from 'use-resize-observer';

import { isThemeDark, makeStyles } from '@skybrush/app-theme-mui';

import DarkModeSwitch from '~/components/DarkModeSwitch';
import ToolbarDivider from '~/components/ToolbarDivider';
import NearestItemTooltip from '~/features/session/NearestItemTooltip';
import {
  setAppSettingsDialogTab,
  showAppSettingsDialog,
} from '~/features/settings/actions';
import { getLightingConditionsForThreeDView } from '~/features/settings/selectors';
import { toggleLightingConditionsInThreeDView } from '~/features/settings/slice';
import { resetZoom, rotateViewToDrones } from '~/features/three-d/actions';
import { cameraRef } from '~/features/three-d/refs';
import {
  notifySceneRemoval,
  setInteractionMode,
  setNavigationMode,
} from '~/features/three-d/slice';
import { ThreeDInteractionMode } from '~/features/three-d/types';
import { isMapCoordinateSystemSpecified } from '~/selectors/map';

import NavigationButtonGroup from './NavigationButtonGroup';
import NavigationInstructions from './NavigationInstructions';
import Overlay from './Overlay';
import ThreeDInteractionModeToggle from './ThreeDInteractionModeToggle';

const ThreeDView = loadable(
  () => import(/* webpackChunkName: "three-d" */ './ThreeDView')
);

const useStyles = makeStyles((theme) => ({
  appBar: {
    backgroundColor: isThemeDark(theme)
      ? '#424242'
      : theme.palette.background.paper,
    height: 48,
  },

  appBarCreateMode: {
    backgroundColor: '#1a1a1e',
    height: 44,
    boxShadow: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },

  toolbar: {
    position: 'absolute',
    left: theme.spacing(1),
    right: theme.spacing(1),
    top: 0,
  },

  toolbarCreateMode: {
    position: 'absolute',
    left: theme.spacing(2),
    right: theme.spacing(2),
    top: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
}));

const resizeThreeDScene = (sceneEl) => {
  if (!sceneEl) {
    return;
  }

  if (typeof sceneEl.resize === 'function') {
    sceneEl.resize();
    return;
  }

  const renderer = sceneEl.renderer ?? sceneEl.sceneEl?.renderer;
  const canvas = sceneEl.canvas ?? renderer?.domElement;
  const parent = canvas?.parentElement;
  if (renderer?.setSize && parent) {
    renderer.setSize(parent.clientWidth, parent.clientHeight, false);
  }
};

const ThreeDTopLevelView = ({
  forcedInteractionMode,
  glContainer,
  hasMapCoordinateSystem,
  hideInteractionModeToggle,
  interactionMode,
  lighting,
  navigation,
  onResetZoom,
  onRotateCameraTowardsDrones,
  onSceneReparented,
  onSetInteractionMode,
  onSetNavigationMode,
  onShowSettings,
  onToggleLightingConditions,
}) => {
  const effectiveInteractionMode = forcedInteractionMode || interactionMode;
  const isCreateMode = effectiveInteractionMode === ThreeDInteractionMode.CREATE;
  const classes = useStyles();

  const threeDViewRef = useRef(null);
  const hostNodeRef = useRef(null);
  const hostParentRef = useRef(null);

  const handleSceneResize = useCallback(() => {
    resizeThreeDScene(threeDViewRef.current);
  }, []);

  const handleLayoutStateChanged = useCallback(() => {
    handleSceneResize();

    const currentParent = hostNodeRef.current?.parentElement ?? null;
    if (!currentParent) {
      return;
    }

    if (hostParentRef.current && hostParentRef.current !== currentParent) {
      onSceneReparented();
    }

    hostParentRef.current = currentParent;
  }, [handleSceneResize, onSceneReparented]);

  const debouncedLayoutStateChangedRef = useRef(
    debounce(() => handleLayoutStateChanged(), 150)
  );

  useEffect(() => {
    debouncedLayoutStateChangedRef.current = debounce(
      () => handleLayoutStateChanged(),
      150
    );
  }, [handleLayoutStateChanged]);

  useEffect(
    () => () => debouncedLayoutStateChangedRef.current.cancel(),
    []
  );

  const setHostRef = useCallback((node) => {
    hostNodeRef.current = node;
    hostParentRef.current = node?.parentElement ?? null;
  }, []);

  const { ref: resizeObserverRef } = useResizeObserver({
    onResize: handleSceneResize,
  });

  const setSceneHostRef = useCallback(
    (node) => {
      resizeObserverRef(node);
      setHostRef(node);
    },
    [resizeObserverRef, setHostRef]
  );

  useEffect(() => {
    const layoutManager = glContainer?.layoutManager;
    if (!layoutManager) {
      return undefined;
    }

    const onStateChanged = () => debouncedLayoutStateChangedRef.current();
    layoutManager.on('stateChanged', onStateChanged);

    return () => {
      layoutManager.off('stateChanged', onStateChanged);
    };
  }, [glContainer]);

  return (
    <IgnoreKeys style={{ height: '100%' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <AppBar
          color='default'
          position='static'
          className={isCreateMode ? classes.appBarCreateMode : classes.appBar}
        >
          {isCreateMode ? (
            <Toolbar disableGutters variant='dense' className={classes.toolbarCreateMode}>
              <NavigationButtonGroup
                minimal
                mode={navigation.mode}
                parameters={navigation.parameters}
                onChange={onSetNavigationMode}
              />
              {!hideInteractionModeToggle && (
                <ThreeDInteractionModeToggle
                  minimal
                  mode={effectiveInteractionMode}
                  onChange={onSetInteractionMode}
                />
              )}
            </Toolbar>
          ) : (
            <Toolbar disableGutters variant='dense' className={classes.toolbar}>
              <NavigationButtonGroup
                mode={navigation.mode}
                parameters={navigation.parameters}
                onChange={onSetNavigationMode}
                onResetZoom={onResetZoom}
                onRotateCameraTowardsDrones={onRotateCameraTowardsDrones}
              />
              <ToolbarDivider orientation='vertical' />
              <NavigationInstructions mode={navigation.mode} />
              {!hideInteractionModeToggle && (
                <>
                  <ToolbarDivider orientation="vertical" />
                  <ThreeDInteractionModeToggle
                    mode={effectiveInteractionMode}
                    onChange={onSetInteractionMode}
                  />
                </>
              )}
              <ToolbarDivider orientation="vertical" />
              <DarkModeSwitch
                value={lighting === 'dark'}
                onChange={onToggleLightingConditions}
              />
            </Toolbar>
          )}
        </AppBar>
        <Box ref={setSceneHostRef} sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <NearestItemTooltip>
            <ThreeDView
              ref={threeDViewRef}
              cameraRef={cameraRef}
              interactionMode={effectiveInteractionMode}
              isCreateMode={isCreateMode}
            />
          </NearestItemTooltip>
          {!hasMapCoordinateSystem && (
            <Overlay left={8} right={8} top={8}>
              <Alert
                severity='warning'
                action={
                  <IconButton
                    color='inherit'
                    size='small'
                    onClick={onShowSettings}
                  >
                    <Settings />
                  </IconButton>
                }
              >
                <AlertTitle>No map coordinate system specified</AlertTitle>
                <div>
                  Drones will become visible when a coordinate system is
                  specified in the <strong>Settings</strong> dialog.
                </div>
              </Alert>
            </Overlay>
          )}
        </Box>
      </Box>
    </IgnoreKeys>
  );
};

ThreeDTopLevelView.propTypes = {
  forcedInteractionMode: PropTypes.oneOf(['view', 'create']),
  glContainer: PropTypes.object,
  hasMapCoordinateSystem: PropTypes.bool,
  hideInteractionModeToggle: PropTypes.bool,
  interactionMode: PropTypes.oneOf(['view', 'create']),
  lighting: PropTypes.string,
  navigation: PropTypes.shape({
    mode: PropTypes.string,
    parameters: PropTypes.object,
  }),
  onResetZoom: PropTypes.func,
  onRotateCameraTowardsDrones: PropTypes.func,
  onSceneReparented: PropTypes.func,
  onSetInteractionMode: PropTypes.func,
  onSetNavigationMode: PropTypes.func,
  onShowSettings: PropTypes.func,
  onToggleLightingConditions: PropTypes.func,
};

export default connect(
  // mapStateToProps
  (state) => ({
    hasMapCoordinateSystem: isMapCoordinateSystemSpecified(state),
    ...state.threeD,
    lighting: getLightingConditionsForThreeDView(state),
  }),
  // mapDispatchToProps
  {
    onResetZoom: resetZoom,
    onRotateCameraTowardsDrones: rotateViewToDrones,
    onSetInteractionMode: setInteractionMode,
    onSetNavigationMode: setNavigationMode,
    onSceneReparented: notifySceneRemoval,

    onShowSettings: () => (dispatch) => {
      dispatch(setAppSettingsDialogTab('display'));
      dispatch(showAppSettingsDialog());
    },

    onToggleLightingConditions: toggleLightingConditionsInThreeDView,
  }
)(ThreeDTopLevelView);
