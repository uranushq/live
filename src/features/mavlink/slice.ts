import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { FltModeSlots, MavlinkSliceState } from './types';

const initialState: MavlinkSliceState = {
  fltModeSlotsByUavId: {},
  lastUpdatedAt: undefined,
};

const { actions, reducer } = createSlice({
  name: 'mavlink',
  initialState,
  reducers: {
    setFltModeSlotsByUavId(
      state,
      { payload }: PayloadAction<Record<string, FltModeSlots>>
    ) {
      state.fltModeSlotsByUavId = payload;
      state.lastUpdatedAt = Date.now();
    },
    mergeFltModeSlotsByUavId(
      state,
      { payload }: PayloadAction<Record<string, FltModeSlots>>
    ) {
      Object.assign(state.fltModeSlotsByUavId, payload);
      state.lastUpdatedAt = Date.now();
    },
    clearFltModeSlots(state) {
      state.fltModeSlotsByUavId = {};
      state.lastUpdatedAt = undefined;
    },
  },
});

export const { setFltModeSlotsByUavId, mergeFltModeSlotsByUavId, clearFltModeSlots } =
  actions;

export default reducer;
