/**
 * @file Dialog for creating and editing named UAV groups.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import PropTypes from 'prop-types';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { connect, useSelector } from 'react-redux';

import { makeStyles, monospacedFont } from '@skybrush/app-theme-mui';
import { DraggableDialog, StatusPill } from '@skybrush/mui-components';

import BatteryIndicator from '~/components/BatteryIndicator';
import {
  closeNamedUAVGroupDialog,
  removeNamedUAVGroup,
  saveNamedUAVGroup,
} from '~/features/drone-groups/actions';
import {
  getEditedNamedUAVGroup,
  getNextDefaultNamedUAVGroupName,
  getUAVIdsAssignedToAnyNamedGroup,
  isNamedUAVGroupDialogOpen,
} from '~/features/drone-groups/selectors';
import { getReverseMissionMapping } from '~/features/mission/selectors';
import {
  getBatteryFormatter,
  shouldOptimizeUIForTouch,
} from '~/features/settings/selectors';
import {
  getAllUAVIdList,
  getSelectedUAVIds,
  getSingleUAVStatusSummary,
  getUAVById,
} from '~/features/uavs/selectors';
import { formatMissionId } from '~/utils/formatting';

const useStyles = makeStyles((theme) => ({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    width: 520,
  },
  toolbar: {
    alignItems: 'center',
    display: 'flex',
    gap: theme.spacing(1),
  },
  toolbarSpacer: {
    flex: 1,
  },
  listShell: {
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    maxHeight: 340,
    minHeight: 180,
    overflowY: 'auto',
  },
  list: {
    padding: theme.spacing(0.5, 0),
  },
  row: {
    alignItems: 'center',
    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
    gap: theme.spacing(0.5),
    minHeight: 48,
    paddingBottom: theme.spacing(0.5),
    paddingTop: theme.spacing(0.5),
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  rowSelected: {
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
  },
  idBlock: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 52,
  },
  droneId: {
    fontFamily: monospacedFont,
    fontSize: '0.95rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  missionId: {
    color: theme.palette.text.secondary,
    fontFamily: monospacedFont,
    fontSize: '0.7rem',
    lineHeight: 1.2,
  },
  meta: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.75),
    justifyContent: 'flex-end',
    marginLeft: 'auto',
  },
  modeLabel: {
    color: theme.palette.text.secondary,
    fontFamily: monospacedFont,
    fontSize: '0.72rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
    minWidth: 36,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  emptyHint: {
    color: theme.palette.text.disabled,
    fontSize: '0.85rem',
    padding: theme.spacing(3, 2),
    textAlign: 'center',
  },
  selectedChip: {
    fontWeight: 600,
  },
}));

const GroupDroneRow = ({ checked, classes, uavId, onToggle }) => {
  const uav = useSelector((state) => getUAVById(state, uavId));
  const reverseMissionMapping = useSelector(getReverseMissionMapping);
  const batteryFormatter = useSelector(getBatteryFormatter);
  const summary = useMemo(() => getSingleUAVStatusSummary(uav), [uav]);

  const missionIndex = reverseMissionMapping?.[uavId];
  const missionLabel =
    typeof missionIndex === 'number' ? formatMissionId(missionIndex) : null;
  const modeLabel = uav?.mode || '—';

  return (
    <ListItemButton
      className={`${classes.row}${checked ? ` ${classes.rowSelected}` : ''}`}
      dense
      onClick={() => {
        onToggle(uavId);
      }}
    >
      <ListItemIcon sx={{ minWidth: 36 }}>
        <Checkbox
          disableRipple
          edge='start'
          checked={checked}
          tabIndex={-1}
          size='small'
        />
      </ListItemIcon>

      <Box className={classes.idBlock}>
        <Typography className={classes.droneId}>{uavId}</Typography>
        {missionLabel && (
          <Typography className={classes.missionId}>{missionLabel}</Typography>
        )}
      </Box>

      <Box className={classes.meta}>
        <StatusPill inline status={summary.textSemantics || 'off'}>
          {(summary.text || '—').toUpperCase()}
        </StatusPill>
        <Typography className={classes.modeLabel}>{modeLabel}</Typography>
        <BatteryIndicator
          formatter={batteryFormatter}
          percentage={summary.batteryStatus?.percentage}
          voltage={summary.batteryStatus?.voltage}
          width={56}
        />
      </Box>
    </ListItemButton>
  );
};

GroupDroneRow.propTypes = {
  checked: PropTypes.bool,
  classes: PropTypes.object,
  onToggle: PropTypes.func,
  uavId: PropTypes.string,
};

const NamedUAVGroupEditorDialog = ({
  defaultGroupName,
  editedGroup,
  initialSelectedIds,
  onClose,
  onDelete,
  onSave,
  open,
  optimizeUIForTouch,
  uavIdsAlreadyInGroups,
  uavIds,
}) => {
  const classes = useStyles();
  const { t } = useTranslation();
  const isEditing = Boolean(editedGroup);

  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);

  const selectableUavIds = useMemo(() => {
    if (isEditing && editedGroup) {
      const currentMembers = new Set(editedGroup.uavIds);
      return uavIds.filter(
        (id) => currentMembers.has(id) || !uavIdsAlreadyInGroups.has(id)
      );
    }

    return uavIds.filter((id) => !uavIdsAlreadyInGroups.has(id));
  }, [editedGroup, isEditing, uavIds, uavIdsAlreadyInGroups]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (editedGroup) {
      setName(editedGroup.name);
      setSelectedIds([...editedGroup.uavIds]);
    } else {
      setName(defaultGroupName);
      setSelectedIds(
        initialSelectedIds.filter((id) => !uavIdsAlreadyInGroups.has(id))
      );
    }
    // Seed only when the dialog opens or the edited group changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [open, editedGroup, defaultGroupName]);

  const orderedSelectedIds = useMemo(
    () => selectableUavIds.filter((id) => selectedIds.includes(id)),
    [selectableUavIds, selectedIds]
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected =
    selectableUavIds.length > 0 &&
    selectableUavIds.every((id) => selectedSet.has(id));

  const canSave = name.trim().length > 0 && orderedSelectedIds.length > 0;

  const handleToggle = useCallback((uavId) => {
    setSelectedIds((prev) =>
      prev.includes(uavId)
        ? prev.filter((id) => id !== uavId)
        : [...prev, uavId]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds([...selectableUavIds]);
  }, [selectableUavIds]);

  const handleClear = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const handleSave = useCallback(() => {
    if (!canSave) {
      return;
    }

    onSave({
      id: editedGroup?.id,
      name: name.trim(),
      uavIds: orderedSelectedIds,
    });
  }, [canSave, editedGroup, name, onSave, orderedSelectedIds]);

  const handleDelete = useCallback(() => {
    if (editedGroup?.id) {
      onDelete(editedGroup.id);
    }
  }, [editedGroup, onDelete]);

  return (
    <DraggableDialog
      fullWidth
      open={open}
      maxWidth='sm'
      title={
        isEditing
          ? t('droneGroups.editTitle')
          : t('droneGroups.createTitle')
      }
      onClose={onClose}
    >
      <DialogContent className={classes.content}>
        <TextField
          autoFocus={!optimizeUIForTouch}
          fullWidth
          size='small'
          label={t('droneGroups.name')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSave) {
              event.preventDefault();
              handleSave();
            }
          }}
        />

        <Box className={classes.toolbar}>
          <Button
            size='small'
            disabled={selectableUavIds.length === 0 || allSelected}
            onClick={handleSelectAll}
          >
            {t('droneGroups.selectAll')}
          </Button>
          <Button
            size='small'
            disabled={orderedSelectedIds.length === 0}
            onClick={handleClear}
          >
            {t('droneGroups.clearSelection')}
          </Button>
          <Box className={classes.toolbarSpacer} />
          <Chip
            className={classes.selectedChip}
            color={orderedSelectedIds.length > 0 ? 'primary' : 'default'}
            label={t('droneGroups.selectedDrones', {
              count: orderedSelectedIds.length,
            })}
            size='small'
            variant={orderedSelectedIds.length > 0 ? 'filled' : 'outlined'}
          />
        </Box>

        <Box className={classes.listShell}>
          {selectableUavIds.length === 0 ? (
            <Typography className={classes.emptyHint}>
              {t('droneGroups.noDronesAvailable')}
            </Typography>
          ) : (
            <List className={classes.list} dense disablePadding>
              {selectableUavIds.map((uavId) => (
                <GroupDroneRow
                  key={uavId}
                  checked={selectedSet.has(uavId)}
                  classes={classes}
                  uavId={uavId}
                  onToggle={handleToggle}
                />
              ))}
            </List>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        {isEditing && (
          <Button color='error' onClick={handleDelete}>
            {t('droneGroups.delete')}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{t('general.action.cancel')}</Button>
        <Button
          color='primary'
          disabled={!canSave}
          variant='contained'
          onClick={handleSave}
        >
          {isEditing ? t('droneGroups.save') : t('droneGroups.create')}
        </Button>
      </DialogActions>
    </DraggableDialog>
  );
};

NamedUAVGroupEditorDialog.propTypes = {
  defaultGroupName: PropTypes.string,
  editedGroup: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    uavIds: PropTypes.arrayOf(PropTypes.string),
  }),
  initialSelectedIds: PropTypes.arrayOf(PropTypes.string),
  onClose: PropTypes.func,
  onDelete: PropTypes.func,
  onSave: PropTypes.func,
  open: PropTypes.bool,
  optimizeUIForTouch: PropTypes.bool,
  uavIds: PropTypes.arrayOf(PropTypes.string),
  uavIdsAlreadyInGroups: PropTypes.instanceOf(Set),
};

export default connect(
  (state) => ({
    defaultGroupName: getNextDefaultNamedUAVGroupName(state),
    editedGroup: getEditedNamedUAVGroup(state),
    initialSelectedIds: getSelectedUAVIds(state),
    open: isNamedUAVGroupDialogOpen(state),
    optimizeUIForTouch: shouldOptimizeUIForTouch(state),
    uavIds: getAllUAVIdList(state),
    uavIdsAlreadyInGroups: getUAVIdsAssignedToAnyNamedGroup(state),
  }),
  {
    onClose: closeNamedUAVGroupDialog,
    onDelete: removeNamedUAVGroup,
    onSave: saveNamedUAVGroup,
  }
)(NamedUAVGroupEditorDialog);
