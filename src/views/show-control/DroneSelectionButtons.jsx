import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import PropTypes from 'prop-types';
import React, { useCallback } from 'react';
import { connect } from 'react-redux';

import { makeStyles } from '@skybrush/app-theme-mui';

import { clearSelection } from '~/features/map/selection';
import { selectAllVisibleUAVs } from '~/features/drone-groups/actions';
import { getSelectedUAVIds, getUAVIdList } from '~/features/uavs/selectors';

const useStyles = makeStyles((theme) => ({
  group: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    flexShrink: 0,
    gap: 3,
    padding: 3,

    '& .MuiToggleButtonGroup-grouped': {
      border: 0,
      margin: 0,
    },

    '& .MuiToggleButton-root': {
      border: '1px solid transparent',
      borderRadius: '4px !important',
      color: theme.palette.text.secondary,
      fontSize: '0.95rem',
      fontWeight: 700,
      letterSpacing: '0.01em',
      lineHeight: 1.2,
      minHeight: 44,
      minWidth: 110,
      padding: theme.spacing(1, 1.75),
      textTransform: 'none',

      '&:hover': {
        backgroundColor: theme.palette.action.hover,
      },

      '&.Mui-selected': {
        color: theme.palette.common.white,
        fontWeight: 700,
      },

      '&.Mui-selected:hover': {
        color: theme.palette.common.white,
      },
    },
  },
  selectAll: {
    '&.Mui-selected': {
      backgroundColor: '#2f80ed !important',
      borderColor: '#2f80ed !important',
    },
  },
  deselect: {
    '&.Mui-selected': {
      backgroundColor: '#5a5e68 !important',
      borderColor: '#5a5e68 !important',
    },
  },
}));

const DroneSelectionButtons = ({
  allSelected,
  hasSelection,
  onDeselect,
  onSelectAll,
}) => {
  const classes = useStyles();
  const value = allSelected ? 'all' : hasSelection ? null : 'none';

  const handleChange = useCallback(
    (_event, nextValue) => {
      if (nextValue === 'all') {
        onSelectAll();
      } else if (nextValue === 'none') {
        onDeselect();
      }
    },
    [onDeselect, onSelectAll]
  );

  return (
    <ToggleButtonGroup
      exclusive
      aria-label='Drone selection'
      className={classes.group}
      size='small'
      value={value}
      onChange={handleChange}
    >
      <ToggleButton
        className={classes.selectAll}
        title='Select all drones'
        value='all'
      >
        Select All
      </ToggleButton>
      <ToggleButton
        className={classes.deselect}
        title='Deselect all drones'
        value='none'
      >
        Deselect
      </ToggleButton>
    </ToggleButtonGroup>
  );
};

DroneSelectionButtons.propTypes = {
  allSelected: PropTypes.bool,
  hasSelection: PropTypes.bool,
  onDeselect: PropTypes.func.isRequired,
  onSelectAll: PropTypes.func.isRequired,
};

export default connect(
  (state) => {
    const selectedUAVIds = getSelectedUAVIds(state);
    const allUAVIds = getUAVIdList(state);
    const selectedSet = new Set(selectedUAVIds);
    const allSelected =
      allUAVIds.length > 0 && allUAVIds.every((id) => selectedSet.has(id));

    return {
      allSelected,
      hasSelection: selectedUAVIds.length > 0,
    };
  },
  {
    onDeselect: clearSelection,
    onSelectAll: selectAllVisibleUAVs,
  }
)(DroneSelectionButtons);
