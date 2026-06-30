import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useHarmonicIntervalFn, useUpdate } from 'react-use';

import { makeStyles } from '@skybrush/app-theme-mui';

import { isSidebarOpen } from '~/features/sidebar/selectors';
import {
  formatShowTimer,
  getShowTimerSnapshot,
  type ShowTimerPhase,
} from '~/features/show/showTimerUtils';
import { shouldSidebarBeShown } from '~/features/workbench/selectors';
import type { RootState } from '~/store/reducers';

const UPDATE_INTERVAL_MS = 100;
const SIDEBAR_OPEN_WIDTH = 180;
const SIDEBAR_COLLAPSED_WIDTH = 48;

const useStyles = makeStyles((theme) => ({
  root: {
    backgroundColor: '#1c242c',
    borderRadius: 10,
    bottom: theme.spacing(1.5),
    boxShadow: theme.shadows[8],
    pointerEvents: 'none',
    position: 'absolute',
    userSelect: 'none',
    zIndex: theme.zIndex.snackbar - 1,
  },
  waitingRoot: {
    minWidth: 248,
    padding: theme.spacing(1.5, 1.75, 1.25),
    width: 248,
  },
  runningRoot: {
    minWidth: 280,
    padding: theme.spacing(1.75, 2, 1.5),
    width: 280,
  },
  header: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1),
  },
  statusRow: {
    alignItems: 'center',
    display: 'flex',
    gap: theme.spacing(0.75),
  },
  statusDot: {
    borderRadius: '50%',
    flexShrink: 0,
    height: 8,
    width: 8,
  },
  statusDotWaiting: {
    backgroundColor: '#f9a84d',
  },
  statusDotRunning: {
    backgroundColor: '#3ecf6e',
  },
  statusLabelWaiting: {
    color: '#f9a84d',
    fontSize: '0.875rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  statusLabelRunning: {
    color: '#3ecf6e',
    fontSize: '0.875rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  totalLabel: {
    color: '#95a5a6',
    fontFamily: '"ProggyVector", monospace',
    fontSize: '0.6875rem',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.06em',
    lineHeight: 1.2,
    textTransform: 'uppercase',
  },
  waitingBody: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1),
    minHeight: 40,
  },
  waitingLabel: {
    color: '#95a5a6',
    fontSize: '0.8125rem',
    lineHeight: 1.2,
  },
  waitingValue: {
    color: '#f9a84d',
    fontFamily: '"ProggyVector", monospace',
    fontSize: '2rem',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    lineHeight: 1,
  },
  runningBody: {
    display: 'grid',
    gap: theme.spacing(0.75),
    gridTemplateColumns: '1fr 1px 1fr',
    marginBottom: theme.spacing(1.25),
  },
  divider: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    margin: theme.spacing(0.25, 0),
  },
  timerColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    minWidth: 0,
  },
  timerLabel: {
    color: '#95a5a6',
    fontSize: '0.75rem',
    lineHeight: 1.2,
  },
  timerValue: {
    color: theme.palette.common.white,
    fontFamily: '"ProggyVector", monospace',
    fontSize: '1.5rem',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    lineHeight: 1,
  },
  progressBarWaiting: {
    '& .MuiLinearProgress-bar': {
      backgroundColor: '#f9a84d',
      borderRadius: 999,
    },
    backgroundColor: '#34495e',
    borderRadius: 999,
    height: 4,
  },
  progressBarRunning: {
    '& .MuiLinearProgress-bar': {
      backgroundColor: '#3ecf6e',
      borderRadius: 999,
    },
    backgroundColor: '#34495e',
    borderRadius: 999,
    height: 4,
  },
}));

const phaseAccentClass = (
  phase: ShowTimerPhase,
  classes: ReturnType<typeof useStyles>
): string =>
  phase === 'waiting' ? classes.statusDotWaiting : classes.statusDotRunning;

const phaseLabelClass = (
  phase: ShowTimerPhase,
  classes: ReturnType<typeof useStyles>
): string =>
  phase === 'waiting'
    ? classes.statusLabelWaiting
    : classes.statusLabelRunning;

const ShowTimerOverlay = (): React.JSX.Element | null => {
  const classes = useStyles();
  const { t } = useTranslation();
  const update = useUpdate();
  const initialWaitSecondsRef = useRef<number | null>(null);

  useHarmonicIntervalFn(update, UPDATE_INTERVAL_MS);

  const snapshot = useSelector((state: RootState) => getShowTimerSnapshot(state));
  const showSidebar = useSelector(shouldSidebarBeShown);
  const sidebarOpen = useSelector(isSidebarOpen);
  const leftOffset =
    (showSidebar
      ? sidebarOpen
        ? SIDEBAR_OPEN_WIDTH
        : SIDEBAR_COLLAPSED_WIDTH
      : 0) + 12;

  useEffect(() => {
    if (snapshot?.phase === 'waiting') {
      if (
        initialWaitSecondsRef.current == null ||
        snapshot.remainingSeconds > initialWaitSecondsRef.current
      ) {
        initialWaitSecondsRef.current =
          snapshot.waitDurationSeconds ?? snapshot.remainingSeconds;
      }
      return;
    }

    initialWaitSecondsRef.current = null;
  }, [snapshot]);

  if (!snapshot) {
    return null;
  }

  const { durationSeconds, elapsedSeconds, phase, remainingSeconds } =
    snapshot;
  const waitDurationSeconds =
    initialWaitSecondsRef.current ??
    snapshot.waitDurationSeconds ??
    remainingSeconds;
  const totalLabel = `TOTAL ${formatShowTimer(durationSeconds)}`;
  const progress =
    phase === 'waiting'
      ? waitDurationSeconds > 0
        ? Math.min(
            100,
            Math.max(
              0,
              ((waitDurationSeconds - remainingSeconds) / waitDurationSeconds) *
                100
            )
          )
        : 0
      : durationSeconds > 0
        ? Math.min(100, Math.max(0, (elapsedSeconds / durationSeconds) * 100))
        : 0;

  return (
    <Box
      className={`${classes.root} ${
        phase === 'waiting' ? classes.waitingRoot : classes.runningRoot
      }`}
      style={{ left: leftOffset }}
    >
      <Box className={classes.header}>
        <Box className={classes.statusRow}>
          <Box
            className={`${classes.statusDot} ${phaseAccentClass(phase, classes)}`}
          />
          <Typography
            className={phaseLabelClass(phase, classes)}
            component='span'
          >
            {phase === 'waiting'
              ? t('showTimerOverlay.waitingToStart')
              : t('showTimerOverlay.showInProgress')}
          </Typography>
        </Box>
        <Typography className={classes.totalLabel} component='span'>
          {totalLabel}
        </Typography>
      </Box>

      {phase === 'waiting' ? (
        <Box className={classes.waitingBody}>
          <Typography className={classes.waitingLabel} component='span'>
            {t('showTimerOverlay.untilStart')}
          </Typography>
          <Typography className={classes.waitingValue} component='span'>
            {formatShowTimer(remainingSeconds)}
          </Typography>
        </Box>
      ) : (
        <Box className={classes.runningBody}>
          <Box className={classes.timerColumn}>
            <Typography className={classes.timerLabel} component='span'>
              {t('showTimerOverlay.elapsedTime')}
            </Typography>
            <Typography className={classes.timerValue} component='span'>
              {formatShowTimer(elapsedSeconds)}
            </Typography>
          </Box>
          <Box className={classes.divider} />
          <Box className={classes.timerColumn}>
            <Typography className={classes.timerLabel} component='span'>
              {t('showTimerOverlay.remainingTime')}
            </Typography>
            <Typography className={classes.timerValue} component='span'>
              {formatShowTimer(remainingSeconds)}
            </Typography>
          </Box>
        </Box>
      )}

      <LinearProgress
        className={
          phase === 'waiting'
            ? classes.progressBarWaiting
            : classes.progressBarRunning
        }
        value={progress}
        variant='determinate'
      />
    </Box>
  );
};

export default ShowTimerOverlay;
