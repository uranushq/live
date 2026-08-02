import Add from '@mui/icons-material/Add';
import ArrowBack from '@mui/icons-material/ArrowBack';
import Check from '@mui/icons-material/Check';
import CloudDownload from '@mui/icons-material/CloudDownload';
import Flight from '@mui/icons-material/Flight';
import Settings from '@mui/icons-material/Settings';
import UploadFile from '@mui/icons-material/UploadFile';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { createSelector } from '@reduxjs/toolkit';
import PropTypes from 'prop-types';
import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { makeStyles } from '@skybrush/app-theme-mui';

import { Status } from '~/components/semantics';
import { AltitudeReference } from '~/features/show/constants';
import { clearLoadedShow, loadShowFromFile } from '~/features/show/actions';
import {
  getAbsolutePathOfShowFile,
  getOutdoorShowAltitudeReference,
  getShowDescription,
  getShowEnvironmentType,
  getShowTitle,
  hasLoadedShowFile,
} from '~/features/show/selectors';
import {
  openEnvironmentEditorDialog,
  openLoadShowFromCloudDialog,
  openTakeoffAreaSetupDialog,
} from '~/features/show/slice';
import { getSetupStageStatuses } from '~/features/show/stages';
import { SHOW_UPLOAD_JOB } from '~/features/show/constants';
import { getUAVIdsParticipatingInMission } from '~/features/mission/selectors';
import { getFarthestDistanceFromHome } from '~/features/uavs/selectors';
import { isUploadInProgress } from '~/features/upload/selectors';
import { openUploadDialogForJob } from '~/features/upload/slice';
import { hasFeature } from '~/utils/configuration';
import { formatDistance } from '~/utils/formatting';

const EXTENSIONS = ['.skyc'];
const isFile = (item) => item?.size > 0;

const getFileNameFromPath = (path) => {
  if (!path) return null;
  const normalized = String(path).replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  return name || null;
};

const getEnvironmentDescription = createSelector(
  getShowEnvironmentType,
  getOutdoorShowAltitudeReference,
  (environmentType, outdoorAltitudeReference) => {
    switch (environmentType) {
      case 'indoor':
        return 'indoor';
      case 'outdoor': {
        const { type, value } = outdoorAltitudeReference;
        if (type === AltitudeReference.AMSL && Number.isFinite(value)) {
          return 'outdoorAMSL';
        }
        return 'outdoor';
      }
      default:
        return 'unknown';
    }
  }
);

const isDone = (status) =>
  status === Status.SUCCESS || status === Status.SKIPPED;

const statusColor = (status) => {
  switch (status) {
    case Status.SUCCESS:
    case Status.SKIPPED:
      return '#3ecf6e';
    case Status.ERROR:
    case Status.CRITICAL:
      return '#e85d5d';
    case Status.WAITING:
    case Status.NEXT:
      return '#e8b339';
    default:
      return 'rgba(255,255,255,0.22)';
  }
};

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'visible',
    padding: theme.spacing(0.75, 1.5, 1),
  },
  header: {
    alignItems: 'center',
    display: 'flex',
    flexShrink: 0,
    justifyContent: 'space-between',
    minHeight: 20,
  },
  title: {
    color: theme.palette.text.secondary,
    fontSize: '0.76rem',
    fontWeight: 700,
    letterSpacing: '0.14em',
    lineHeight: 1,
    textTransform: 'uppercase',
  },
  stepCounter: {
    color: theme.palette.text.disabled,
    fontSize: '0.72rem',
    fontWeight: 500,
    lineHeight: 1,
  },
  progressWrap: {
    alignItems: 'center',
    display: 'flex',
    flex: 1,
    minHeight: 0,
    overflow: 'visible',
    width: '100%',
  },
  progressTrack: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.625),
    overflow: 'visible',
    position: 'relative',
    width: '100%',
  },
  circleRow: {
    alignItems: 'flex-start',
    display: 'flex',
    overflow: 'visible',
    paddingInline: theme.spacing(0.75),
    position: 'relative',
    width: '100%',
  },
  progressBarBg: {
    backgroundColor: theme.palette.divider,
    height: 2,
    pointerEvents: 'none',
    position: 'absolute',
    top: 15,
    zIndex: 0,
  },
  progressBarFill: {
    backgroundColor: '#3ecf6e',
    height: 2,
    pointerEvents: 'none',
    position: 'absolute',
    top: 15,
    transition: theme.transitions.create('width'),
    zIndex: 0,
  },
  stepColumn: {
    alignItems: 'center',
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    gap: theme.spacing(0.375),
    minWidth: 0,
  },
  stepButton: {
    alignItems: 'center',
    background: 'none',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.375),
    minWidth: 0,
    padding: theme.spacing(0.25, 0),
    width: '100%',

    '&:disabled': {
      cursor: 'default',
      opacity: 0.45,
    },

    '&:focus': {
      outline: 'none',
    },

    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
  },
  stepDot: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'center',
    overflow: 'visible',
    padding: 3,
  },
  stepDotCircle: {
    alignItems: 'center',
    backgroundColor: theme.palette.background.paper,
    border: `2px solid ${theme.palette.divider}`,
    borderRadius: '50%',
    boxSizing: 'border-box',
    display: 'flex',
    flexShrink: 0,
    height: 32,
    justifyContent: 'center',
    transition: theme.transitions.create(['border-color', 'background-color']),
    width: 32,
  },
  stepDotCircleDone: {
    backgroundColor: '#3ecf6e',
    borderColor: '#3ecf6e',
    color: '#fff',
  },
  stepDotCircleActive: {
    borderColor: '#e8b339',
    borderWidth: 3,
  },
  stepDotIcon: {
    fontSize: '1.05rem',
  },
  stepDotCheck: {
    fontSize: '1.1rem',
  },
  stepDotLabel: {
    color: theme.palette.text.disabled,
    fontSize: '0.74rem',
    fontWeight: 500,
    lineHeight: 1.25,
    maxWidth: '100%',
    overflow: 'hidden',
    paddingInline: theme.spacing(0.25),
    textAlign: 'center',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  stepDotLabelActive: {
    color: theme.palette.text.primary,
    fontWeight: 600,
  },
  stepDotLabelDone: {
    color: '#3ecf6e',
  },
  stepSub: {
    color: theme.palette.text.disabled,
    fontSize: '0.68rem',
    lineHeight: 1.25,
    maxWidth: '100%',
    overflow: 'hidden',
    paddingInline: theme.spacing(0.25),
    textAlign: 'center',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  stepSubWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.125),
    maxWidth: '100%',
    minHeight: '2.4em',
    paddingInline: theme.spacing(0.25),
    width: '100%',
  },
  stepSubLine: {
    color: theme.palette.text.disabled,
    fontSize: '0.68rem',
    lineHeight: 1.25,
    textAlign: 'center',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
  },
  addButton: {
    backgroundColor: theme.palette.action.hover,
    border: `1px solid ${theme.palette.divider}`,
    color: theme.palette.text.secondary,
    flexShrink: 0,
    height: 28,
    width: 28,
  },
  footer: {
    alignItems: 'center',
    display: 'flex',
    flexShrink: 0,
    gap: theme.spacing(0.5),
    justifyContent: 'center',
    width: '100%',
  },
}));

const MissionSetupStrip = ({
  environmentKey,
  hasLoadedFile,
  isUploading,
  maxDistance,
  missionDroneCount,
  onClearLoadedShow,
  onEditEnvironment,
  onLoadFromCloud,
  onOpenTakeoffArea,
  onOpenUpload,
  onShowFileSelected,
  showDescription,
  showFilePath,
  showTitle,
  stageStatuses,
}) => {
  const classes = useStyles();
  const { t } = useTranslation();
  const exportFileInputRef = useRef(null);

  // 뒤로가기: 로드된 쇼를 해제하고 mission setup을 1단계(파일 선택)로
  // 되돌린다. 이후 단계들(환경/배치/업로드)의 상태는 로드된 쇼에서
  // 파생되므로 쇼 해제가 곧 전체 스텝의 되돌리기다.
  const handleGoBack = useCallback(() => {
    const confirmed = window.confirm(
      '로드된 쇼를 해제하고 mission setup을 처음 단계로 되돌릴까요?\n' +
        '(3D 뷰의 수동 편집 데이터는 그대로 유지됩니다)'
    );
    if (confirmed && onClearLoadedShow) {
      onClearLoadedShow();
    }
  }, [onClearLoadedShow]);

  const handleExportPathClick = useCallback(() => {
    if (exportFileInputRef.current) {
      exportFileInputRef.current.value = '';
      exportFileInputRef.current.click();
    }
  }, []);

  const handleExportFileChange = useCallback(
    (event) => {
      const file = event.target.files?.[0];
      if (file && isFile(file)) {
        onShowFileSelected(file);
      }
      event.target.value = '';
    },
    [onShowFileSelected]
  );

  const exportSubLines = useMemo(() => {
    if (hasLoadedFile) {
      const lines = [];
      const fileName = getFileNameFromPath(showFilePath);
      if (fileName) {
        lines.push(fileName);
      } else if (showTitle) {
        lines.push(showTitle);
      }
      if (showDescription) {
        lines.push(showDescription);
      }
      if (lines.length > 0) {
        return lines;
      }
    }

    if (missionDroneCount > 0) {
      return [t('bottomBar.droneCount', { count: missionDroneCount })];
    }

    return [t('bottomBar.noShowLoaded')];
  }, [
    hasLoadedFile,
    missionDroneCount,
    showDescription,
    showFilePath,
    showTitle,
    t,
  ]);

  const environmentSub = useMemo(() => {
    switch (environmentKey) {
      case 'indoor':
        return t('show.indoor');
      case 'outdoor':
        return t('show.outdoor.relativeToHome');
      case 'outdoorAMSL':
        return t('show.outdoor.relativeToHome');
      default:
        return t('show.unknown');
    }
  }, [environmentKey, t]);

  const placementSub = useMemo(() => {
    const status = stageStatuses.setupTakeoffArea;
    if (typeof maxDistance === 'number' && Number.isFinite(maxDistance)) {
      return t('show.placementAccuracy', {
        distance: formatDistance(maxDistance),
      });
    }
    switch (status) {
      case Status.SUCCESS:
        return t('show.dronePlacementApproved');
      case Status.SKIPPED:
        return t('show.dronePlacementPartial');
      default:
        return t('show.takeOffPlace');
    }
  }, [maxDistance, stageStatuses.setupTakeoffArea, t]);

  const uploadSub = useMemo(() => {
    if (isUploading) {
      return t('show.uploadShowDataLoading');
    }
    switch (stageStatuses.uploadShow) {
      case Status.SUCCESS:
        return t('bottomBar.ready');
      case Status.ERROR:
        return t('bottomBar.failed');
      default:
        return t('bottomBar.tapToUpload');
    }
  }, [isUploading, stageStatuses.uploadShow, t]);

  const steps = useMemo(
    () => [
      {
        key: 'export',
        shortLabel: t('bottomBar.exportPath'),
        icon: CloudDownload,
        status: stageStatuses.selectShowFile,
        sublabelLines: exportSubLines,
        disabled: false,
        onClick: handleExportPathClick,
      },
      {
        key: 'environment',
        shortLabel: t('bottomBar.environmentSetup'),
        icon: Settings,
        status: stageStatuses.setupEnvironment,
        sublabel: environmentSub,
        disabled: stageStatuses.setupEnvironment === Status.OFF,
        onClick: onEditEnvironment,
      },
      {
        key: 'placement',
        shortLabel: t('bottomBar.dronePlacement'),
        icon: Flight,
        status: stageStatuses.setupTakeoffArea,
        sublabel: placementSub,
        disabled: stageStatuses.setupTakeoffArea === Status.OFF,
        onClick: onOpenTakeoffArea,
      },
      {
        key: 'upload',
        shortLabel: t('bottomBar.uploadData'),
        icon: UploadFile,
        status: stageStatuses.uploadShow,
        sublabel: uploadSub,
        disabled: stageStatuses.uploadShow === Status.OFF,
        onClick: onOpenUpload,
      },
    ],
    [
      environmentSub,
      exportSubLines,
      handleExportPathClick,
      onEditEnvironment,
      onOpenTakeoffArea,
      onOpenUpload,
      placementSub,
      stageStatuses,
      t,
      uploadSub,
    ]
  );

  const activeIndex = useMemo(() => {
    const nextIndex = steps.findIndex((step) => step.status === Status.NEXT);
    if (nextIndex !== -1) {
      return nextIndex;
    }

    const pending = steps.findIndex((step) => !isDone(step.status));
    return pending === -1 ? steps.length - 1 : pending;
  }, [steps]);

  const progressBarMetrics = useMemo(() => {
    const n = steps.length;
    if (n <= 1) {
      return { inset: '0%', fillWidth: '0%' };
    }

    const completedCount = steps.filter((step) => isDone(step.status)).length;
    const inset = `${(0.5 / n) * 100}%`;

    return {
      inset,
      fillWidth: `${(Math.min(completedCount, n - 1) / n) * 100}%`,
    };
  }, [steps]);

  return (
    <Box className={classes.root}>
      <Box className={classes.header}>
        <Typography className={classes.title} component='div'>
          {t('bottomBar.missionSetup')}
        </Typography>
        <Typography className={classes.stepCounter} component='span'>
          {t('bottomBar.stepOf', {
            current: activeIndex + 1,
            total: steps.length,
          })}
        </Typography>
      </Box>

      <Box className={classes.progressWrap}>
        <Box className={classes.progressTrack}>
          <input
            ref={exportFileInputRef}
            accept={EXTENSIONS.join(',')}
            hidden
            id='bottom-bar-show-file-upload'
            type='file'
            onChange={handleExportFileChange}
          />

          <Box className={classes.circleRow}>
            <Box
              className={classes.progressBarBg}
              sx={{
                left: progressBarMetrics.inset,
                right: progressBarMetrics.inset,
              }}
            />
            <Box
              className={classes.progressBarFill}
              sx={{
                left: progressBarMetrics.inset,
                width: progressBarMetrics.fillWidth,
              }}
            />
            {steps.map((step, index) => {
              const done = isDone(step.status);
              const active =
                index === activeIndex ||
                step.status === Status.NEXT ||
                step.status === Status.WAITING;
              const StepIcon = step.icon;

              return (
                <Box key={step.key} className={classes.stepColumn} sx={{ zIndex: 1 }}>
                  <button
                    className={classes.stepButton}
                    disabled={step.disabled}
                    onClick={step.onClick}
                    type='button'
                  >
                    <Box className={classes.stepDot}>
                      <Box
                        className={`${classes.stepDotCircle} ${
                          done ? classes.stepDotCircleDone : ''
                        } ${active && !done ? classes.stepDotCircleActive : ''}`}
                        sx={
                          active && !done
                            ? {
                                borderColor: statusColor(step.status),
                                color: statusColor(step.status),
                              }
                            : undefined
                        }
                      >
                        {done ? (
                          <Check className={classes.stepDotCheck} />
                        ) : (
                          <StepIcon className={classes.stepDotIcon} />
                        )}
                      </Box>
                    </Box>
                    <Typography
                      className={`${classes.stepDotLabel} ${
                        active ? classes.stepDotLabelActive : ''
                      } ${done ? classes.stepDotLabelDone : ''}`}
                      component='span'
                      title={step.shortLabel}
                    >
                      {step.shortLabel}
                    </Typography>
                    {Array.isArray(step.sublabelLines) &&
                    step.sublabelLines.length > 0 ? (
                      <Box className={classes.stepSubWrap}>
                        {step.sublabelLines.map((line) => (
                          <Typography
                            key={line}
                            className={classes.stepSubLine}
                            component='span'
                            title={line}
                          >
                            {line}
                          </Typography>
                        ))}
                      </Box>
                    ) : step.sublabel ? (
                      <Typography
                        className={classes.stepSub}
                        component='span'
                        title={step.sublabel}
                      >
                        {step.sublabel}
                      </Typography>
                    ) : null}
                  </button>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>

      {hasFeature('loadShowFromCloud') || hasLoadedFile ? (
        <Box className={classes.footer}>
          {hasLoadedFile ? (
            <IconButton
              aria-label='뒤로가기 (쇼 해제)'
              title='로드된 쇼를 해제하고 mission setup을 처음 단계로 되돌립니다'
              className={classes.addButton}
              onClick={handleGoBack}
              size='small'
            >
              <ArrowBack fontSize='small' />
            </IconButton>
          ) : null}
          {hasFeature('loadShowFromCloud') ? (
            <IconButton
              aria-label={t('show.fromCloud')}
              className={classes.addButton}
              onClick={onLoadFromCloud}
              size='small'
            >
              <Add fontSize='small' />
            </IconButton>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};

MissionSetupStrip.propTypes = {
  environmentKey: PropTypes.string,
  hasLoadedFile: PropTypes.bool,
  isUploading: PropTypes.bool,
  maxDistance: PropTypes.number,
  missionDroneCount: PropTypes.number,
  onClearLoadedShow: PropTypes.func,
  onEditEnvironment: PropTypes.func,
  onLoadFromCloud: PropTypes.func,
  onOpenTakeoffArea: PropTypes.func,
  onOpenUpload: PropTypes.func,
  onShowFileSelected: PropTypes.func,
  showDescription: PropTypes.string,
  showFilePath: PropTypes.string,
  showTitle: PropTypes.string,
  stageStatuses: PropTypes.object,
};

export default connect(
  (state) => ({
    environmentKey: getEnvironmentDescription(state),
    hasLoadedFile: hasLoadedShowFile(state),
    isUploading: isUploadInProgress(state),
    maxDistance: getFarthestDistanceFromHome(state),
    missionDroneCount: getUAVIdsParticipatingInMission(state).length,
    showDescription: getShowDescription(state),
    showFilePath: getAbsolutePathOfShowFile(state),
    showTitle: getShowTitle(state),
    stageStatuses: getSetupStageStatuses(state),
  }),
  {
    onClearLoadedShow: clearLoadedShow,
    onEditEnvironment: openEnvironmentEditorDialog,
    onLoadFromCloud: openLoadShowFromCloudDialog,
    onOpenTakeoffArea: openTakeoffAreaSetupDialog,
    onOpenUpload: () => openUploadDialogForJob({ job: SHOW_UPLOAD_JOB }),
    onShowFileSelected: loadShowFromFile,
  }
)(MissionSetupStrip);
