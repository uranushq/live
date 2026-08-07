/**
 * @file Action thunks for named UAV groups.
 */

import { setSelection } from '~/features/map/selection';
import { getSelectedUAVIds } from '~/features/uavs/selectors';
import { uavIdToGlobalId } from '~/model/identifiers';
import type { AppThunk } from '~/store/reducers';
import { NEW_ITEM_ID, type Identifier } from '~/utils/collections';
import { chooseUniqueIdFromName } from '~/utils/naming';

import {
  getActiveNamedUAVGroupMemberIdSet,
  getVisibleUAVIdList,
} from './selectors';
import {
  addNamedUAVGroup,
  clearActiveNamedUAVGroupIds as clearActiveNamedUAVGroupIdsAction,
  closeNamedUAVGroupDialog,
  deleteNamedUAVGroup,
  setActiveNamedUAVGroupIds as setActiveNamedUAVGroupIdsAction,
  showCreateNamedUAVGroupDialog,
  showEditNamedUAVGroupDialog,
  toggleActiveNamedUAVGroupId as toggleActiveNamedUAVGroupIdAction,
  updateNamedUAVGroup,
} from './slice';
import { type NamedUAVGroup } from './types';

export {
  closeNamedUAVGroupDialog,
  deleteNamedUAVGroup,
  showCreateNamedUAVGroupDialog,
  showEditNamedUAVGroupDialog,
};

/**
 * Opens the create-group dialog.
 */
export const openCreateNamedUAVGroupDialog = showCreateNamedUAVGroupDialog;

const pruneSelectionToVisibleUAVs =
  (): AppThunk => (dispatch, getState) => {
    const memberSet = getActiveNamedUAVGroupMemberIdSet(getState());
    if (!memberSet) {
      return;
    }

    const selected = getSelectedUAVIds(getState());
    const nextSelection = selected
      .filter((id) => memberSet.has(id))
      .map(uavIdToGlobalId);
    dispatch(setSelection(nextSelection));
  };

/**
 * Replaces the active group filter with the given ids (empty = all drones).
 */
export const setActiveNamedUAVGroupIds =
  (groupIds: Identifier[]): AppThunk =>
  (dispatch) => {
    dispatch(setActiveNamedUAVGroupIdsAction(groupIds));
    dispatch(pruneSelectionToVisibleUAVs());
  };

/**
 * Clears the group filter (show all drones).
 */
export const clearActiveNamedUAVGroupIds =
  (): AppThunk => (dispatch) => {
    dispatch(clearActiveNamedUAVGroupIdsAction());
  };

/**
 * Toggles one group in the multi-select filter.
 */
export const toggleActiveNamedUAVGroupId =
  (groupId: Identifier): AppThunk =>
  (dispatch) => {
    dispatch(toggleActiveNamedUAVGroupIdAction(groupId));
    dispatch(pruneSelectionToVisibleUAVs());
  };

/**
 * @deprecated Use {@link setActiveNamedUAVGroupIds} / {@link toggleActiveNamedUAVGroupId}.
 */
export const setActiveNamedUAVGroupId =
  (groupId: Identifier | null): AppThunk =>
  (dispatch) => {
    if (groupId === null) {
      dispatch(clearActiveNamedUAVGroupIds());
      return;
    }

    dispatch(setActiveNamedUAVGroupIds([groupId]));
  };

/**
 * Selects every UAV that is currently visible under the active group filter.
 */
export const selectAllVisibleUAVs =
  (): AppThunk => (dispatch, getState) => {
    dispatch(
      setSelection(getVisibleUAVIdList(getState()).map(uavIdToGlobalId))
    );
  };

type SaveNamedUAVGroupPayload = {
  id?: Identifier;
  name: string;
  uavIds: Identifier[];
};

/**
 * Creates or updates a named UAV group and closes the editor dialog.
 */
export const saveNamedUAVGroup =
  ({ id, name, uavIds }: SaveNamedUAVGroupPayload): AppThunk =>
  (dispatch, getState) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    const uniqueIds = [...new Set(uavIds.filter(Boolean))];
    const { byId } = getState().droneGroups;

    if (id && id !== NEW_ITEM_ID && byId[id]) {
      const updated: NamedUAVGroup = {
        id,
        name: trimmedName,
        uavIds: uniqueIds,
      };
      dispatch(updateNamedUAVGroup(updated));
    } else {
      const newId = chooseUniqueIdFromName(trimmedName, Object.keys(byId));
      dispatch(
        addNamedUAVGroup({
          id: newId,
          name: trimmedName,
          uavIds: uniqueIds,
        })
      );
    }

    dispatch(closeNamedUAVGroupDialog());
  };

/**
 * Deletes a group and closes the dialog if it was editing that group.
 */
export const removeNamedUAVGroup =
  (groupId: Identifier): AppThunk =>
  (dispatch) => {
    dispatch(deleteNamedUAVGroup(groupId));
  };
