/* eslint-disable @typescript-eslint/naming-convention */
import SortAscending from '@mui/icons-material/ArrowDownward';
import SortDescending from '@mui/icons-material/ArrowUpward';
import Check from '@mui/icons-material/Check';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Filter from '@mui/icons-material/FilterList';
import GroupWork from '@mui/icons-material/GroupWork';
import GpsFixed from '@mui/icons-material/GpsFixed';
import SatelliteAlt from '@mui/icons-material/SatelliteAlt';
import Sort from '@mui/icons-material/Sort';
import ButtonBase from '@mui/material/ButtonBase';
import Chip, { type ChipProps } from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem, { type MenuItemProps } from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';
import Clear from '@mui/icons-material/Clear';
import clsx from 'clsx';
import type { TFunction } from 'i18next';
import {
  bindMenu,
  bindTrigger,
  usePopupState,
  type PopupState,
} from 'material-ui-popup-state/hooks';
import React, { useCallback, useMemo, useRef, type SyntheticEvent } from 'react';
import { withTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { isThemeDark, makeStyles } from '@skybrush/app-theme-mui';

import Colors from '~/components/colors';
import {
  clearActiveNamedUAVGroupIds,
  setActiveNamedUAVGroupIds,
  showCreateNamedUAVGroupDialog,
  showEditNamedUAVGroupDialog,
  toggleActiveNamedUAVGroupId,
} from '~/features/drone-groups/actions';
import {
  getActiveNamedUAVGroupIds,
  getNamedUAVGroupsInOrder,
} from '~/features/drone-groups/selectors';
import { type NamedUAVGroup } from '~/features/drone-groups/types';
import { selectGpsFleetSummary } from '~/features/uavs/gpsFleetSummary';
import {
  setSingleUAVListFilter,
  setUAVListSortPreference,
  toggleUAVListSortDirection,
} from '~/features/settings/actions';
import {
  getUAVListFilters,
  getUAVListLayout,
  getUAVListSortPreference,
  isShowingMissionIds,
} from '~/features/settings/selectors';
import {
  UAVListLayout,
  type UAVSortKeyAndOrder,
} from '~/features/settings/types';
import {
  UAVFilter,
  UAVFilters,
  labelsForUAVFilter,
  shortLabelsForUAVFilter,
} from '~/model/filtering';
import {
  UAVSortKey,
  UAVSortKeys,
  labelsForUAVSortKey,
  shortLabelsForUAVSortKey,
} from '~/model/sorting';
import type { RootState } from '~/store/reducers';
import type { Identifier } from '~/utils/collections';
import type { Nullable } from '~/utils/types';

import { FILTER_BAR_HEIGHT } from './constants';

const menuPaperProps = {
  elevation: 8,
  sx: {
    borderRadius: 2,
    minWidth: 180,
    mt: 0.5,
  },
};

const useStyles = makeStyles((theme: Theme) => {
  const dark = isThemeDark(theme);
  const chipBase = {
    borderRadius: 999,
    fontSize: '0.72rem',
    fontWeight: 600,
    height: 30,
    letterSpacing: '0.02em',
    transition: theme.transitions.create(
      ['background-color', 'border-color', 'box-shadow', 'color'],
      { duration: theme.transitions.duration.short }
    ),
    '& .MuiChip-deleteIcon': {
      color: 'inherit',
      fontSize: '1rem',
      opacity: 0.85,
    },
    '& .MuiChip-icon': {
      color: 'inherit',
      fontSize: '0.95rem',
      marginLeft: theme.spacing(1),
      opacity: 0.9,
    },
    '& .MuiChip-label': {
      paddingLeft: theme.spacing(0.75),
      paddingRight: theme.spacing(1.25),
    },
  };

  return {
    root: {
      backdropFilter: 'blur(10px)',
      background: dark
        ? 'linear-gradient(180deg, rgba(20, 24, 32, 0.96) 0%, rgba(14, 18, 24, 0.92) 100%)'
        : 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.95) 100%)',
      borderBottom: `1px solid ${
        dark ? 'rgba(110, 182, 255, 0.16)' : theme.palette.divider
      }`,
      boxShadow: dark
        ? '0 4px 16px rgba(0, 0, 0, 0.28)'
        : '0 2px 10px rgba(15, 23, 42, 0.06)',
      minWidth: 0,
      overflowX: 'auto',
      overflowY: 'visible',
      width: '100%',
      zIndex: 10,
    },

    rootEmbedded: {
      flexShrink: 0,
    },

    toolbarInner: {
      alignItems: 'center',
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(0.75),
      justifyContent: 'flex-start',
      minHeight: FILTER_BAR_HEIGHT,
      minWidth: 'min-content',
      padding: theme.spacing(0.75, 1.25),
      width: '100%',
    },

    group: {
      alignItems: 'center',
      background: dark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(15, 23, 42, 0.04)',
      border: `1px solid ${dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)'}`,
      borderRadius: 999,
      display: 'flex',
      flex: '0 1 auto',
      flexWrap: 'wrap',
      gap: theme.spacing(0.5),
      maxWidth: '100%',
      padding: theme.spacing(0.35, 0.5),
    },

    chip: {
      ...chipBase,
      backgroundColor: dark ? 'rgba(255, 255, 255, 0.06)' : theme.palette.common.white,
      border: `1px solid ${dark ? 'rgba(255, 255, 255, 0.1)' : theme.palette.divider}`,
      color: dark ? 'rgba(255, 255, 255, 0.82)' : theme.palette.text.primary,
      '&:hover': {
        backgroundColor: dark ? 'rgba(255, 255, 255, 0.1)' : theme.palette.grey[50],
        borderColor: dark ? 'rgba(110, 182, 255, 0.35)' : theme.palette.primary.light,
      },
    },

    chipActive: {
      ...chipBase,
      backgroundColor: dark ? 'rgba(47, 128, 237, 0.2)' : 'rgba(47, 128, 237, 0.1)',
      border: `1px solid ${dark ? 'rgba(110, 182, 255, 0.45)' : theme.palette.primary.main}`,
      boxShadow: dark ? '0 0 12px rgba(47, 128, 237, 0.18)' : 'none',
      color: dark ? '#a8d4ff' : theme.palette.primary.main,
    },

    chipWarning: {
      ...chipBase,
      backgroundColor: dark ? 'rgba(232, 179, 57, 0.14)' : 'rgba(232, 179, 57, 0.12)',
      border: `1px solid ${dark ? 'rgba(232, 179, 57, 0.4)' : Colors.warning}`,
      color: dark ? '#f0c96a' : Colors.warning,
    },

    chipError: {
      ...chipBase,
      backgroundColor: dark ? 'rgba(244, 67, 54, 0.14)' : 'rgba(244, 67, 54, 0.1)',
      border: `1px solid ${dark ? 'rgba(244, 67, 54, 0.4)' : Colors.error}`,
      color: dark ? '#ff9a8f' : Colors.error,
    },

    chipSuccess: {
      ...chipBase,
      backgroundColor: dark ? 'rgba(62, 207, 110, 0.12)' : 'rgba(62, 207, 110, 0.1)',
      border: `1px solid ${dark ? 'rgba(62, 207, 110, 0.35)' : Colors.success}`,
      color: dark ? '#8ef0b0' : Colors.success,
    },

    chipMuted: {
      ...chipBase,
      backgroundColor: dark ? 'rgba(255, 255, 255, 0.04)' : theme.palette.grey[50],
      border: `1px solid ${dark ? 'rgba(255, 255, 255, 0.08)' : theme.palette.divider}`,
      color: dark ? 'rgba(255, 255, 255, 0.55)' : theme.palette.text.secondary,
    },

    groupSelector: {
      alignItems: 'center',
      background: dark
        ? 'linear-gradient(180deg, rgba(47, 128, 237, 0.18) 0%, rgba(47, 128, 237, 0.1) 100%)'
        : 'linear-gradient(180deg, rgba(47, 128, 237, 0.12) 0%, rgba(47, 128, 237, 0.06) 100%)',
      border: `1.5px solid ${
        dark ? 'rgba(110, 182, 255, 0.45)' : theme.palette.primary.main
      }`,
      borderRadius: 10,
      boxShadow: dark
        ? '0 0 16px rgba(47, 128, 237, 0.2)'
        : '0 2px 8px rgba(47, 128, 237, 0.16)',
      display: 'flex',
      flex: '0 0 auto',
      gap: theme.spacing(0.75),
      maxWidth: '100%',
      minHeight: 40,
      padding: theme.spacing(0.35, 0.5, 0.35, 0.75),
    },

    groupSelectorInactive: {
      background: dark
        ? 'rgba(255, 255, 255, 0.05)'
        : theme.palette.common.white,
      border: `1.5px solid ${
        dark ? 'rgba(255, 255, 255, 0.16)' : theme.palette.divider
      }`,
      boxShadow: dark ? 'none' : '0 1px 4px rgba(15, 23, 42, 0.06)',
    },

    groupSelectorButton: {
      alignItems: 'center',
      borderRadius: 8,
      display: 'flex',
      flex: '1 1 auto',
      gap: theme.spacing(1),
      justifyContent: 'flex-start',
      minWidth: 0,
      padding: theme.spacing(0.35, 0.5),
      textAlign: 'left',
    },

    groupBadge: {
      alignItems: 'center',
      backgroundColor: dark ? 'rgba(47, 128, 237, 0.85)' : theme.palette.primary.main,
      borderRadius: 6,
      color: theme.palette.common.white,
      display: 'inline-flex',
      flex: '0 0 auto',
      fontSize: '0.65rem',
      fontWeight: 800,
      gap: 4,
      letterSpacing: '0.08em',
      lineHeight: 1,
      padding: theme.spacing(0.55, 0.7),
      textTransform: 'uppercase',
    },

    groupBadgeInactive: {
      backgroundColor: dark ? 'rgba(255, 255, 255, 0.12)' : theme.palette.grey[700],
    },

    groupTextBlock: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
    },

    groupCaption: {
      color: dark ? 'rgba(168, 212, 255, 0.75)' : theme.palette.primary.dark,
      fontSize: '0.62rem',
      fontWeight: 600,
      letterSpacing: '0.04em',
      lineHeight: 1.1,
      textTransform: 'uppercase',
    },

    groupCaptionInactive: {
      color: theme.palette.text.secondary,
    },

    groupName: {
      color: dark ? '#dff0ff' : theme.palette.text.primary,
      fontSize: '0.95rem',
      fontWeight: 800,
      letterSpacing: '0.01em',
      lineHeight: 1.15,
      maxWidth: 180,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },

    groupCount: {
      color: dark ? 'rgba(168, 212, 255, 0.9)' : theme.palette.primary.main,
      flex: '0 0 auto',
      fontSize: '0.78rem',
      fontWeight: 700,
      whiteSpace: 'nowrap',
    },

    groupCountInactive: {
      color: theme.palette.text.secondary,
    },

    groupClearButton: {
      color: dark ? '#a8d4ff' : theme.palette.primary.main,
      padding: 4,
    },
  };
});

const checkStyle = { fontSize: 'inherit', marginLeft: 8 };
const check = <Check style={checkStyle} />;

const getFilterChipClass = (
  filters: UAVFilter[],
  classes: ReturnType<typeof useStyles>
): string => {
  const isFilterActive = Array.isArray(filters) && filters.length > 0;

  if (!isFilterActive) {
    return classes.chip;
  }

  switch (filters[0]) {
    case UAVFilter.WITH_WARNINGS:
    case UAVFilter.INACTIVE_ONLY:
      return classes.chipWarning;

    case UAVFilter.WITH_ERRORS:
      return classes.chipError;

    default:
      return classes.chipActive;
  }
};

type CheckableMenuItemProps = MenuItemProps & Readonly<{ label: string }>;

const CheckableMenuItem = React.forwardRef<
  HTMLLIElement,
  CheckableMenuItemProps
>(({ label, selected, ...rest }, ref) => (
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  <MenuItem ref={ref as any} dense {...(rest as any)}>
    {label}
    {selected ? check : null}
  </MenuItem>
));

function bindChip({
  state,
  ref,
  action,
  popupTrigger = 'chip',
}: {
  state: PopupState;
  ref?: HTMLElement;
  action?: () => void;
  popupTrigger?: 'chip' | 'icon';
}): Partial<ChipProps> {
  const result: Partial<ChipProps> = bindTrigger(state);
  const opener = (event: SyntheticEvent<any>): void => {
    state.open(ref ?? event);
  };

  result.onContextMenu = result.onClick;

  if (popupTrigger === 'icon') {
    result.onDelete = opener;
    if (action) {
      result.onClick = action;
    }
  } else {
    result.onDelete = action ?? opener;
  }

  return result;
}

type GpsFleetSummaryProps = Readonly<{
  minSatellites?: number;
  rtkFixed: number;
  rtkFloat: number;
}>;

type SortAndFilterHeaderProps = Readonly<{
  activeGroupIds: Identifier[];
  filters: UAVFilter[];
  groups: NamedUAVGroup[];
  gpsSummary: GpsFleetSummaryProps;
  layout: UAVListLayout;
  onClearActiveGroups: () => void;
  onCreateGroup: () => void;
  onEditGroup: (groupId: Identifier) => void;
  onSetActiveGroups: (groupIds: Identifier[]) => void;
  onToggleActiveGroup: (groupId: Identifier) => void;
  onSetFilter: (filter: Nullable<UAVFilter>) => void;
  onSetSortBy: (sortBy: Partial<UAVSortKeyAndOrder>) => void;
  onToggleSortDirection: () => void;
  showMissionIds: boolean;
  sortBy: UAVSortKeyAndOrder;
  t: TFunction;
}>;

const SortAndFilterHeader = ({
  activeGroupIds,
  filters,
  groups,
  gpsSummary,
  layout,
  onClearActiveGroups,
  onCreateGroup,
  onEditGroup,
  onToggleActiveGroup,
  onSetFilter,
  onSetSortBy,
  onToggleSortDirection,
  sortBy,
  t,
}: SortAndFilterHeaderProps): React.JSX.Element => {
  const classes = useStyles();
  const sortChipRef = useRef<HTMLDivElement>();
  const sortPopupState = usePopupState({
    variant: 'popover',
    popupId: 'uav-list-sort-options',
  });
  const filterChipRef = useRef<HTMLDivElement>();
  const filterPopupState = usePopupState({
    variant: 'popover',
    popupId: 'uav-list-filter-options',
  });
  const groupChipRef = useRef<HTMLDivElement>();
  const groupPopupState = usePopupState({
    variant: 'popover',
    popupId: 'uav-list-group-options',
  });

  const setFilter = useCallback(
    (value: Nullable<UAVFilter>) => {
      if (onSetFilter) {
        onSetFilter(value);
      }

      filterPopupState.close();
    },
    [onSetFilter, filterPopupState]
  );
  const setSortKey = useCallback(
    (value: UAVSortKey) => {
      if (onSetSortBy) {
        onSetSortBy({ key: value });
      }

      sortPopupState.close();
    },
    [onSetSortBy, sortPopupState]
  );
  const setSortReversed = useCallback(
    (value: boolean) => {
      if (onSetSortBy) {
        onSetSortBy({ reverse: Boolean(value) });
      }

      sortPopupState.close();
    },
    [onSetSortBy, sortPopupState]
  );
  const clearActiveGroups = useCallback(() => {
    onClearActiveGroups();
  }, [onClearActiveGroups]);

  const toggleGroup = useCallback(
    (groupId: Identifier) => {
      onToggleActiveGroup(groupId);
    },
    [onToggleActiveGroup]
  );

  const activeGroupIdSet = useMemo(
    () => new Set(activeGroupIds),
    [activeGroupIds]
  );
  const activeGroups = useMemo(
    () => groups.filter((group) => activeGroupIdSet.has(group.id)),
    [groups, activeGroupIdSet]
  );
  const isSortActive = sortBy.key !== UAVSortKey.DEFAULT;
  const isFilterActive = Array.isArray(filters) && filters.length > 0;
  const isGroupActive = activeGroups.length > 0;
  const groupDisplayName =
    activeGroups.length === 0
      ? t('droneGroups.allDrones')
      : activeGroups.length === 1
        ? activeGroups[0]!.name
        : activeGroups.length === 2
          ? `${activeGroups[0]!.name} + ${activeGroups[1]!.name}`
          : t('droneGroups.multipleGroups', { count: activeGroups.length });
  const groupMemberCount = isGroupActive
    ? new Set(activeGroups.flatMap((group) => group.uavIds)).size
    : null;

  return (
    <div className={clsx(classes.root, classes.rootEmbedded)}>
      <div className={classes.toolbarInner}>
        <div
          className={clsx(
            classes.groupSelector,
            !isGroupActive && classes.groupSelectorInactive
          )}
        >
          <ButtonBase
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            ref={groupChipRef as any}
            className={classes.groupSelectorButton}
            onClick={(event) => {
              groupPopupState.open(groupChipRef.current ?? event.currentTarget);
            }}
          >
            <span
              className={clsx(
                classes.groupBadge,
                !isGroupActive && classes.groupBadgeInactive
              )}
            >
              <GroupWork sx={{ fontSize: '0.85rem' }} />
              {t('droneGroups.badge')}
            </span>
            <span className={classes.groupTextBlock}>
              <Typography
                className={clsx(
                  classes.groupCaption,
                  !isGroupActive && classes.groupCaptionInactive
                )}
                component='span'
              >
                {t('droneGroups.currentGroup')}
              </Typography>
              <Typography className={classes.groupName} component='span'>
                {groupDisplayName}
              </Typography>
            </span>
            {groupMemberCount !== null && (
              <Typography
                className={clsx(
                  classes.groupCount,
                  !isGroupActive && classes.groupCountInactive
                )}
                component='span'
              >
                {t('droneGroups.memberCount', { count: groupMemberCount })}
              </Typography>
            )}
            <ExpandMore fontSize='small' sx={{ opacity: 0.8 }} />
          </ButtonBase>
          {isGroupActive && (
            <IconButton
              aria-label={t('droneGroups.clearGroupFilter')}
              className={classes.groupClearButton}
              size='small'
              onClick={() => {
                clearActiveGroups();
              }}
            >
              <Clear fontSize='small' />
            </IconButton>
          )}
          <Menu
            {...bindMenu(groupPopupState)}
            slotProps={{
              paper: {
                ...menuPaperProps,
                sx: { ...menuPaperProps.sx, minWidth: 220 },
              },
            }}
          >
            <MenuItem dense disabled>
              {t('droneGroups.filterByMulti')}
            </MenuItem>
            <CheckableMenuItem
              label={t('droneGroups.allDrones')}
              selected={!isGroupActive}
              onClick={() => {
                clearActiveGroups();
              }}
            />
            {groups.map((group) => {
              const selected = activeGroupIdSet.has(group.id);
              return (
                <MenuItem
                  key={group.id}
                  dense
                  selected={selected}
                  onClick={() => {
                    toggleGroup(group.id);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    groupPopupState.close();
                    onEditGroup(group.id);
                  }}
                >
                  {group.name}
                  <Typography
                    component='span'
                    sx={{
                      color: 'text.secondary',
                      fontSize: '0.75rem',
                      ml: 1,
                    }}
                  >
                    ({group.uavIds.length})
                  </Typography>
                  {selected ? check : null}
                </MenuItem>
              );
            })}
            <Divider style={{ margin: '4px 0' }} />
            <MenuItem
              dense
              onClick={() => {
                groupPopupState.close();
                onCreateGroup();
              }}
            >
              {t('droneGroups.createGroup')}
            </MenuItem>
            {activeGroups.length === 1 && (
              <MenuItem
                dense
                onClick={() => {
                  groupPopupState.close();
                  onEditGroup(activeGroups[0]!.id);
                }}
              >
                {t('droneGroups.editGroup')}
              </MenuItem>
            )}
          </Menu>
        </div>

        <div className={classes.group}>
          <Chip
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            ref={sortChipRef as any}
            className={isSortActive ? classes.chipActive : classes.chip}
            deleteIcon={sortBy?.reverse ? <SortDescending /> : <SortAscending />}
            icon={<Sort fontSize='small' />}
            label={shortLabelsForUAVSortKey[sortBy.key](t)}
            size='small'
            variant='outlined'
            {...bindChip({
              state: sortPopupState,
              ref: sortChipRef.current,
              action: onToggleSortDirection,
            })}
          />
          <Menu {...bindMenu(sortPopupState)} slotProps={{ paper: menuPaperProps }}>
            <MenuItem dense disabled>
              {t('sorting.sortBy')}
            </MenuItem>
            {UAVSortKeys.map((sortKey) => (
              <CheckableMenuItem
                key={sortKey}
                label={labelsForUAVSortKey[sortKey](t)}
                selected={sortBy.key === sortKey}
                onClick={() => {
                  setSortKey(sortKey);
                }}
              />
            ))}
            <Divider style={{ margin: '4px 0' }} />
            <CheckableMenuItem
              label={t('sorting.ascending')}
              selected={!sortBy?.reverse}
              onClick={() => {
                setSortReversed(false);
              }}
            />
            <CheckableMenuItem
              label={t('sorting.descending')}
              selected={Boolean(sortBy?.reverse)}
              onClick={() => {
                setSortReversed(true);
              }}
            />
          </Menu>

          <Chip
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            ref={filterChipRef as any}
            className={getFilterChipClass(filters, classes)}
            deleteIcon={isFilterActive ? undefined : <Filter fontSize='small' />}
            icon={isFilterActive ? undefined : <Filter fontSize='small' />}
            label={
              isFilterActive
                ? filters.length > 1
                  ? t('filtering.composite')
                  : shortLabelsForUAVFilter[filters[0]!](t)
                : t('filtering.filter')
            }
            size='small'
            variant='outlined'
            {...bindChip({
              state: filterPopupState,
              ref: filterChipRef.current,
              action: isFilterActive
                ? (): void => {
                    setFilter(null);
                  }
                : undefined,
            })}
          />
          <Menu {...bindMenu(filterPopupState)} slotProps={{ paper: menuPaperProps }}>
            <MenuItem dense disabled>
              {t('filtering.filterBy')}
            </MenuItem>
            {UAVFilters.map((filter) => (
              <CheckableMenuItem
                key={filter}
                label={labelsForUAVFilter[filter](t)}
                selected={
                  (filters.length === 1 && filters[0] === filter) ||
                  (filter === UAVFilter.DEFAULT && filters.length === 0)
                }
                onClick={() => {
                  setFilter(filter);
                }}
              />
            ))}
          </Menu>
        </div>

        <div className={classes.group}>
          <Chip
            className={classes.chipSuccess}
            icon={<GpsFixed fontSize='small' />}
            label={`RTK+ ${gpsSummary.rtkFixed}`}
            size='small'
            title='RTK Fixed'
            variant='outlined'
          />
          <Chip
            className={classes.chipSuccess}
            icon={<GpsFixed fontSize='small' />}
            label={`RTK ${gpsSummary.rtkFloat}`}
            size='small'
            title='RTK Float'
            variant='outlined'
          />
          <Chip
            className={classes.chipMuted}
            icon={<SatelliteAlt fontSize='small' />}
            label={
              gpsSummary.minSatellites !== undefined
                ? `GPS ${gpsSummary.minSatellites}`
                : 'GPS —'
            }
            size='small'
            title='GPS 위성 수 (최소)'
            variant='outlined'
          />
        </div>
      </div>
    </div>
  );
};

export default connect(
  (state: RootState) => ({
    activeGroupIds: getActiveNamedUAVGroupIds(state),
    filters: getUAVListFilters(state),
    groups: getNamedUAVGroupsInOrder(state),
    gpsSummary: selectGpsFleetSummary(state),
    layout: getUAVListLayout(state),
    showMissionIds: isShowingMissionIds(state),
    sortBy: getUAVListSortPreference(state),
  }),
  {
    onClearActiveGroups: clearActiveNamedUAVGroupIds,
    onCreateGroup: showCreateNamedUAVGroupDialog,
    onEditGroup: showEditNamedUAVGroupDialog,
    onSetActiveGroups: setActiveNamedUAVGroupIds,
    onToggleActiveGroup: toggleActiveNamedUAVGroupId,
    onSetFilter: setSingleUAVListFilter,
    onSetSortBy: setUAVListSortPreference,
    onToggleSortDirection: toggleUAVListSortDirection,
  }
)(withTranslation()(SortAndFilterHeader));
