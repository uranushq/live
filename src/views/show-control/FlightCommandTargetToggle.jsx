import AdsClick from '@mui/icons-material/AdsClick';
import Cast from '@mui/icons-material/Cast';
import Box from '@mui/material/Box';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import PropTypes from 'prop-types';
import React from 'react';
import { withTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { makeStyles } from '@skybrush/app-theme-mui';

import {
  areFlightCommandsBroadcast,
  getReverseMissionMapping,
} from '~/features/mission/selectors';
import { setCommandsAreBroadcast } from '~/features/mission/slice';
import { getSelectedUAVIds } from '~/features/uavs/selectors';

import { formatCommandTargetDrones } from './formatCommandTargetDrones';

const useStyles = makeStyles((theme) => ({
  wrapper: {
    alignItems: 'center',
    display: 'flex',
    flexShrink: 0,
    gap: theme.spacing(0.75),
  },
  modeLabel: {
    color: theme.palette.text.primary,
    fontSize: '0.78rem',
    fontWeight: 600,
    letterSpacing: '0.02em',
    lineHeight: 1,
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  modeLabelSelection: {
    color: '#2f80ed',
  },
  modeLabelAll: {
    color: '#d97b16',
  },
  group: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 4,
    flexShrink: 0,
    gap: 2,
    padding: 2,

    '& .MuiToggleButtonGroup-grouped': {
      border: 0,
      margin: 0,
    },

    '& .MuiToggleButton-root': {
      border: `1px solid transparent`,
      borderRadius: '3px !important',
      color: theme.palette.text.secondary,
      fontSize: '0.74rem',
      fontWeight: 600,
      gap: theme.spacing(0.375),
      letterSpacing: '0.02em',
      lineHeight: 1,
      minHeight: 28,
      minWidth: 28,
      padding: theme.spacing(0.5),
      textTransform: 'none',

      '&:hover': {
        backgroundColor: theme.palette.action.hover,
      },

      '&.Mui-selected': {
        color: theme.palette.common.white,
        fontWeight: 700,
      },
    },
  },
  modeSelection: {
    '&.Mui-selected': {
      backgroundColor: '#2f80ed !important',
      borderColor: '#2f80ed !important',
    },
  },
  modeBroadcast: {
    '&.Mui-selected': {
      backgroundColor: '#d97b16 !important',
      borderColor: '#d97b16 !important',
    },
  },
  modeIcon: {
    fontSize: '1.05rem',
  },
}));

const FlightCommandTargetToggle = ({
  broadcast,
  onChangeBroadcastMode,
  reverseMissionMapping,
  selectedUAVIds,
  t,
}) => {
  const classes = useStyles();
  const mode = broadcast ? 'broadcast' : 'selection';

  const selectedDroneLabels = formatCommandTargetDrones(
    selectedUAVIds,
    reverseMissionMapping
  );

  const selectionTip = `${t('largeControlButtonGroup.modeSelection')} — ${t(
    'largeControlButtonGroup.targetSelection'
  )}`;
  const broadcastTip = `${t('largeControlButtonGroup.modeBroadcast')} — ${t(
    'largeControlButtonGroup.targetBroadcast'
  )}`;

  return (
    <Box className={classes.wrapper}>
      <Typography
        className={`${classes.modeLabel} ${
          broadcast ? classes.modeLabelAll : classes.modeLabelSelection
        }`}
        component='span'
        title={
          !broadcast && selectedDroneLabels ? selectedDroneLabels : undefined
        }
      >
        {broadcast
          ? t('bottomBar.commandTargetAll')
          : selectedDroneLabels
            ? t('bottomBar.commandTargetSelectionWithDrones', {
                drones: selectedDroneLabels,
              })
            : t('bottomBar.commandTargetSelection')}
      </Typography>
      <ToggleButtonGroup
        exclusive
        aria-label={t('largeControlButtonGroup.modeToggleLabel')}
        className={classes.group}
        size='small'
        value={mode}
        onChange={onChangeBroadcastMode}
      >
        <ToggleButton
          aria-label={t('largeControlButtonGroup.selectionOnly')}
          className={classes.modeSelection}
          title={selectionTip}
          value='selection'
        >
          <AdsClick className={classes.modeIcon} />
        </ToggleButton>
        <ToggleButton
          aria-label={t('largeControlButtonGroup.broadcast')}
          className={classes.modeBroadcast}
          title={broadcastTip}
          value='broadcast'
        >
          <Cast className={classes.modeIcon} />
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
};

FlightCommandTargetToggle.propTypes = {
  broadcast: PropTypes.bool,
  onChangeBroadcastMode: PropTypes.func,
  reverseMissionMapping: PropTypes.object,
  selectedUAVIds: PropTypes.arrayOf(PropTypes.string),
  t: PropTypes.func,
};

export default connect(
  (state) => ({
    broadcast: areFlightCommandsBroadcast(state),
    reverseMissionMapping: getReverseMissionMapping(state),
    selectedUAVIds: getSelectedUAVIds(state),
  }),
  (dispatch) => ({
    onChangeBroadcastMode: (_event, value) => {
      if (value) {
        dispatch(setCommandsAreBroadcast(value === 'broadcast'));
      }
    },
  })
)(withTranslation()(FlightCommandTargetToggle));
