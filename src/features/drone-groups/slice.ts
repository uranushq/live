/**
 * @file Slice that stores user-defined UAV groups and the active group filter.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import pull from 'lodash-es/pull';

import {
  addItemToFront,
  type Collection,
  deleteItemById,
  replaceItemOrAddToFront,
} from '~/utils/collections';
import { noPayload } from '~/utils/redux';

import { type NamedUAVGroup } from './types';

type DroneGroupsSliceState = Collection<NamedUAVGroup> & {
  /** Active group filter; empty means show all UAVs. Multiple IDs = union. */
  activeGroupIds: Array<NamedUAVGroup['id']>;
  dialog: {
    open: boolean;
    /** Existing group id when editing; undefined when creating. */
    editedGroupId?: NamedUAVGroup['id'];
  };
};

const initialState: DroneGroupsSliceState = {
  byId: {},
  order: [],
  activeGroupIds: [],
  dialog: {
    open: false,
    editedGroupId: undefined,
  },
};

/** Normalizes legacy persisted `activeGroupId` into `activeGroupIds`. */
const ensureActiveGroupIds = (state: DroneGroupsSliceState): void => {
  const legacy = state as DroneGroupsSliceState & {
    activeGroupId?: NamedUAVGroup['id'] | null;
  };

  if (!Array.isArray(state.activeGroupIds)) {
    state.activeGroupIds =
      legacy.activeGroupId && state.byId[legacy.activeGroupId]
        ? [legacy.activeGroupId]
        : [];
  }

  if ('activeGroupId' in legacy) {
    delete legacy.activeGroupId;
  }
};

const sanitizeActiveGroupIds = (
  state: DroneGroupsSliceState,
  ids: Array<NamedUAVGroup['id']>
): Array<NamedUAVGroup['id']> => {
  const seen = new Set<NamedUAVGroup['id']>();
  const next: Array<NamedUAVGroup['id']> = [];
  for (const id of ids) {
    if (!state.byId[id] || seen.has(id)) {
      continue;
    }

    seen.add(id);
    next.push(id);
  }

  return next;
};

const { actions, reducer } = createSlice({
  name: 'droneGroups',
  initialState,
  reducers: {
    addNamedUAVGroup(state, action: PayloadAction<NamedUAVGroup>) {
      ensureActiveGroupIds(state);
      addItemToFront(state, action.payload);
    },

    updateNamedUAVGroup(state, action: PayloadAction<NamedUAVGroup>) {
      ensureActiveGroupIds(state);
      replaceItemOrAddToFront(state, action.payload);
    },

    deleteNamedUAVGroup(state, action: PayloadAction<NamedUAVGroup['id']>) {
      ensureActiveGroupIds(state);
      const id = action.payload;
      deleteItemById(state, id);
      pull(state.activeGroupIds, id);

      if (state.dialog.editedGroupId === id) {
        state.dialog.open = false;
        state.dialog.editedGroupId = undefined;
      }
    },

    setActiveNamedUAVGroupIds(
      state,
      action: PayloadAction<Array<NamedUAVGroup['id']>>
    ) {
      ensureActiveGroupIds(state);
      state.activeGroupIds = sanitizeActiveGroupIds(state, action.payload);
    },

    toggleActiveNamedUAVGroupId(
      state,
      action: PayloadAction<NamedUAVGroup['id']>
    ) {
      ensureActiveGroupIds(state);
      const id = action.payload;
      if (!state.byId[id]) {
        return;
      }

      if (state.activeGroupIds.includes(id)) {
        pull(state.activeGroupIds, id);
      } else {
        state.activeGroupIds.push(id);
      }
    },

    clearActiveNamedUAVGroupIds: noPayload<DroneGroupsSliceState>((state) => {
      ensureActiveGroupIds(state);
      state.activeGroupIds = [];
    }),

    showCreateNamedUAVGroupDialog: noPayload<DroneGroupsSliceState>((state) => {
      state.dialog.open = true;
      state.dialog.editedGroupId = undefined;
    }),

    showEditNamedUAVGroupDialog(
      state,
      action: PayloadAction<NamedUAVGroup['id']>
    ) {
      if (!state.byId[action.payload]) {
        return;
      }

      state.dialog.open = true;
      state.dialog.editedGroupId = action.payload;
    },

    closeNamedUAVGroupDialog: noPayload<DroneGroupsSliceState>((state) => {
      state.dialog.open = false;
      state.dialog.editedGroupId = undefined;
    }),
  },
});

export const {
  addNamedUAVGroup,
  updateNamedUAVGroup,
  deleteNamedUAVGroup,
  setActiveNamedUAVGroupIds,
  toggleActiveNamedUAVGroupId,
  clearActiveNamedUAVGroupIds,
  showCreateNamedUAVGroupDialog,
  showEditNamedUAVGroupDialog,
  closeNamedUAVGroupDialog,
} = actions;

export { reducer as default, actions };
