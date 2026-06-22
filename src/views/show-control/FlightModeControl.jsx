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
    minWidth: 36,
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

const FlightModeControl = ({
  broadcast,
  onFltModeSlotsUpdated,
  onNotifyError,
  onNotifySuccess,
  selectedUAVIds,
  t,
  variant = 'default',
}) => {
  const classes = useStyles();
  const isBottomBar = variant === 'bottomBar';
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

  return (
    <Box className={isBottomBar ? classes.rootBottomBar : classes.root}>
      <span
        className={isBottomBar ? classes.labelBottomBar : classes.label}
      >
        {t('flightModeControl.label')}
      </span>
      <Select
        className={isBottomBar ? classes.selectBottomBar : classes.select}
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
        className={
          isBottomBar ? classes.applyButtonBottomBar : classes.applyButton
        }
        color={isBottomBar ? 'inherit' : 'primary'}
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
  );
};

FlightModeControl.propTypes = {
  broadcast: PropTypes.bool,
  onFltModeSlotsUpdated: PropTypes.func,
  onNotifyError: PropTypes.func,
  onNotifySuccess: PropTypes.func,
  selectedUAVIds: PropTypes.arrayOf(PropTypes.string),
  t: PropTypes.func,
  variant: PropTypes.oneOf(['default', 'bottomBar']),
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
