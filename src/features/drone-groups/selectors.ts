import { createSelector } from '@reduxjs/toolkit';

import type { AppSelector, RootState } from '~/store/reducers';
import { selectOrdered, type Identifier } from '~/utils/collections';
import { EMPTY_ARRAY } from '~/utils/redux';

import { type NamedUAVGroup } from './types';

/**
 * Ordered list of user-defined UAV groups.
 */
export const getNamedUAVGroupsInOrder: AppSelector<NamedUAVGroup[]> =
  createSelector(
    (state: RootState) => state.droneGroups,
    selectOrdered
  );

/**
 * Active group filter ids. Empty means show all UAVs.
 * Also accepts legacy persisted `activeGroupId` for one release.
 */
export const getActiveNamedUAVGroupIds: AppSelector<Identifier[]> = (
  state
) => {
  const { activeGroupIds, activeGroupId, byId } = state.droneGroups as {
    activeGroupIds?: Identifier[];
    activeGroupId?: Identifier | null;
    byId: Record<Identifier, NamedUAVGroup>;
  };

  if (Array.isArray(activeGroupIds)) {
    return activeGroupIds.filter((id) => Boolean(byId[id]));
  }

  if (activeGroupId && byId[activeGroupId]) {
    return [activeGroupId];
  }

  return EMPTY_ARRAY;
};

/**
 * @deprecated Prefer {@link getActiveNamedUAVGroupIds}.
 * Returns the first active group id, or null.
 */
export const getActiveNamedUAVGroupId = (
  state: RootState
): NamedUAVGroup['id'] | null => getActiveNamedUAVGroupIds(state)[0] ?? null;

/**
 * Active named UAV groups in list order.
 */
export const getActiveNamedUAVGroups: AppSelector<NamedUAVGroup[]> =
  createSelector(
    getNamedUAVGroupsInOrder,
    getActiveNamedUAVGroupIds,
    (groups, activeIds) => {
      if (activeIds.length === 0) {
        return EMPTY_ARRAY;
      }

      const activeSet = new Set(activeIds);
      return groups.filter((group) => activeSet.has(group.id));
    }
  );

/**
 * @deprecated Prefer {@link getActiveNamedUAVGroups}.
 */
export const getActiveNamedUAVGroup: AppSelector<NamedUAVGroup | undefined> = (
  state
) => getActiveNamedUAVGroups(state)[0];

/**
 * Union of member ids across all active groups, or null when no filter.
 */
export const getActiveNamedUAVGroupMemberIdSet: AppSelector<Set<
  Identifier
> | null> = createSelector(getActiveNamedUAVGroups, (groups) => {
  if (groups.length === 0) {
    return null;
  }

  const memberSet = new Set<Identifier>();
  for (const group of groups) {
    for (const uavId of group.uavIds) {
      memberSet.add(uavId);
    }
  }

  return memberSet;
});

/**
 * UAV IDs visible under the current group filter (all UAVs when no group
 * is selected). Preserves the order from `state.uavs.order`.
 */
export const getVisibleUAVIdList: AppSelector<Identifier[]> = createSelector(
  (state: RootState) => state.uavs.order,
  getActiveNamedUAVGroupMemberIdSet,
  (order, memberSet): Identifier[] => {
    if (!memberSet) {
      return order;
    }

    if (order.length === 0) {
      return EMPTY_ARRAY;
    }

    return order.filter((id) => memberSet.has(id));
  }
);

/**
 * Returns whether a UAV should be shown under the active group filter.
 * When no group is active, every UAV is visible.
 */
export const isUAVVisibleInActiveGroup = (
  state: RootState,
  uavId: Identifier
): boolean => {
  const memberSet = getActiveNamedUAVGroupMemberIdSet(state);
  return memberSet === null || memberSet.has(uavId);
};

/**
 * Set of UAV IDs that already belong to at least one named group.
 */
export const getUAVIdsAssignedToAnyNamedGroup: AppSelector<Set<Identifier>> =
  createSelector(getNamedUAVGroupsInOrder, (groups) => {
    const assigned = new Set<Identifier>();
    for (const group of groups) {
      for (const uavId of group.uavIds) {
        assigned.add(uavId);
      }
    }

    return assigned;
  });

/**
 * Next default group name in the form `group1`, `group2`, ...
 */
export const getNextDefaultNamedUAVGroupName: AppSelector<string> =
  createSelector(getNamedUAVGroupsInOrder, (groups) => {
    const existingNames = new Set(groups.map((group) => group.name));
    let index = 1;
    while (existingNames.has(`group${index}`)) {
      index += 1;
    }

    return `group${index}`;
  });

export const isNamedUAVGroupDialogOpen = (state: RootState): boolean =>
  state.droneGroups.dialog.open;

export const getEditedNamedUAVGroupId = (
  state: RootState
): NamedUAVGroup['id'] | undefined => state.droneGroups.dialog.editedGroupId;

export const getEditedNamedUAVGroup = (
  state: RootState
): NamedUAVGroup | undefined => {
  const id = getEditedNamedUAVGroupId(state);
  return id ? state.droneGroups.byId[id] : undefined;
};
