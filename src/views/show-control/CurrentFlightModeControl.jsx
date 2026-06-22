import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import PropTypes from 'prop-types';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { withTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { makeStyles } from '@skybrush/app-theme-mui';

import { areFlightCommandsBroadcast } from '~/features/mission/selectors';
import { getUAVIdsParticipatingInMission } from '~/features/mission/selectors';
import { showError, showSuccess } from '~/features/snackbar/actions';
import { getSelectedUAVIds, getUAVById, getActiveUAVIds } from '~/features/uavs/selectors';
import messageHub from '~/message-hub';
import store from '~/store';
import {
  CURRENT_FLIGHT_MODE_COMMANDS,
  getDefaultCurrentFlightModeCommand,
  isSupportedCurrentFlightModeCommand,
  summarizeTelemetryModes,
  telemetryModeToCommand,
} from '~/utils/mavlinkFlightModes';

const useStyles = makeStyles((theme) => ({
  root: {
    alignItems: 'center',
    display: 'flex',
    flexShrink: 0,
    gap: theme.spacing(0.375),
  },
  rootBottomBar: {
    alignItems: 'center',
    display: 'flex',
    flex: 1,
    gap: theme.spacing(0.5),
    minWidth: 0,
  },
  label: {
    color: theme.palette.text.secondary,
    fontSize: '0.72rem',
    fontWeight: 600,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },
  labelBottomBar: {
    color: theme.palette.text.primary,
    flexShrink: 0,
    fontSize: '0.78rem',
    fontWeight: 500,
    lineHeight: 1,
    minWidth: 44,
    whiteSpace: 'nowrap',
  },
  select: {
    backgroundColor: theme.palette.action.hover,
    borderRadius: 6,
    color: theme.palette.text.primary,
    fontSize: '0.76rem',
    fontWeight: 500,
    height: 28,
    minWidth: 96,

    '& .MuiSelect-select': {
      padding: theme.spacing(0.5, 3, 0.5, 1),
    },

    '& .MuiOutlinedInput-notchedOutline': {
      border: `1px solid ${theme.palette.divider}`,
    },

    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: theme.palette.text.secondary,
    },

    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: theme.palette.primary.main,
    },

    '& .MuiSvgIcon-root': {
      color: theme.palette.text.secondary,
    },
  },
  selectBottomBar: {
    backgroundColor: theme.palette.common.white,
    borderRadius: 4,
    flex: 1,
    fontSize: '0.8rem',
    fontWeight: 500,
    height: 32,
    minWidth: 0,

    '& .MuiSelect-select': {
      padding: theme.spacing(0.625, 3, 0.625, 1.25),
    },

    '& .MuiOutlinedInput-notchedOutline': {
      border: `1px solid ${theme.palette.divider}`,
    },

    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: theme.palette.text.secondary,
    },

    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: theme.palette.text.primary,
    },
  },
  applyButton: {
    borderRadius: 6,
    fontSize: '0.72rem',
    fontWeight: 600,
    lineHeight: 1,
    minHeight: 28,
    minWidth: 48,
    padding: theme.spacing(0.5, 1),
    textTransform: 'none',
  },
  applyButtonBottomBar: {
    backgroundColor: theme.palette.common.black,
    borderRadius: 4,
    color: theme.palette.common.white,
    flexShrink: 0,
    fontSize: '0.76rem',
    fontWeight: 600,
    lineHeight: 1,
    minHeight: 32,
    minWidth: 56,
    padding: theme.spacing(0.625, 1.25),
    textTransform: 'none',

    '&:hover': {
      backgroundColor: '#333',
    },

    '&.Mui-disabled': {
      backgroundColor: theme.palette.action.disabledBackground,
      color: theme.palette.action.disabled,
    },
  },
}));

const CurrentFlightModeControl = ({
  activeUAVIds,
  broadcast,
  missionUAVIds,
  onNotifyError,
  onNotifySuccess,
  selectedUAVIds,
  t,
  variant = 'default',
}) => {
  const classes = useStyles();
  const isBottomBar = variant === 'bottomBar';
  const [mode, setMode] = useState(getDefaultCurrentFlightModeCommand);
  const [applying, setApplying] = useState(false);

  const targetUAVIds = useMemo(() => {
    if (broadcast) {
      return missionUAVIds.length > 0 ? missionUAVIds : activeUAVIds;
    }

    return selectedUAVIds;
  }, [activeUAVIds, broadcast, missionUAVIds, selectedUAVIds]);

  const canApply = broadcast || selectedUAVIds.length > 0;

  const modeOptions = useMemo(
    () =>
      CURRENT_FLIGHT_MODE_COMMANDS.map((preset) => ({
        value: preset.command,
        label: t(`currentFlightModeControl.modes.${preset.labelKey}`),
      })),
    [t]
  );

  useEffect(() => {
    if (!canApply) {
      setMode(getDefaultCurrentFlightModeCommand());
      return;
    }

    const state = store.getState();
    const telemetryModes = targetUAVIds.map(
      (uavId) => getUAVById(state, uavId)?.mode
    );
    const summarized = summarizeTelemetryModes(telemetryModes);
    if (summarized) {
      setMode(summarized);
    }
  }, [canApply, targetUAVIds]);

  const handleApply = useCallback(async () => {
    if (!canApply || applying) {
      return;
    }

    if (targetUAVIds.length === 0) {
      onNotifyError(t('currentFlightModeControl.applyFailedGeneric'));
      return;
    }

    if (!isSupportedCurrentFlightModeCommand(mode)) {
      onNotifyError(t('currentFlightModeControl.applyFailedGeneric'));
      return;
    }

    setApplying(true);
    const failures = [];

    try {
      const state = store.getState();

      for (const uavId of targetUAVIds) {
        const currentTelemetry = getUAVById(state, uavId)?.mode;
        const currentCommand = telemetryModeToCommand(currentTelemetry);
        if (currentCommand === mode) {
          continue;
        }

        try {
          await messageHub.execute.setUAVFlightMode({ uavId, mode });
        } catch (error) {
          failures.push(
            `${uavId}: ${error?.message ? String(error.message) : String(error)}`
          );
        }
      }

      if (failures.length === targetUAVIds.length) {
        onNotifyError(
          t('currentFlightModeControl.applyFailed', {
            message: failures.join('; '),
          })
        );
      } else if (failures.length > 0) {
        onNotifyError(
          t('currentFlightModeControl.applyPartial', {
            detail: `: ${failures.join('; ')}`,
          })
        );
      } else {
        onNotifySuccess(t('currentFlightModeControl.applySuccess'));
      }
    } catch (error) {
      onNotifyError(
        error?.message
          ? t('currentFlightModeControl.applyFailed', {
              message: error.message,
            })
          : t('currentFlightModeControl.applyFailedGeneric')
      );
    } finally {
      setApplying(false);
    }
  }, [
    applying,
    canApply,
    mode,
    onNotifyError,
    onNotifySuccess,
    t,
    targetUAVIds,
  ]);

  return (
    <Box className={isBottomBar ? classes.rootBottomBar : classes.root}>
      <span
        className={isBottomBar ? classes.labelBottomBar : classes.label}
      >
        {t('currentFlightModeControl.label')}
      </span>
      <Select
        className={isBottomBar ? classes.selectBottomBar : classes.select}
        disabled={!canApply || applying}
        displayEmpty
        size='small'
        value={mode}
        onChange={(event) => setMode(String(event.target.value))}
      >
        {modeOptions.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
      <Button
        className={
          isBottomBar ? classes.applyButtonBottomBar : classes.applyButton
        }
        color={isBottomBar ? 'inherit' : 'primary'}
        disabled={!canApply || applying}
        size='small'
        title={
          canApply
            ? broadcast
              ? t('currentFlightModeControl.tooltipBroadcast', {
                  count: targetUAVIds.length,
                })
              : t('currentFlightModeControl.tooltipSelection', {
                  count: selectedUAVIds.length,
                })
            : t('currentFlightModeControl.tooltipNoSelection')
        }
        variant='contained'
        onClick={handleApply}
      >
        {applying ? (
          <CircularProgress color='inherit' size={14} />
        ) : (
          t('currentFlightModeControl.apply')
        )}
      </Button>
    </Box>
  );
};

CurrentFlightModeControl.propTypes = {
  activeUAVIds: PropTypes.arrayOf(PropTypes.string),
  broadcast: PropTypes.bool,
  missionUAVIds: PropTypes.arrayOf(PropTypes.string),
  onNotifyError: PropTypes.func,
  onNotifySuccess: PropTypes.func,
  selectedUAVIds: PropTypes.arrayOf(PropTypes.string),
  t: PropTypes.func,
  variant: PropTypes.oneOf(['default', 'bottomBar']),
};

export default connect(
  (state) => ({
    activeUAVIds: getActiveUAVIds(state),
    broadcast: areFlightCommandsBroadcast(state),
    missionUAVIds: getUAVIdsParticipatingInMission(state),
    selectedUAVIds: getSelectedUAVIds(state),
  }),
  (dispatch) => ({
    onNotifyError: (message) => dispatch(showError(message)),
    onNotifySuccess: (message) => dispatch(showSuccess(message)),
  })
)(withTranslation()(CurrentFlightModeControl));
