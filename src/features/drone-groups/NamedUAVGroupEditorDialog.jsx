/**
 * @file Dialog for creating and editing named UAV groups.
 *
 * Layout inspired by the fleet group editor mock: name + search, status
 * filters, list/grid views, bulk selection actions, and richer drone rows.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import PropTypes from 'prop-types';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { isThemeDark, makeStyles, monospacedFont } from '@skybrush/app-theme-mui';
import { DraggableDialog } from '@skybrush/mui-components';

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
import { shouldOptimizeUIForTouch } from '~/features/settings/selectors';
import {
  getAllUAVIdList,
  getSelectedUAVIds,
  getSingleUAVStatusSummary,
  getUAVIdToStateMapping,
} from '~/features/uavs/selectors';
import { formatMissionId } from '~/utils/formatting';

const FILTER_ALL = 'all';
const FILTER_FLYING = 'flying';
const FILTER_GROUND = 'ground';
const FILTER_LOW = 'low';
const FILTER_SELECTED = 'sel';

const VIEW_LIST = 'list';
const VIEW_GRID = 'grid';

const LOW_VOLTAGE = 11.6;
const LOW_PERCENTAGE = 20;

const useStyles = makeStyles((theme) => {
  const dark = isThemeDark(theme);
  const accent = theme.palette.primary.main;
  const border = dark ? 'rgba(255,255,255,0.14)' : theme.palette.divider;
  const muted = theme.palette.text.secondary;

  return {
    content: {
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      maxHeight: '78vh',
      maxWidth: '100%',
      overflowX: 'hidden',
      paddingBottom: '0 !important',
      width: '100%',
    },
    headerMeta: {
      color: muted,
      fontSize: '0.72rem',
      fontWeight: 600,
      letterSpacing: '0.14em',
      marginLeft: theme.spacing(1.5),
      textTransform: 'uppercase',
    },
    fieldsRow: {
      display: 'grid',
      gap: theme.spacing(2.5),
      gridTemplateColumns: '1fr 1fr',
      padding: theme.spacing(2, 0, 1.5),
    },
    fieldLabel: {
      color: muted,
      display: 'block',
      fontSize: '0.7rem',
      fontWeight: 700,
      letterSpacing: '0.12em',
      marginBottom: theme.spacing(0.75),
      textTransform: 'uppercase',
    },
    filterRow: {
      alignItems: 'center',
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(1),
      paddingBottom: theme.spacing(1.5),
    },
    filterLabel: {
      color: muted,
      fontSize: '0.68rem',
      fontWeight: 700,
      letterSpacing: '0.14em',
      marginRight: theme.spacing(0.5),
      textTransform: 'uppercase',
    },
    toggleBtn: {
      background: 'transparent',
      border: `1px solid ${border}`,
      borderRadius: 0,
      color: dark ? '#9ec5ff' : theme.palette.primary.dark,
      cursor: 'pointer',
      fontFamily: theme.typography.fontFamily,
      fontSize: '0.78rem',
      fontWeight: 700,
      letterSpacing: '0.08em',
      padding: theme.spacing(0.7, 1.5),
      textTransform: 'uppercase',
      '& span': {
        opacity: 0.65,
      },
    },
    toggleBtnActive: {
      backgroundColor: accent,
      borderColor: accent,
      color: theme.palette.common.white,
      '& span': {
        opacity: 0.8,
      },
    },
    toggleBtnViewActive: {
      backgroundColor: dark ? '#1e4f8c' : theme.palette.primary.dark,
      borderColor: dark ? '#1e4f8c' : theme.palette.primary.dark,
      color: theme.palette.common.white,
    },
    actionBar: {
      alignItems: 'center',
      background: dark ? 'rgba(255,255,255,0.03)' : alpha(theme.palette.grey[100], 1),
      borderBottom: `1px solid ${border}`,
      borderTop: `1px solid ${border}`,
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(1.5),
      padding: theme.spacing(1.1, 0),
      rowGap: theme.spacing(0.75),
    },
    actionLink: {
      background: 'none',
      border: 'none',
      borderBottom: '1px solid transparent',
      color: dark ? '#9ec5ff' : theme.palette.primary.dark,
      cursor: 'pointer',
      fontSize: '0.78rem',
      fontWeight: 700,
      letterSpacing: '0.08em',
      padding: 0,
      textTransform: 'uppercase',
      '&:hover': {
        borderBottomColor: dark ? '#9ec5ff' : theme.palette.primary.dark,
      },
    },
    hint: {
      color: muted,
      fontSize: '0.75rem',
    },
    selectedTag: {
      background: alpha(accent, dark ? 0.22 : 0.12),
      border: `1px solid ${alpha(accent, 0.45)}`,
      color: dark ? '#cfe4ff' : theme.palette.primary.dark,
      fontSize: '0.75rem',
      fontWeight: 800,
      letterSpacing: '0.08em',
      padding: theme.spacing(0.4, 1),
      textTransform: 'uppercase',
    },
    listShell: {
      flex: '0 1 auto',
      maxHeight: '42vh',
      overflowX: 'hidden',
      overflowY: 'auto',
    },
    listRow: {
      alignItems: 'center',
      borderBottom: `1px solid ${alpha(border, 0.9)}`,
      cursor: 'pointer',
      display: 'grid',
      gap: theme.spacing(1.5),
      gridTemplateColumns: '28px minmax(0, 1fr) 110px 56px 120px',
      padding: theme.spacing(1, 0.5),
      userSelect: 'none',
      '&:hover': {
        backgroundColor: alpha(accent, 0.04),
      },
    },
    listRowSelected: {
      backgroundColor: alpha(accent, dark ? 0.16 : 0.1),
      '&:hover': {
        backgroundColor: alpha(accent, dark ? 0.2 : 0.14),
      },
    },
    checkbox: {
      alignItems: 'center',
      border: `1px solid ${border}`,
      color: theme.palette.common.white,
      display: 'flex',
      fontSize: '0.75rem',
      fontWeight: 800,
      height: 18,
      justifyContent: 'center',
      lineHeight: 1,
      width: 18,
    },
    checkboxOn: {
      backgroundColor: accent,
      borderColor: accent,
    },
    idText: {
      fontFamily: monospacedFont,
      fontSize: '1.15rem',
      fontWeight: 800,
      lineHeight: 1.1,
    },
    missionText: {
      color: muted,
      fontFamily: monospacedFont,
      fontSize: '0.8rem',
      marginLeft: theme.spacing(1.25),
    },
    statusTag: {
      border: `1px solid ${border}`,
      fontSize: '0.7rem',
      fontWeight: 800,
      justifySelf: 'start',
      letterSpacing: '0.08em',
      padding: theme.spacing(0.35, 0.9),
      textTransform: 'uppercase',
    },
    statusFlying: {
      backgroundColor: alpha(accent, dark ? 0.28 : 0.14),
      borderColor: accent,
      color: dark ? '#cfe4ff' : theme.palette.primary.dark,
    },
    modeText: {
      color: muted,
      fontFamily: monospacedFont,
      fontSize: '0.72rem',
      fontWeight: 700,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
    },
    battWrap: {
      alignItems: 'center',
      display: 'flex',
      gap: theme.spacing(1),
    },
    battTrack: {
      background: dark ? 'rgba(255,255,255,0.08)' : theme.palette.grey[200],
      border: `1px solid ${border}`,
      height: 6,
      width: 52,
    },
    battFill: {
      backgroundColor: accent,
      height: '100%',
    },
    battFillLow: {
      backgroundColor: dark ? '#8a8f98' : theme.palette.grey[500],
    },
    battVolts: {
      color: muted,
      fontFamily: monospacedFont,
      fontSize: '0.8rem',
    },
    grid: {
      boxSizing: 'border-box',
      display: 'grid',
      gap: 6,
      gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
      maxWidth: '100%',
      padding: theme.spacing(1.5, 0),
      width: '100%',
    },
    tile: {
      border: `1px solid ${border}`,
      cursor: 'pointer',
      padding: theme.spacing(0.85, 0.7, 0.7),
      textAlign: 'center',
      userSelect: 'none',
    },
    tileOn: {
      backgroundColor: accent,
      borderColor: accent,
      color: theme.palette.common.white,
    },
    tileId: {
      fontFamily: monospacedFont,
      fontSize: '1.05rem',
      fontWeight: 800,
      lineHeight: 1,
    },
    tileStatus: {
      fontSize: '0.62rem',
      letterSpacing: '0.06em',
      marginTop: 3,
      opacity: 0.75,
      textTransform: 'uppercase',
    },
    tileBatt: {
      background: dark ? 'rgba(255,255,255,0.22)' : theme.palette.grey[300],
      height: 4,
      marginTop: 5,
    },
    emptyHint: {
      color: theme.palette.text.disabled,
      fontSize: '0.9rem',
      padding: theme.spacing(5, 2),
      textAlign: 'center',
    },
    footerSummary: {
      color: muted,
      fontSize: '0.82rem',
      marginRight: theme.spacing(1),
    },
    spacer: {
      flex: 1,
    },
  };
});

const parseNumericId = (uavId) => {
  const match = String(uavId).match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
};

const isFlyingSummary = (summary, uav) => {
  const text = (summary?.text || '').toLowerCase();
  if (text === 'airborne') {
    return true;
  }

  const ahl = uav?.position?.ahl;
  return typeof ahl === 'number' && Math.abs(ahl) >= 0.3;
};

const isLowBattery = (battery) => {
  const percentage = Number(battery?.percentage);
  if (Number.isFinite(percentage)) {
    return percentage < LOW_PERCENTAGE;
  }

  const voltage = Number(battery?.voltage);
  return Number.isFinite(voltage) && voltage > 0 && voltage < LOW_VOLTAGE;
};

const batteryPctWidth = (battery) => {
  const percentage = Number(battery?.percentage);
  if (Number.isFinite(percentage)) {
    return Math.max(6, Math.min(100, Math.round(percentage)));
  }

  const voltage = Number(battery?.voltage);
  if (Number.isFinite(voltage) && voltage > 0) {
    return Math.max(6, Math.min(100, Math.round(((voltage - 10.2) / 3.2) * 100)));
  }

  return 6;
};

const matchQuery = (uavId, missionLabel, summary, query) => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }

  const range = q.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const numeric = parseNumericId(uavId);
    if (!Number.isFinite(numeric)) {
      return false;
    }

    const from = Number(range[1]);
    const to = Number(range[2]);
    return numeric >= Math.min(from, to) && numeric <= Math.max(from, to);
  }

  const status = (summary?.text || '').toLowerCase();
  return (
    String(uavId).toLowerCase().includes(q) ||
    (missionLabel || '').toLowerCase().includes(q) ||
    status.startsWith(q) ||
    status.includes(q)
  );
};

const GroupDroneListRow = ({
  checked,
  classes,
  missionLabel,
  summary,
  uav,
  uavId,
  voltageLabel,
  onToggle,
}) => {
  const flying = isFlyingSummary(summary, uav);
  const low = isLowBattery(summary.batteryStatus);
  const pct = batteryPctWidth(summary.batteryStatus);

  return (
    <div
      className={`${classes.listRow}${checked ? ` ${classes.listRowSelected}` : ''}`}
      onClick={(event) => {
        onToggle(uavId, event);
      }}
    >
      <div className={`${classes.checkbox}${checked ? ` ${classes.checkboxOn}` : ''}`}>
        {checked ? '✓' : ''}
      </div>
      <div>
        <span className={classes.idText}>{uavId}</span>
        {missionLabel ? (
          <span className={classes.missionText}>{missionLabel}</span>
        ) : null}
      </div>
      <span
        className={`${classes.statusTag}${flying ? ` ${classes.statusFlying}` : ''}`}
      >
        {(summary.text || '—').toUpperCase()}
      </span>
      <span className={classes.modeText}>{uav?.mode || '—'}</span>
      <div className={classes.battWrap}>
        <div className={classes.battTrack}>
          <div
            className={`${classes.battFill}${low ? ` ${classes.battFillLow}` : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={classes.battVolts}>{voltageLabel}</span>
      </div>
    </div>
  );
};

GroupDroneListRow.propTypes = {
  checked: PropTypes.bool,
  classes: PropTypes.object,
  missionLabel: PropTypes.string,
  onToggle: PropTypes.func,
  summary: PropTypes.object,
  uav: PropTypes.object,
  uavId: PropTypes.string,
  voltageLabel: PropTypes.string,
};

const GroupDroneTile = ({
  checked,
  classes,
  summary,
  uav,
  uavId,
  onMouseDown,
  onMouseEnter,
}) => {
  const low = isLowBattery(summary.batteryStatus);
  const pct = batteryPctWidth(summary.batteryStatus);

  return (
    <div
      className={`${classes.tile}${checked ? ` ${classes.tileOn}` : ''}`}
      onMouseDown={(event) => {
        onMouseDown(uavId, event);
      }}
      onMouseEnter={() => {
        onMouseEnter(uavId);
      }}
    >
      <div className={classes.tileId}>{uavId}</div>
      <div className={classes.tileStatus}>
        {(summary.text || '—').toUpperCase()}
      </div>
      <div className={classes.tileBatt}>
        <div
          className={`${classes.battFill}${low ? ` ${classes.battFillLow}` : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

GroupDroneTile.propTypes = {
  checked: PropTypes.bool,
  classes: PropTypes.object,
  onMouseDown: PropTypes.func,
  onMouseEnter: PropTypes.func,
  summary: PropTypes.object,
  uav: PropTypes.object,
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
  reverseMissionMapping,
  uavIdsAlreadyInGroups,
  uavsById,
  uavIds,
}) => {
  const classes = useStyles();
  const { t } = useTranslation();
  const isEditing = Boolean(editedGroup);

  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(FILTER_ALL);
  const [view, setView] = useState(VIEW_GRID);
  const [lastClickedId, setLastClickedId] = useState(null);
  const dragRef = useRef({ dragging: false, dragTo: true });

  const selectableUavIds = useMemo(() => {
    if (isEditing && editedGroup) {
      const currentMembers = new Set(editedGroup.uavIds);
      return uavIds.filter(
        (id) => currentMembers.has(id) || !uavIdsAlreadyInGroups.has(id)
      );
    }

    return uavIds.filter((id) => !uavIdsAlreadyInGroups.has(id));
  }, [editedGroup, isEditing, uavIds, uavIdsAlreadyInGroups]);

  const droneMeta = useMemo(() => {
    return selectableUavIds.map((uavId) => {
      const uav = uavsById[uavId];
      const summary = getSingleUAVStatusSummary(uav);
      const missionIndex = reverseMissionMapping?.[uavId];
      const missionLabel =
        typeof missionIndex === 'number' ? formatMissionId(missionIndex) : '';
      return { uavId, uav, summary, missionLabel };
    });
  }, [selectableUavIds, uavsById, reverseMissionMapping]);

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

    setQuery('');
    setFilter(FILTER_ALL);
    setView(VIEW_GRID);
    setLastClickedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [open, editedGroup, defaultGroupName]);

  useEffect(() => {
    const onUp = () => {
      dragRef.current.dragging = false;
    };

    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const counts = useMemo(() => {
    let flying = 0;
    let ground = 0;
    let low = 0;
    for (const item of droneMeta) {
      if (isFlyingSummary(item.summary, item.uav)) {
        flying += 1;
      } else {
        ground += 1;
      }

      if (isLowBattery(item.summary.batteryStatus)) {
        low += 1;
      }
    }

    return {
      all: droneMeta.length,
      flying,
      ground,
      low,
      selected: selectedIds.length,
    };
  }, [droneMeta, selectedIds.length]);

  const visibleDrones = useMemo(() => {
    return droneMeta.filter(({ uavId, uav, summary, missionLabel }) => {
      if (!matchQuery(uavId, missionLabel, summary, query)) {
        return false;
      }

      switch (filter) {
        case FILTER_FLYING:
          return isFlyingSummary(summary, uav);
        case FILTER_GROUND:
          return !isFlyingSummary(summary, uav);
        case FILTER_LOW:
          return isLowBattery(summary.batteryStatus);
        case FILTER_SELECTED:
          return selectedSet.has(uavId);
        default:
          return true;
      }
    });
  }, [droneMeta, filter, query, selectedSet]);

  const orderedSelectedIds = useMemo(
    () => selectableUavIds.filter((id) => selectedSet.has(id)),
    [selectableUavIds, selectedSet]
  );

  const canSave = name.trim().length > 0 && orderedSelectedIds.length > 0;

  const setMany = useCallback((ids, on) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }

      return selectableUavIds.filter((id) => next.has(id));
    });
  }, [selectableUavIds]);

  const handleToggle = useCallback(
    (uavId, event) => {
      const visibleIds = visibleDrones.map((item) => item.uavId);
      const turningOn = !selectedSet.has(uavId);

      if (event?.shiftKey && lastClickedId != null) {
        const a = visibleIds.indexOf(lastClickedId);
        const b = visibleIds.indexOf(uavId);
        if (a >= 0 && b >= 0) {
          const from = Math.min(a, b);
          const to = Math.max(a, b);
          setMany(visibleIds.slice(from, to + 1), true);
          setLastClickedId(uavId);
          return;
        }
      }

      setMany([uavId], turningOn);
      setLastClickedId(uavId);
    },
    [lastClickedId, selectedSet, setMany, visibleDrones]
  );

  const handleTileMouseDown = useCallback(
    (uavId, event) => {
      event.preventDefault();
      const turningOn = !selectedSet.has(uavId);
      dragRef.current = { dragging: true, dragTo: turningOn };
      handleToggle(uavId, event);
    },
    [handleToggle, selectedSet]
  );

  const handleTileMouseEnter = useCallback(
    (uavId) => {
      if (!dragRef.current.dragging) {
        return;
      }

      setMany([uavId], dragRef.current.dragTo);
    },
    [setMany]
  );

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

  const filterButtons = [
    { key: FILTER_ALL, label: t('droneGroups.filterAll'), count: counts.all },
    {
      key: FILTER_FLYING,
      label: t('droneGroups.filterFlying'),
      count: counts.flying,
    },
    {
      key: FILTER_GROUND,
      label: t('droneGroups.filterGround'),
      count: counts.ground,
    },
    { key: FILTER_LOW, label: t('droneGroups.filterLowBatt'), count: counts.low },
    {
      key: FILTER_SELECTED,
      label: t('droneGroups.filterSelected'),
      count: counts.selected,
    },
  ];

  const formatVoltage = (battery) => {
    const voltage = Number(battery?.voltage);
    if (Number.isFinite(voltage) && voltage > 0) {
      return `${voltage.toFixed(1)}V`;
    }

    const percentage = Number(battery?.percentage);
    if (Number.isFinite(percentage)) {
      return `${Math.round(percentage)}%`;
    }

    return '—';
  };

  return (
    <DraggableDialog
      fullWidth
      open={open}
      maxWidth='md'
      title={
        isEditing
          ? t('droneGroups.editTitle')
          : t('droneGroups.createTitle')
      }
      titleComponents={
        <Typography className={classes.headerMeta} component='span'>
          {t('droneGroups.fleetUnits', { count: selectableUavIds.length })}
        </Typography>
      }
      onClose={onClose}
    >
      <DialogContent className={classes.content}>
        <Box className={classes.fieldsRow}>
          <div>
            <label className={classes.fieldLabel} htmlFor='drone-group-name'>
              {t('droneGroups.name')}
            </label>
            <TextField
              autoFocus={!optimizeUIForTouch}
              fullWidth
              id='drone-group-name'
              size='small'
              value={name}
              placeholder='group1'
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
          </div>
          <div>
            <label className={classes.fieldLabel} htmlFor='drone-group-search'>
              {t('droneGroups.searchLabel')}
            </label>
            <TextField
              fullWidth
              id='drone-group-search'
              size='small'
              value={query}
              placeholder={t('droneGroups.searchPlaceholder')}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
        </Box>

        <Box className={classes.filterRow}>
          <span className={classes.filterLabel}>{t('droneGroups.filter')}</span>
          {filterButtons.map((button) => (
            <button
              key={button.key}
              type='button'
              className={`${classes.toggleBtn}${
                filter === button.key ? ` ${classes.toggleBtnActive}` : ''
              }`}
              onClick={() => {
                setFilter(button.key);
              }}
            >
              {button.label} <span>({button.count})</span>
            </button>
          ))}
          <Box className={classes.spacer} />
          {[
            { key: VIEW_LIST, label: t('droneGroups.viewList') },
            { key: VIEW_GRID, label: t('droneGroups.viewGrid') },
          ].map((button) => (
            <button
              key={button.key}
              type='button'
              className={`${classes.toggleBtn}${
                view === button.key ? ` ${classes.toggleBtnViewActive}` : ''
              }`}
              onClick={() => {
                setView(button.key);
              }}
            >
              {button.label}
            </button>
          ))}
        </Box>

        <Box className={classes.actionBar}>
          <button
            type='button'
            className={classes.actionLink}
            onClick={() => {
              setMany(selectableUavIds, true);
            }}
          >
            {t('droneGroups.selectAllCount', { count: selectableUavIds.length })}
          </button>
          <button
            type='button'
            className={classes.actionLink}
            onClick={() => {
              setMany(
                visibleDrones.map((item) => item.uavId),
                true
              );
            }}
          >
            {t('droneGroups.selectShown', { count: visibleDrones.length })}
          </button>
          <button
            type='button'
            className={classes.actionLink}
            onClick={() => {
              setMany(
                visibleDrones.map((item) => item.uavId),
                false
              );
            }}
          >
            {t('droneGroups.deselectShown')}
          </button>
          <button
            type='button'
            className={classes.actionLink}
            onClick={() => {
              const visibleIds = visibleDrones.map((item) => item.uavId);
              setSelectedIds((prev) => {
                const next = new Set(prev);
                for (const id of visibleIds) {
                  if (next.has(id)) {
                    next.delete(id);
                  } else {
                    next.add(id);
                  }
                }

                return selectableUavIds.filter((id) => next.has(id));
              });
            }}
          >
            {t('droneGroups.invertShown')}
          </button>
          <button
            type='button'
            className={classes.actionLink}
            onClick={() => {
              setSelectedIds([]);
            }}
          >
            {t('droneGroups.clearAll')}
          </button>
          <Box className={classes.spacer} />
          <span className={classes.hint}>{t('droneGroups.selectionHint')}</span>
          <span className={classes.selectedTag}>
            {t('droneGroups.selectedDrones', { count: orderedSelectedIds.length })}
          </span>
        </Box>

        <Box className={classes.listShell}>
          {visibleDrones.length === 0 ? (
            <Typography className={classes.emptyHint}>
              {selectableUavIds.length === 0
                ? t('droneGroups.noDronesAvailable')
                : t('droneGroups.noSearchResults')}
            </Typography>
          ) : view === VIEW_LIST ? (
            visibleDrones.map(({ uavId, uav, summary, missionLabel }) => (
              <GroupDroneListRow
                key={uavId}
                checked={selectedSet.has(uavId)}
                classes={classes}
                missionLabel={missionLabel}
                summary={summary}
                uav={uav}
                uavId={uavId}
                voltageLabel={formatVoltage(summary.batteryStatus)}
                onToggle={handleToggle}
              />
            ))
          ) : (
            <div className={classes.grid}>
              {visibleDrones.map(({ uavId, uav, summary }) => (
                <GroupDroneTile
                  key={uavId}
                  checked={selectedSet.has(uavId)}
                  classes={classes}
                  summary={summary}
                  uav={uav}
                  uavId={uavId}
                  onMouseDown={handleTileMouseDown}
                  onMouseEnter={handleTileMouseEnter}
                />
              ))}
            </div>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        {isEditing && (
          <Button color='error' onClick={handleDelete}>
            {t('droneGroups.delete')}
          </Button>
        )}
        <Box className={classes.spacer} />
        <Typography className={classes.footerSummary} component='span'>
          {t('droneGroups.summary', {
            selected: orderedSelectedIds.length,
            total: selectableUavIds.length,
          })}
        </Typography>
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
  reverseMissionMapping: PropTypes.object,
  uavIds: PropTypes.arrayOf(PropTypes.string),
  uavIdsAlreadyInGroups: PropTypes.instanceOf(Set),
  uavsById: PropTypes.object,
};

export default connect(
  (state) => ({
    defaultGroupName: getNextDefaultNamedUAVGroupName(state),
    editedGroup: getEditedNamedUAVGroup(state),
    initialSelectedIds: getSelectedUAVIds(state),
    open: isNamedUAVGroupDialogOpen(state),
    optimizeUIForTouch: shouldOptimizeUIForTouch(state),
    reverseMissionMapping: getReverseMissionMapping(state),
    uavIds: getAllUAVIdList(state),
    uavIdsAlreadyInGroups: getUAVIdsAssignedToAnyNamedGroup(state),
    uavsById: getUAVIdToStateMapping(state),
  }),
  {
    onClose: closeNamedUAVGroupDialog,
    onDelete: removeNamedUAVGroup,
    onSave: saveNamedUAVGroup,
  }
)(NamedUAVGroupEditorDialog);
