import Flight from '@mui/icons-material/Flight';
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
import { getSelectedUAVIds, getUAVById } from '~/features/uavs/selectors';
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
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
    border: '1px solid rgba(255, 255, 255, 0.22)',
    borderRadius: 999,
    display: 'flex',
    flexShrink: 0,
    gap: theme.spacing(0.5),
    minHeight: 30,
    padding: theme.spacing(0.25, 0.5, 0.25, 0.75),
  },
  label: {
    alignItems: 'center',
    color: 'rgba(255, 255, 255, 0.72)',
    display: 'flex',
    fontSize: '0.68rem',
    fontWeight: 700,
    gap: theme.spacing(0.25),
    letterSpacing: '0.08em',
    lineHeight: 1,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  labelIcon: {
    fontSize: '1rem',
  },
  select: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 999,
    color: '#fff',
    fontSize: '0.74rem',
    fontWeight: 600,
    height: 26,
    minWidth: 116,

    '& .MuiSelect-select': {
      padding: theme.spacing(0.35, 3, 0.35, 1),
    },

    '& .MuiOutlinedInput-notchedOutline': {
      border: '1px solid rgba(255, 255, 255, 0.18)',
    },

    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: 'rgba(255, 255, 255, 0.32)',
    },

    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: '#5ca0ff',
    },

    '& .MuiSvgIcon-root': {
      color: 'rgba(255, 255, 255, 0.72)',
    },
  },
  applyButton: {
    borderRadius: 999,
    color: '#fff',
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1,
    minHeight: 26,
    minWidth: 52,
    padding: theme.spacing(0.35, 1),
    textTransform: 'none',
  },
}));

const CurrentFlightModeControl = ({
  broadcast,
  missionUAVIds,
  onNotifyError,
  onNotifySuccess,
  selectedUAVIds,
  t,
}) => {
  const classes = useStyles();
  const [mode, setMode] = useState(getDefaultCurrentFlightModeCommand);
  const [applying, setApplying] = useState(false);

  const targetUAVIds = useMemo(
    () => (broadcast ? missionUAVIds : selectedUAVIds),
    [broadcast, missionUAVIds, selectedUAVIds]
  );

  const canApply = targetUAVIds.length > 0;

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
    <Box className={classes.root}>
      <span className={classes.label}>
        <Flight className={classes.labelIcon} />
        {t('currentFlightModeControl.label')}
      </span>
      <Select
        className={classes.select}
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
        className={classes.applyButton}
        color='primary'
        disabled={!canApply || applying}
        size='small'
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
  broadcast: PropTypes.bool,
  missionUAVIds: PropTypes.arrayOf(PropTypes.string),
  onNotifyError: PropTypes.func,
  onNotifySuccess: PropTypes.func,
  selectedUAVIds: PropTypes.arrayOf(PropTypes.string),
  t: PropTypes.func,
};

export default connect(
  (state) => ({
    broadcast: areFlightCommandsBroadcast(state),
    missionUAVIds: getUAVIdsParticipatingInMission(state),
    selectedUAVIds: getSelectedUAVIds(state),
  }),
  (dispatch) => ({
    onNotifyError: (message) => dispatch(showError(message)),
    onNotifySuccess: (message) => dispatch(showSuccess(message)),
  })
)(withTranslation()(CurrentFlightModeControl));
