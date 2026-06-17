import FlightTakeoff from '@mui/icons-material/FlightTakeoff';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tooltip from '@mui/material/Tooltip';
import PropTypes from 'prop-types';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { withTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { makeStyles } from '@skybrush/app-theme-mui';

import { mergeFltModeSlotsByUavId } from '~/features/mavlink/slice';
import { areFlightCommandsBroadcast } from '~/features/mission/selectors';
import { showError, showSuccess } from '~/features/snackbar/actions';
import { getSelectedUAVIds } from '~/features/uavs/selectors';
import {
  FLIGHT_MODE_PRESETS,
  getDefaultFlightModeValue,
  getFlightModes,
  parseFltModeSlotsByUavId,
  setFlightModes,
  summarizeFlightModeFromResults,
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
    minWidth: 108,

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

const FlightModeControl = ({
  broadcast,
  onFltModeSlotsUpdated,
  onNotifyError,
  onNotifySuccess,
  selectedUAVIds,
  t,
}) => {
  const classes = useStyles();
  const [mode, setMode] = useState(getDefaultFlightModeValue);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const targetUAVIds = useMemo(
    () => (broadcast ? undefined : selectedUAVIds),
    [broadcast, selectedUAVIds]
  );

  const canApply = broadcast || selectedUAVIds.length > 0;

  const modeOptions = useMemo(
    () =>
      FLIGHT_MODE_PRESETS.map((preset) => ({
        value: preset.value,
        label: t(`flightModeControl.modes.${preset.labelKey}`),
      })),
    [t]
  );

  const refreshCurrentMode = useCallback(async () => {
    if (!broadcast && selectedUAVIds.length === 0) {
      setMode(getDefaultFlightModeValue());
      return;
    }

    setLoading(true);
    try {
      const body = await getFlightModes(targetUAVIds);
      onFltModeSlotsUpdated(parseFltModeSlotsByUavId(body));
      const summarized = summarizeFlightModeFromResults(body);
      if (typeof summarized === 'number') {
        setMode(summarized);
      }
    } catch (error) {
      // Silent on refresh; the user can still apply a mode manually.
    } finally {
      setLoading(false);
    }
  }, [broadcast, onFltModeSlotsUpdated, selectedUAVIds, targetUAVIds]);

  useEffect(() => {
    refreshCurrentMode();
  }, [refreshCurrentMode]);

  const handleApply = useCallback(async () => {
    if (!canApply || applying) {
      return;
    }

    setApplying(true);
    try {
      const { body, partial } = await setFlightModes(mode, targetUAVIds);
      onFltModeSlotsUpdated(parseFltModeSlotsByUavId(body));

      if (partial) {
        const detail =
          Array.isArray(body?.errors) && body.errors.length > 0
            ? `: ${body.errors.join('; ')}`
            : '';
        onNotifyError(t('flightModeControl.applyPartial', { detail }));
      } else {
        onNotifySuccess(t('flightModeControl.applySuccess'));
      }

      await refreshCurrentMode();
    } catch (error) {
      onNotifyError(
        error?.message
          ? t('flightModeControl.applyFailed', { message: error.message })
          : t('flightModeControl.applyFailedGeneric')
      );
    } finally {
      setApplying(false);
    }
  }, [
    applying,
    canApply,
    mode,
    onFltModeSlotsUpdated,
    onNotifyError,
    onNotifySuccess,
    refreshCurrentMode,
    t,
    targetUAVIds,
  ]);

  const tooltip = broadcast
    ? t('flightModeControl.tooltipBroadcast')
    : selectedUAVIds.length > 0
      ? t('flightModeControl.tooltipSelection', {
          count: selectedUAVIds.length,
        })
      : t('flightModeControl.tooltipNoSelection');

  return (
    <Tooltip placement='top' title={tooltip}>
      <Box className={classes.root}>
        <span className={classes.label}>
          <FlightTakeoff className={classes.labelIcon} />
          {t('flightModeControl.label')}
        </span>
        <Select
          className={classes.select}
          disabled={!canApply || loading || applying}
          displayEmpty
          size='small'
          value={mode}
          onChange={(event) => setMode(Number(event.target.value))}
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
            t('flightModeControl.apply')
          )}
        </Button>
      </Box>
    </Tooltip>
  );
};

FlightModeControl.propTypes = {
  broadcast: PropTypes.bool,
  onFltModeSlotsUpdated: PropTypes.func,
  onNotifyError: PropTypes.func,
  onNotifySuccess: PropTypes.func,
  selectedUAVIds: PropTypes.arrayOf(PropTypes.string),
  t: PropTypes.func,
};

export default connect(
  (state) => ({
    broadcast: areFlightCommandsBroadcast(state),
    selectedUAVIds: getSelectedUAVIds(state),
  }),
  (dispatch) => ({
    onFltModeSlotsUpdated: (slotsByUavId) =>
      dispatch(mergeFltModeSlotsByUavId(slotsByUavId)),
    onNotifyError: (message) => dispatch(showError(message)),
    onNotifySuccess: (message) => dispatch(showSuccess(message)),
  })
)(withTranslation()(FlightModeControl));
