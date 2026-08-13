/**
 * @file Component that shows a three-dimensional view of the drone flock.
 */

import loadable from '@loadable/component';
import Settings from '@mui/icons-material/Settings';
import ViewSidebar from '@mui/icons-material/ViewSidebar';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import debounce from 'lodash-es/debounce';
import PropTypes from 'prop-types';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IgnoreKeys } from 'react-hotkeys';
import { connect } from 'react-redux';
import useResizeObserver from 'use-resize-observer';

import { makeStyles } from '@skybrush/app-theme-mui';
import DarkModeSwitch from '~/components/DarkModeSwitch';
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
import Overlay from './Overlay';
import ThreeDInteractionModeToggle from './ThreeDInteractionModeToggle';

const ThreeDView = loadable(
  () => import(/* webpackChunkName: "three-d" */ './ThreeDView')
);

const useStyles = makeStyles(() => ({
  appBar: {
    position: 'relative',
    zIndex: 10,
    flexShrink: 0,
    backgroundColor: '#1a1a1e',
    color: 'rgba(255,255,255,0.88)',
    height: 44,
    boxShadow: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },

  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    minHeight: 44,
    paddingLeft: 16,
    paddingRight: 16,
    boxSizing: 'border-box',
  },
}));

const SCENE_RESIZE_MAX_ATTEMPTS = 40;
const SCENE_RESIZE_RETRY_MS = 50;

const getSceneHostSize = (sceneEl) => {
  const canvas = sceneEl?.canvas ?? sceneEl?.renderer?.domElement;
  const parent = canvas?.parentElement ?? sceneEl;
  if (!parent) {
    return { width: 0, height: 0 };
  }

  return {
    width: parent.clientWidth || parent.offsetWidth || 0,
    height: parent.clientHeight || parent.offsetHeight || 0,
  };
};

/**
 * Resize the A-Frame scene only when the host has a real size.
 * Calling a-scene.resize() at 0×0 sets camera.aspect to NaN and leaves a blank canvas.
 */
const resizeThreeDScene = (sceneEl, hostEl) => {
  if (!sceneEl) {
    return false;
  }

  const sceneSize = getSceneHostSize(sceneEl);
  let { width, height } = sceneSize;

  if (width < 2 || height < 2) {
    if (!hostEl) {
      return false;
    }
    width = hostEl.clientWidth || hostEl.offsetWidth || 0;
    height = hostEl.clientHeight || hostEl.offsetHeight || 0;
  }

  if (width < 2 || height < 2) {
    return false;
  }

  // Prefer A-Frame's own resize when its canvas parent already has dimensions.
  if (
    typeof sceneEl.resize === 'function' &&
    sceneEl.camera &&
    sceneEl.canvas &&
    sceneSize.width >= 2 &&
    sceneSize.height >= 2
  ) {
    sceneEl.resize();
    return true;
  }

  const renderer = sceneEl.renderer ?? sceneEl.sceneEl?.renderer;
  if (renderer?.setSize) {
    renderer.setSize(width, height, false);
    if (sceneEl.camera) {
      sceneEl.camera.aspect = width / height;
      sceneEl.camera.updateProjectionMatrix?.();
    }
    return true;
  }

  return false;
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
  sceneId,
}) => {
  const effectiveInteractionMode = forcedInteractionMode || interactionMode;
  const isCreateMode = effectiveInteractionMode === ThreeDInteractionMode.CREATE;
  const classes = useStyles();
  const [animationEditPanelOpen, setAnimationEditPanelOpen] = useState(false);

  useEffect(() => {
    if (!isCreateMode) {
      setAnimationEditPanelOpen(false);
    }
  }, [isCreateMode]);

  // Always enter 3D View in Navigate mode. Edit is opt-in after opening.
  useEffect(() => {
    if (forcedInteractionMode) {
      return;
    }
    onSetInteractionMode(ThreeDInteractionMode.VIEW);
  }, [forcedInteractionMode, onSetInteractionMode]);

  const threeDViewRef = useRef(null);
  const hostNodeRef = useRef(null);
  const hostParentRef = useRef(null);
  const resizeRetryTimerRef = useRef(null);
  const resizeGenerationRef = useRef(0);
  const sceneListenersCleanupRef = useRef(null);

  const clearResizeRetry = useCallback(() => {
    resizeGenerationRef.current += 1;
    if (resizeRetryTimerRef.current != null) {
      window.clearTimeout(resizeRetryTimerRef.current);
      resizeRetryTimerRef.current = null;
    }
  }, []);

  const scheduleSceneResize = useCallback(() => {
    clearResizeRetry();

    const generation = resizeGenerationRef.current;
    let attempts = 0;
    const attempt = () => {
      if (generation !== resizeGenerationRef.current) {
        return;
      }

      if (resizeThreeDScene(threeDViewRef.current, hostNodeRef.current)) {
        resizeRetryTimerRef.current = null;
        return;
      }

      attempts += 1;
      if (attempts >= SCENE_RESIZE_MAX_ATTEMPTS) {
        resizeRetryTimerRef.current = null;
        return;
      }

      resizeRetryTimerRef.current = window.setTimeout(
        attempt,
        SCENE_RESIZE_RETRY_MS
      );
    };

    // Double rAF waits for GoldenLayout / flex layout to settle.
    window.requestAnimationFrame(() => {
      if (generation !== resizeGenerationRef.current) {
        return;
      }
      window.requestAnimationFrame(attempt);
    });
  }, [clearResizeRetry]);

  const handleSceneResize = useCallback(() => {
    scheduleSceneResize();
  }, [scheduleSceneResize]);

  const bindSceneLifecycle = useCallback(
    (sceneEl) => {
      if (sceneListenersCleanupRef.current) {
        sceneListenersCleanupRef.current();
        sceneListenersCleanupRef.current = null;
      }

      if (!sceneEl?.addEventListener) {
        return;
      }

      const onSceneReady = () => {
        scheduleSceneResize();
      };

      const onContextLost = (event) => {
        // Allow the browser to restore the context. Do NOT remount the scene
        // here — remounting wipes a-drone-flock entities and makes drones
        // disappear until the next telemetry / pending sync.
        event.preventDefault();
      };

      const onContextRestored = () => {
        scheduleSceneResize();
        if (typeof sceneEl.render === 'function') {
          sceneEl.render();
        }
      };

      const bindCanvasHandlers = () => {
        const canvas = sceneEl.canvas;
        if (!canvas || canvas.__skybrushContextHandlersBound) {
          return;
        }
        canvas.__skybrushContextHandlersBound = true;
        canvas.addEventListener('webglcontextlost', onContextLost, false);
        canvas.addEventListener('webglcontextrestored', onContextRestored, false);
      };

      sceneEl.addEventListener('loaded', onSceneReady);
      sceneEl.addEventListener('cameraready', onSceneReady);
      sceneEl.addEventListener('render-target-loaded', onSceneReady);
      sceneEl.addEventListener('render-target-loaded', bindCanvasHandlers);
      bindCanvasHandlers();
      scheduleSceneResize();

      sceneListenersCleanupRef.current = () => {
        sceneEl.removeEventListener('loaded', onSceneReady);
        sceneEl.removeEventListener('cameraready', onSceneReady);
        sceneEl.removeEventListener('render-target-loaded', onSceneReady);
        sceneEl.removeEventListener('render-target-loaded', bindCanvasHandlers);
        const canvas = sceneEl.canvas;
        if (canvas?.__skybrushContextHandlersBound) {
          canvas.removeEventListener('webglcontextlost', onContextLost, false);
          canvas.removeEventListener(
            'webglcontextrestored',
            onContextRestored,
            false
          );
          delete canvas.__skybrushContextHandlersBound;
        }
      };
    },
    [scheduleSceneResize]
  );

  const setThreeDViewRef = useCallback(
    (node) => {
      threeDViewRef.current = node;
      bindSceneLifecycle(node);
    },
    [bindSceneLifecycle]
  );

  const handleLayoutStateChanged = useCallback(() => {
    scheduleSceneResize();

    const currentParent = hostNodeRef.current?.parentElement ?? null;
    if (!currentParent) {
      return;
    }

    if (hostParentRef.current && hostParentRef.current !== currentParent) {
      onSceneReparented();
    }

    hostParentRef.current = currentParent;
  }, [onSceneReparented, scheduleSceneResize]);

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
    () => () => {
      debouncedLayoutStateChangedRef.current.cancel();
      clearResizeRetry();
      if (sceneListenersCleanupRef.current) {
        sceneListenersCleanupRef.current();
        sceneListenersCleanupRef.current = null;
      }
    },
    [clearResizeRetry]
  );

  // Remount (sceneId change) or lazy chunk load: re-bind and resize.
  useEffect(() => {
    bindSceneLifecycle(threeDViewRef.current);
    scheduleSceneResize();
  }, [bindSceneLifecycle, sceneId, scheduleSceneResize]);

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
    if (!layoutManager && !glContainer) {
      return undefined;
    }

    const onStateChanged = () => debouncedLayoutStateChangedRef.current();
    const onPanelShown = () => {
      scheduleSceneResize();
      if (!forcedInteractionMode) {
        onSetInteractionMode(ThreeDInteractionMode.VIEW);
      }
    };

    layoutManager?.on('stateChanged', onStateChanged);
    // GoldenLayout fires these when a stacked tab becomes visible again.
    glContainer?.on?.('show', onPanelShown);
    glContainer?.on?.('shown', onPanelShown);
    glContainer?.on?.('open', onPanelShown);

    return () => {
      layoutManager?.off('stateChanged', onStateChanged);
      glContainer?.off?.('show', onPanelShown);
      glContainer?.off?.('shown', onPanelShown);
      glContainer?.off?.('open', onPanelShown);
    };
  }, [
    forcedInteractionMode,
    glContainer,
    onSetInteractionMode,
    scheduleSceneResize,
  ]);

  return (
    <IgnoreKeys style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <AppBar color='inherit' position='static' className={classes.appBar}>
          <Toolbar disableGutters variant='dense' className={classes.toolbar}>
            <NavigationButtonGroup
              minimal
              mode={navigation.mode}
              parameters={navigation.parameters}
              onChange={onSetNavigationMode}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {!isCreateMode && (
                <Box
                  sx={{
                    '& .MuiToggleButton-root': {
                      border: 'none',
                      borderRadius: '6px',
                      color: 'rgba(255,255,255,0.45)',
                      padding: '6px',
                      '&.Mui-selected': {
                        backgroundColor: 'transparent',
                        color: '#ffffff',
                      },
                      '&:hover': {
                        backgroundColor: 'rgba(255,255,255,0.06)',
                      },
                    },
                  }}
                >
                  <DarkModeSwitch
                    value={lighting === 'dark'}
                    onChange={onToggleLightingConditions}
                  />
                </Box>
              )}
              {!hideInteractionModeToggle && (
                <ThreeDInteractionModeToggle
                  minimal
                  mode={effectiveInteractionMode}
                  onChange={onSetInteractionMode}
                />
              )}
              {isCreateMode && (
                <Tooltip
                  title={
                    animationEditPanelOpen
                      ? '애니메이션 편집 닫기'
                      : '애니메이션 편집 열기'
                  }
                >
                  <IconButton
                    size="small"
                    aria-label="애니메이션 편집"
                    aria-pressed={animationEditPanelOpen}
                    onClick={() =>
                      setAnimationEditPanelOpen((prev) => !prev)
                    }
                    sx={{
                      ml: 0.25,
                      color: animationEditPanelOpen
                        ? '#ffffff'
                        : 'rgba(255,255,255,0.45)',
                      backgroundColor: animationEditPanelOpen
                        ? 'rgba(255,255,255,0.08)'
                        : 'transparent',
                      borderRadius: '6px',
                      '&:hover': {
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        color: '#ffffff',
                      },
                    }}
                  >
                    <ViewSidebar sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Toolbar>
        </AppBar>
        <Box
          ref={setSceneHostRef}
          className='three-d-scene-host'
          sx={{ position: 'relative', flex: 1, minHeight: 0, zIndex: 0 }}
        >
          <NearestItemTooltip>
            <ThreeDView
              ref={setThreeDViewRef}
              cameraRef={cameraRef}
              interactionMode={effectiveInteractionMode}
              isCreateMode={isCreateMode}
              animationEditPanelOpen={animationEditPanelOpen}
              onAnimationEditPanelOpenChange={setAnimationEditPanelOpen}
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
  sceneId: PropTypes.number,
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
