import Clear from '@mui/icons-material/Clear';
import Error from '@mui/icons-material/Error';
import Refresh from '@mui/icons-material/Refresh';
import SyncAlt from '@mui/icons-material/SyncAlt';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import PropTypes from 'prop-types';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { TableVirtuoso } from 'react-virtuoso';
import { useAsyncRetry } from 'react-use';

import { makeStyles } from '@skybrush/app-theme-mui';
import {
  BackgroundHint,
  LargeProgressIndicator,
  Tooltip,
} from '@skybrush/mui-components';

import { showError, showSuccess } from '~/features/snackbar/actions';
import {
  getSingleUAVStatusSummary,
  getUAVIdList,
  getUAVIdToStateMapping,
} from '~/features/uavs/selectors';
import useMessageHub from '~/hooks/useMessageHub';
import {
  buildComparedParameters,
  coerceParameterValue,
  formatParameterValue,
  getParameters,
  getParametersForUav,
  parameterValuesEqual,
} from '~/utils/mavlinkParameters';

const ALL_GROUP = 'ALL';
const FILTER_ALL = 'all';
const FILTER_DIFF = 'diff';
const FILTER_MOD = 'mod';

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    gap: theme.spacing(1.5),
    height: 560,
    minHeight: 420,
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    flex: 'none',
    gap: theme.spacing(1.25),
    width: 240,
    overflowY: 'auto',
    borderRight: `1px solid ${theme.palette.divider}`,
    paddingRight: theme.spacing(1),
  },
  sidebarHeader: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(0.25),
  },
  sidebarTitle: {
    color: theme.palette.text.secondary,
    fontSize: '0.65rem',
    fontWeight: theme.typography.fontWeightMedium,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  vehicleItem: {
    alignItems: 'center',
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    marginBottom: 3,
    minHeight: 0,
    padding: '2px 6px',
  },
  vehicleItemSelected: {
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
    borderColor: alpha(theme.palette.primary.main, 0.45),
  },
  vehicleMeta: {
    color: theme.palette.text.secondary,
    fontFamily: 'monospace',
    fontSize: '0.65rem',
    lineHeight: 1.2,
  },
  vehicleId: {
    fontSize: '0.8rem',
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.2,
  },
  groupItem: {
    borderLeft: '2px solid transparent',
    borderRadius: 0,
    minHeight: 32,
    paddingBottom: 2,
    paddingTop: 2,
  },
  groupItemSelected: {
    backgroundColor: alpha(theme.palette.primary.main, 0.12),
    borderLeftColor: theme.palette.primary.main,
  },
  main: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    minWidth: 0,
  },
  toolbar: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1.5),
    paddingBottom: theme.spacing(1.5),
  },
  search: {
    minWidth: 220,
    width: 280,
  },
  pendingActions: {
    alignItems: 'center',
    display: 'flex',
    gap: theme.spacing(1),
    marginLeft: 'auto',
  },
  pendingLabel: {
    color: theme.palette.warning.main,
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    fontWeight: theme.typography.fontWeightMedium,
  },
  tableContainer: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    flex: 1,
    minHeight: 0,
  },
  headCell: {
    backgroundColor: theme.palette.background.paper,
    fontSize: '0.7rem',
    fontWeight: theme.typography.fontWeightMedium,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  // Opaque tint so sticky headers don't show scrolling rows underneath.
  refHead: {
    backgroundColor: theme.palette.background.paper,
    backgroundImage: `linear-gradient(${alpha(
      theme.palette.primary.main,
      0.14
    )}, ${alpha(theme.palette.primary.main, 0.14)})`,
  },
  mono: {
    fontFamily: 'monospace',
  },
  nameCell: {
    alignItems: 'center',
    display: 'flex',
    gap: theme.spacing(1),
    minWidth: 0,
  },
  groupLabel: {
    color: theme.palette.text.secondary,
    fontSize: '0.7rem',
    marginLeft: 'auto',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  mismatchMark: {
    color: theme.palette.warning.main,
    flex: 'none',
    fontWeight: theme.typography.fontWeightBold,
    width: 12,
  },
  mismatchRow: {
    backgroundColor: alpha(theme.palette.warning.main, 0.06),
  },
  mismatchCell: {
    backgroundColor: alpha(theme.palette.warning.main, 0.1),
  },
  editedCell: {
    backgroundColor: alpha(theme.palette.primary.main, 0.16),
  },
  editedValue: {
    color: theme.palette.primary.dark,
    fontWeight: theme.typography.fontWeightMedium,
  },
  missingValue: {
    color: theme.palette.text.disabled,
  },
  editDot: {
    backgroundColor: theme.palette.primary.main,
    borderRadius: '50%',
    display: 'inline-block',
    height: 6,
    marginLeft: theme.spacing(0.75),
    width: 6,
  },
  valueCell: {
    cursor: 'text',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
  },
  valueCellDisabled: {
    cursor: 'default',
  },
  footer: {
    alignItems: 'center',
    color: theme.palette.text.secondary,
    display: 'flex',
    flexWrap: 'wrap',
    fontFamily: 'monospace',
    fontSize: '0.85rem',
    gap: theme.spacing(1.5),
    paddingTop: theme.spacing(1),
  },
  legendSwatch: {
    border: `1px solid ${alpha(theme.palette.warning.main, 0.5)}`,
    display: 'inline-block',
    height: 11,
    marginRight: 6,
    verticalAlign: 'middle',
    width: 11,
  },
  legendEdit: {
    backgroundColor: theme.palette.primary.main,
    display: 'inline-block',
    height: 11,
    marginRight: 6,
    verticalAlign: 'middle',
    width: 11,
  },
  checkboxDense: {
    marginLeft: -10,
    padding: 2,
  },
  setRefChip: {
    cursor: 'pointer',
    fontSize: '0.6rem',
    height: 16,
    '& .MuiChip-label': {
      paddingLeft: 6,
      paddingRight: 6,
    },
  },
}));

const VirtuosoTableComponents = {
  Scroller: React.forwardRef(function Scroller(props, ref) {
    return <TableContainer {...props} ref={ref} />;
  }),
  Table: (props) => (
    <Table {...props} stickyHeader size='small' style={{ tableLayout: 'fixed' }} />
  ),
  TableHead: React.forwardRef(function Head(props, ref) {
    return <TableHead {...props} ref={ref} />;
  }),
  TableBody: React.forwardRef(function Body(props, ref) {
    return <TableBody {...props} ref={ref} />;
  }),
  TableRow,
};

VirtuosoTableComponents.Scroller.displayName = 'VirtuosoScroller';
VirtuosoTableComponents.TableHead.displayName = 'VirtuosoTableHead';
VirtuosoTableComponents.TableBody.displayName = 'VirtuosoTableBody';

const editKey = (uavId, name) => `${uavId}|${name}`;

/**
 * Panel that loads, compares and edits FC parameters across multiple UAVs.
 */
const ParameterViewerPanel = ({ defaultSelectedUavIds }) => {
  const classes = useStyles();
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const messageHub = useMessageHub();

  const allUavIds = useSelector(getUAVIdList);
  const uavsById = useSelector(getUAVIdToStateMapping);

  // 맵에서 고른 기체가 없으면 전체부터 시작 (한 대만 골라야 파라미터가 일부만 보이는 혼란 방지)
  const [selectedIds, setSelectedIds] = useState(() =>
    (defaultSelectedUavIds?.length
      ? defaultSelectedUavIds
      : allUavIds
    ).filter((id) => allUavIds.includes(id))
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(FILTER_ALL);
  const [group, setGroup] = useState(ALL_GROUP);
  const [edits, setEdits] = useState({});
  const [editingKey, setEditingKey] = useState(null);
  const [writing, setWriting] = useState(false);
  /** 사용자가 직접 지정한 REF; 선택 해제되면 자동 폴백 */
  const [manualReferenceId, setManualReferenceId] = useState(null);

  useEffect(() => {
    setSelectedIds((prev) => {
      const stillPresent = prev.filter((id) => allUavIds.includes(id));
      if (stillPresent.length > 0) {
        return stillPresent;
      }

      const fallback = (defaultSelectedUavIds || []).filter((id) =>
        allUavIds.includes(id)
      );
      if (fallback.length > 0) {
        return fallback;
      }

      return [...allUavIds];
    });
  }, [allUavIds, defaultSelectedUavIds]);

  const selectedInListOrder = useMemo(
    () => allUavIds.filter((id) => selectedIds.includes(id)),
    [allUavIds, selectedIds]
  );

  const selectedKey = selectedInListOrder.join('|');

  useEffect(() => {
    setEdits({});
    setEditingKey(null);
  }, [selectedKey]);

  const state = useAsyncRetry(async () => {
    if (selectedInListOrder.length === 0) {
      return { rows: [], skipped: [], errors: [], counts: {} };
    }

    const body = await getParameters(selectedInListOrder);
    const rows = buildComparedParameters(body, selectedInListOrder);
    const skipped = (body.skipped || []).map(String);
    const counts = {};
    for (const uavId of selectedInListOrder) {
      counts[uavId] = getParametersForUav(body, uavId).length;
    }

    return {
      rows,
      skipped,
      errors: Array.isArray(body.errors) ? body.errors : [],
      counts,
    };
  }, [selectedKey]);

  const comparedRows = state.value?.rows ?? [];
  const fetchCounts = state.value?.counts ?? {};
  const fetchSkipped = state.value?.skipped ?? [];

  // REF: 수동 지정 우선, 없거나 선택 해제면 로드된 기체 → 첫 선택
  const referenceId = useMemo(() => {
    if (selectedInListOrder.length === 0) {
      return undefined;
    }

    if (manualReferenceId && selectedInListOrder.includes(manualReferenceId)) {
      return manualReferenceId;
    }

    const withParams = selectedInListOrder.find(
      (id) => (fetchCounts[id] ?? 0) > 0
    );
    return withParams || selectedInListOrder[0];
  }, [fetchCounts, manualReferenceId, selectedInListOrder]);

  // 테이블 열: REF를 맨 앞에
  const orderedSelectedIds = useMemo(() => {
    if (!referenceId || !selectedInListOrder.includes(referenceId)) {
      return selectedInListOrder;
    }

    return [
      referenceId,
      ...selectedInListOrder.filter((id) => id !== referenceId),
    ];
  }, [referenceId, selectedInListOrder]);

  const emptySelectedIds = useMemo(
    () =>
      orderedSelectedIds.filter(
        (id) =>
          !state.loading &&
          !state.error &&
          state.value &&
          (fetchCounts[id] ?? 0) === 0
      ),
    [fetchCounts, orderedSelectedIds, state.error, state.loading, state.value]
  );

  const getBaseValue = useCallback(
    (uavId, name) => {
      const row = comparedRows.find((item) => item.name === name);
      return row?.values?.[uavId];
    },
    [comparedRows]
  );

  const setAsReference = useCallback((uavId) => {
    setManualReferenceId(uavId);
    setSelectedIds((prev) =>
      prev.includes(uavId) ? prev : [...prev, uavId]
    );
    setEditingKey(null);
  }, []);

  const rows = useMemo(() => {
    const items = comparedRows;

    return items.map((item) => {
      const cells = orderedSelectedIds.map((uavId) => {
        const base = item.values[uavId];
        const present = base !== undefined && base !== null;
        const key = editKey(uavId, item.name);
        const hasEdit = Object.prototype.hasOwnProperty.call(edits, key);
        const value = hasEdit ? edits[key] : base;
        const edited =
          present &&
          hasEdit &&
          !parameterValuesEqual(edits[key], base);
        return { uavId, present, value, edited, key };
      });

      const comparable = cells
        .filter((cell) => cell.present)
        .map((cell) =>
          cell.value === undefined || cell.value === null
            ? '\u2014'
            : String(cell.value)
        );
      const unique = new Set(
        comparable.map((value) => {
          const asNumber = Number(value);
          return Number.isNaN(asNumber) || value.trim() === ''
            ? value
            : String(asNumber);
        })
      );
      const diff = orderedSelectedIds.length > 1 && unique.size > 1;
      const edited = cells.some((cell) => cell.edited);

      return { ...item, cells, diff, edited };
    });
  }, [edits, orderedSelectedIds, comparedRows]);

  const queryMatched = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (!needle) {
      return rows;
    }

    return rows.filter((row) => row.name.toUpperCase().includes(needle));
  }, [query, rows]);

  const counts = useMemo(
    () => ({
      all: queryMatched.length,
      diff: queryMatched.filter((row) => row.diff).length,
      mod: queryMatched.filter((row) => row.edited).length,
    }),
    [queryMatched]
  );

  const groups = useMemo(() => {
    const names = Array.from(
      new Set(queryMatched.map((row) => row.group).filter(Boolean))
    ).sort();
    return [ALL_GROUP, ...names];
  }, [queryMatched]);

  const visible = useMemo(() => {
    return queryMatched.filter((row) => {
      if (group !== ALL_GROUP && row.group !== group) {
        return false;
      }

      if (filter === FILTER_DIFF) {
        return row.diff;
      }

      if (filter === FILTER_MOD) {
        return row.edited;
      }

      return true;
    });
  }, [filter, group, queryMatched]);

  const pendingEntries = useMemo(() => {
    return Object.entries(edits).filter(([key, draft]) => {
      const [uavId, name] = key.split('|');
      const base = getBaseValue(uavId, name);
      if (base === undefined || base === null) {
        return false;
      }

      return !parameterValuesEqual(draft, base);
    });
  }, [edits, getBaseValue]);

  const pendingCount = pendingEntries.length;

  const vehicleSummaries = useMemo(() => {
    return allUavIds.map((uavId) => {
      const uav = uavsById[uavId];
      const summary = getSingleUAVStatusSummary(uav);
      const voltage = uav?.battery?.voltage;
      return {
        id: uavId,
        status: summary?.text || '—',
        voltage:
          typeof voltage === 'number' && Number.isFinite(voltage)
            ? voltage.toFixed(1)
            : '—',
      };
    });
  }, [allUavIds, uavsById]);

  const toggleVehicle = useCallback((uavId) => {
    setSelectedIds((prev) => {
      if (prev.includes(uavId)) {
        return prev.length > 1 ? prev.filter((id) => id !== uavId) : prev;
      }

      return [...prev, uavId];
    });
    setEditingKey(null);
  }, []);

  const onSelectAllOrReference = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.length === allUavIds.length && allUavIds.length > 0) {
        const keep =
          (manualReferenceId && prev.includes(manualReferenceId)
            ? manualReferenceId
            : null) ||
          referenceId ||
          prev[0] ||
          allUavIds[0];
        return [keep];
      }

      return [...allUavIds];
    });
    setEditingKey(null);
  }, [allUavIds, manualReferenceId, referenceId]);

  const commitDraft = useCallback((key, draft, base) => {
    setEdits((prev) => {
      const next = { ...prev };
      if (parameterValuesEqual(draft, base)) {
        delete next[key];
      } else {
        next[key] = draft;
      }

      return next;
    });
    setEditingKey(null);
  }, []);

  const cancelEdit = useCallback((key) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setEditingKey(null);
  }, []);

  const matchToReference = useCallback(
    (row) => {
      if (!referenceId) {
        return;
      }

      const refCell = row.cells.find((cell) => cell.uavId === referenceId);
      if (!refCell?.present) {
        return;
      }

      setEdits((prev) => {
        const next = { ...prev };
        for (const cell of row.cells) {
          if (cell.uavId === referenceId || !cell.present) {
            continue;
          }

          const base = getBaseValue(cell.uavId, row.name);
          if (parameterValuesEqual(refCell.value, base)) {
            delete next[cell.key];
          } else {
            next[cell.key] = formatParameterValue(refCell.value);
          }
        }

        return next;
      });
      setEditingKey(null);
      dispatch(
        showSuccess(
          t('parameterViewerDialog.matchedToast', {
            name: row.name,
            uavId: referenceId,
          })
        )
      );
    },
    [dispatch, getBaseValue, referenceId, t]
  );

  const onRevert = useCallback(() => {
    setEdits({});
    setEditingKey(null);
    dispatch(showSuccess(t('parameterViewerDialog.revertedToast')));
  }, [dispatch, t]);

  const onWrite = useCallback(async () => {
    if (pendingEntries.length === 0 || writing) {
      return;
    }

    setWriting(true);
    try {
      const byUav = new Map();
      for (const [key, draft] of pendingEntries) {
        const [uavId, name] = key.split('|');
        const base = getBaseValue(uavId, name);
        const value = coerceParameterValue(String(draft), base);
        if (!byUav.has(uavId)) {
          byUav.set(uavId, {});
        }

        byUav.get(uavId)[name] = value;
      }

      for (const [uavId, parameters] of byUav.entries()) {
        if (messageHub.execute.setParameters) {
          await messageHub.execute.setParameters({ uavId, parameters });
        } else {
          for (const [name, value] of Object.entries(parameters)) {
            await messageHub.execute.setParameter({ uavId, name, value });
          }
        }
      }

      const count = pendingEntries.length;
      setEdits({});
      setEditingKey(null);
      dispatch(
        showSuccess(
          t('parameterViewerDialog.wroteToast', { count })
        )
      );
      state.retry();
    } catch (error) {
      dispatch(
        showError(
          error?.message || t('parameterViewerDialog.writeFailed')
        )
      );
    } finally {
      setWriting(false);
    }
  }, [
    dispatch,
    getBaseValue,
    messageHub,
    pendingEntries,
    state,
    t,
    writing,
  ]);

  const nameColumnWidth = 220;
  const typeColumnWidth = 72;
  const defaultColumnWidth = 88;
  const syncColumnWidth = 96;
  const vehicleColumnWidth = Math.max(
    120,
    Math.min(180, Math.floor(520 / Math.max(orderedSelectedIds.length, 1)))
  );

  const fixedHeaderContent = () => (
    <TableRow>
      <TableCell
        className={classes.headCell}
        style={{ width: nameColumnWidth }}
      >
        {t('parameterViewerDialog.columnName')}
      </TableCell>
      <TableCell
        className={classes.headCell}
        style={{ width: typeColumnWidth }}
      >
        {t('parameterViewerDialog.columnType')}
      </TableCell>
      <TableCell
        className={classes.headCell}
        align='right'
        style={{ width: defaultColumnWidth }}
      >
        {t('parameterViewerDialog.columnDefault')}
      </TableCell>
      {orderedSelectedIds.map((uavId) => {
        const summary = vehicleSummaries.find((item) => item.id === uavId);
        const isRef = uavId === referenceId;
        return (
          <TableCell
            key={uavId}
            className={`${classes.headCell} ${isRef ? classes.refHead : ''}`}
            align='right'
            style={{ width: vehicleColumnWidth }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 0.5,
                justifyContent: 'flex-end',
              }}
            >
              <Typography variant='body2' component='span' fontWeight={600}>
                {uavId}
              </Typography>
              {isRef ? (
                <Chip
                  size='small'
                  label={t('parameterViewerDialog.ref')}
                  color='primary'
                  sx={{ height: 18, fontSize: '0.65rem' }}
                />
              ) : null}
            </Box>
            <Typography className={classes.vehicleMeta} component='div'>
              {summary?.voltage}V · {summary?.status}
            </Typography>
          </TableCell>
        );
      })}
      <TableCell
        className={classes.headCell}
        align='center'
        style={{ width: syncColumnWidth }}
      >
        {t('parameterViewerDialog.columnSync')}
      </TableCell>
    </TableRow>
  );

  const itemContent = (_index, row) => (
    <>
      <TableCell className={row.diff ? classes.mismatchRow : undefined}>
        <div className={classes.nameCell}>
          <span className={classes.mismatchMark}>{row.diff ? '\u0394' : ''}</span>
          <Typography className={classes.mono} noWrap variant='body2'>
            {row.name}
          </Typography>
          <span className={classes.groupLabel}>{row.group}</span>
        </div>
      </TableCell>
      <TableCell className={classes.mono}>{row.type}</TableCell>
      <TableCell className={classes.mono} align='right'>
        {formatParameterValue(row.default)}
      </TableCell>
      {row.cells.map((cell) => {
        const editing = editingKey === cell.key;
        const cellClass = [
          classes.valueCell,
          !cell.present ? classes.valueCellDisabled : '',
          cell.edited ? classes.editedCell : row.diff ? classes.mismatchCell : '',
        ]
          .filter(Boolean)
          .join(' ');

        if (editing) {
          return (
            <TableCell key={cell.key} className={cellClass} align='right'>
              <TextField
                key={cell.key}
                autoFocus
                size='small'
                variant='standard'
                fullWidth
                defaultValue={formatParameterValue(cell.value)}
                inputProps={{
                  style: { fontFamily: 'monospace', textAlign: 'right' },
                }}
                onBlur={(event) => {
                  commitDraft(
                    cell.key,
                    event.target.value,
                    getBaseValue(cell.uavId, row.name)
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitDraft(
                      cell.key,
                      event.target.value,
                      getBaseValue(cell.uavId, row.name)
                    );
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelEdit(cell.key);
                  }
                }}
              />
            </TableCell>
          );
        }

        return (
          <TableCell
            key={cell.key}
            className={cellClass}
            align='right'
            onClick={() => {
              if (cell.present) {
                setEditingKey(cell.key);
              }
            }}
          >
            <span
              className={
                !cell.present
                  ? classes.missingValue
                  : cell.edited
                    ? classes.editedValue
                    : undefined
              }
            >
              {cell.present ? formatParameterValue(cell.value) : '\u2014'}
            </span>
            {cell.edited ? <span className={classes.editDot} /> : null}
          </TableCell>
        );
      })}
      <TableCell align='center'>
        {row.diff ? (
          <Tooltip content={t('parameterViewerDialog.matchTooltip')}>
            <Button
              size='small'
              startIcon={<SyncAlt fontSize='small' />}
              onClick={() => matchToReference(row)}
            >
              {t('parameterViewerDialog.match')}
            </Button>
          </Tooltip>
        ) : null}
      </TableCell>
    </>
  );

  let body = null;

  if (allUavIds.length === 0) {
    body = <BackgroundHint text={t('parameterViewerDialog.noUavs')} />;
  } else if (orderedSelectedIds.length === 0) {
    body = <BackgroundHint text={t('parameterViewerDialog.selectUav')} />;
  } else if (state.loading) {
    body = (
      <LargeProgressIndicator
        fullHeight
        label={t('parameterViewerDialog.loading')}
      />
    );
  } else if (state.error) {
    body = (
      <BackgroundHint
        icon={<Error />}
        text={state.error.message || t('parameterViewerDialog.loadFailed')}
        button={
          <Button onClick={state.retry}>
            {t('parameterViewerDialog.retry')}
          </Button>
        }
      />
    );
  } else if (visible.length === 0) {
    body = (
      <BackgroundHint
        text={
          comparedRows.length === 0
            ? t('parameterViewerDialog.empty')
            : t('parameterViewerDialog.noMatches')
        }
      />
    );
  } else {
    body = (
      <TableVirtuoso
        className={classes.tableContainer}
        style={{ height: '100%' }}
        data={visible}
        components={VirtuosoTableComponents}
        fixedHeaderContent={fixedHeaderContent}
        itemContent={itemContent}
        increaseViewportBy={200}
      />
    );
  }

  return (
    <Box className={classes.root}>
      <Box className={classes.sidebar}>
        <Box>
          <Box className={classes.sidebarHeader}>
            <Typography className={classes.sidebarTitle}>
              {t('parameterViewerDialog.vehicles')}
            </Typography>
            <Button size='small' onClick={onSelectAllOrReference}>
              {selectedIds.length === allUavIds.length && allUavIds.length > 0
                ? t('parameterViewerDialog.referenceOnly')
                : t('parameterViewerDialog.selectAll')}
            </Button>
          </Box>
          <List dense disablePadding>
            {vehicleSummaries.map((vehicle) => {
              const selected = selectedIds.includes(vehicle.id);
              const isRef = selected && vehicle.id === referenceId;
              const paramCount = selected ? fetchCounts[vehicle.id] : undefined;
              const loadFailed =
                selected &&
                !state.loading &&
                state.value &&
                ((paramCount ?? 0) === 0 ||
                  fetchSkipped.includes(String(vehicle.id)));
              return (
                <ListItemButton
                  key={vehicle.id}
                  className={`${classes.vehicleItem} ${
                    selected ? classes.vehicleItemSelected : ''
                  }`}
                  onClick={() => toggleVehicle(vehicle.id)}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Checkbox
                      className={classes.checkboxDense}
                      edge='start'
                      size='small'
                      checked={selected}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <ListItemText
                    sx={{ my: 0 }}
                    primary={
                      <Box
                        sx={{
                          alignItems: 'center',
                          display: 'flex',
                          gap: 0.5,
                          minWidth: 0,
                        }}
                      >
                        <Typography
                          className={classes.vehicleId}
                          component='span'
                          noWrap
                        >
                          {vehicle.id}
                        </Typography>
                        {isRef ? (
                          <Chip
                            size='small'
                            label={t('parameterViewerDialog.ref')}
                            color='primary'
                            className={classes.setRefChip}
                          />
                        ) : (
                          <Tooltip content={t('parameterViewerDialog.setReference')}>
                            <Chip
                              size='small'
                              variant='outlined'
                              label={t('parameterViewerDialog.ref')}
                              className={classes.setRefChip}
                              onClick={(event) => {
                                event.stopPropagation();
                                setAsReference(vehicle.id);
                              }}
                              sx={{
                                borderColor: alpha('#1976d2', 0.35),
                                color: 'text.secondary',
                                opacity: selected ? 1 : 0.7,
                              }}
                            />
                          </Tooltip>
                        )}
                        {loadFailed ? (
                          <Chip
                            size='small'
                            label={t('parameterViewerDialog.loadEmpty')}
                            color='warning'
                            variant='outlined'
                            className={classes.setRefChip}
                          />
                        ) : null}
                      </Box>
                    }
                    secondary={
                      selected && paramCount !== undefined && !state.loading
                        ? t('parameterViewerDialog.vehicleMetaLoaded', {
                            count: paramCount,
                            voltage: vehicle.voltage,
                            status: vehicle.status,
                          })
                        : `${vehicle.voltage}V · ${vehicle.status}`
                    }
                    secondaryTypographyProps={{
                      className: classes.vehicleMeta,
                      noWrap: true,
                    }}
                  />
                </ListItemButton>
              );
            })}
          </List>
          {emptySelectedIds.length > 0 &&
          orderedSelectedIds.length > emptySelectedIds.length ? (
            <Alert severity='warning' sx={{ mt: 1, py: 0.25, fontSize: '0.75rem' }}>
              {t('parameterViewerDialog.partialLoad', {
                ids: emptySelectedIds.join(', '),
              })}
            </Alert>
          ) : null}
        </Box>

        <Box>
          <Typography className={classes.sidebarTitle} sx={{ mb: 0.5 }}>
            {t('parameterViewerDialog.groups')}
          </Typography>
          <List dense disablePadding>
            {groups.map((name) => {
              const selected = group === name;
              const count =
                name === ALL_GROUP
                  ? queryMatched.length
                  : queryMatched.filter((row) => row.group === name).length;
              return (
                <ListItemButton
                  key={name}
                  selected={selected}
                  className={`${classes.groupItem} ${
                    selected ? classes.groupItemSelected : ''
                  }`}
                  onClick={() => setGroup(name)}
                >
                  <ListItemText
                    primary={
                      name === ALL_GROUP
                        ? t('parameterViewerDialog.allGroups')
                        : name
                    }
                    primaryTypographyProps={{ variant: 'body2' }}
                  />
                  <Typography className={classes.vehicleMeta}>{count}</Typography>
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      </Box>

      <Box className={classes.main}>
        <Box className={classes.toolbar}>
          <TextField
            className={classes.search}
            size='small'
            variant='filled'
            label={t('parameterViewerDialog.search')}
            value={query}
            disabled={state.loading || orderedSelectedIds.length === 0}
            onChange={(event) => setQuery(event.target.value)}
            InputProps={{
              endAdornment: query ? (
                <InputAdornment position='end'>
                  <IconButton size='small' onClick={() => setQuery('')}>
                    <Clear fontSize='small' />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />

          <ToggleButtonGroup
            exclusive
            size='small'
            value={filter}
            onChange={(_event, value) => {
              if (value) {
                setFilter(value);
              }
            }}
          >
            <ToggleButton value={FILTER_ALL}>
              {t('parameterViewerDialog.filterAll')} ({counts.all})
            </ToggleButton>
            <ToggleButton value={FILTER_DIFF}>
              {t('parameterViewerDialog.filterMismatched')} ({counts.diff})
            </ToggleButton>
            <ToggleButton value={FILTER_MOD}>
              {t('parameterViewerDialog.filterEdited')} ({counts.mod})
            </ToggleButton>
          </ToggleButtonGroup>

          <Tooltip content={t('parameterViewerDialog.refresh')}>
            <span>
              <IconButton
                disabled={orderedSelectedIds.length === 0 || state.loading}
                onClick={state.retry}
              >
                <Refresh />
              </IconButton>
            </span>
          </Tooltip>

          {!state.loading && !state.error && state.value ? (
            <Typography variant='body2' color='text.secondary'>
              {t('parameterViewerDialog.count', {
                shown: visible.length,
                total: comparedRows.length,
              })}
            </Typography>
          ) : null}

          {pendingCount > 0 ? (
            <Box className={classes.pendingActions}>
              <Typography className={classes.pendingLabel}>
                {t('parameterViewerDialog.pending', { count: pendingCount })}
              </Typography>
              <Button size='small' onClick={onRevert} disabled={writing}>
                {t('parameterViewerDialog.revert')}
              </Button>
              <Button
                size='small'
                variant='contained'
                color='primary'
                disabled={writing}
                onClick={onWrite}
              >
                {t('parameterViewerDialog.write')}
              </Button>
            </Box>
          ) : null}
        </Box>

        {body}

        <Box className={classes.footer}>
          <span>
            {t('parameterViewerDialog.compared', {
              count: orderedSelectedIds.length,
            })}
          </span>
          <span>
            <span
              className={classes.legendSwatch}
              style={{ backgroundColor: alpha('#ed6c02', 0.2) }}
            />
            {t('parameterViewerDialog.legendMismatch')}
          </span>
          <span>
            <span className={classes.legendEdit} />
            {t('parameterViewerDialog.legendEdit')}
          </span>
          <span>{t('parameterViewerDialog.legendMissing')}</span>
          <Box sx={{ flex: 1 }} />
          <span>
            {t('parameterViewerDialog.statusLine', {
              mismatched: counts.diff,
              pending: pendingCount,
            })}
          </span>
        </Box>
      </Box>
    </Box>
  );
};

ParameterViewerPanel.propTypes = {
  defaultSelectedUavIds: PropTypes.arrayOf(PropTypes.string),
};

export default ParameterViewerPanel;
