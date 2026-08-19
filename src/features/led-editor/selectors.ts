/**
 * @file Selectors for the LED-show editor feature.
 */

import { type RootState } from '~/store/reducers';

import { type Board } from './types';
import { gridDimensions, hasOverlappingBoards, timelineDurationSec } from './utils';

export const getLedEditorState = (state: RootState) => state.ledEditor;

export const getLedsPerDrone = (state: RootState) =>
  state.ledEditor.ledsPerDrone;

export const getDroneCount = (state: RootState) => state.ledEditor.droneCount;

export const getFps = (state: RootState) => state.ledEditor.fps;

export const getBoards = (state: RootState): Board[] => state.ledEditor.boards;

export const getSelectedBoardIds = (state: RootState): string[] =>
  state.ledEditor.selectedBoardIds;

export const getSelectedBoards = (state: RootState): Board[] => {
  const selected = new Set(state.ledEditor.selectedBoardIds);
  return state.ledEditor.boards.filter((b) => selected.has(b.id));
};

/** The board currently shown/edited in the bulb grid (the last selected). */
export const getActiveBoard = (state: RootState): Board | undefined => {
  const ids = state.ledEditor.selectedBoardIds;
  const id = ids[ids.length - 1];
  return id ? state.ledEditor.boards.find((b) => b.id === id) : undefined;
};

/** The active board's formation (falls back to a 1×1 placeholder). */
export const getActiveArrangement = (
  state: RootState
): { rows: number; cols: number } => {
  const board = getActiveBoard(state);
  return { rows: board?.rows ?? 1, cols: board?.cols ?? 1 };
};

/**
 * The active board's frozen phase layout, or undefined when it is an ordinary
 * board — in which case the bulb grid falls back to the dense `rows × cols`
 * arrangement.
 */
export const getActiveDroneLayout = (state: RootState) =>
  getActiveBoard(state)?.droneLayout;

/** Canvas pixel dimensions of the active board's formation. */
export const getActiveGridDimensions = (state: RootState) => {
  const { rows, cols } = getActiveArrangement(state);
  return gridDimensions(rows, cols, state.ledEditor.ledsPerDrone);
};

export const getSelectedPixels = (state: RootState) =>
  state.ledEditor.selectedPixels;

export const getActiveColor = (state: RootState) => state.ledEditor.activeColor;

export const getClipboard = (state: RootState) => state.ledEditor.clipboard;

export const getBoardClipboard = (state: RootState) =>
  state.ledEditor.boardClipboard;

export const getPlayheadSec = (state: RootState) => state.ledEditor.playheadSec;

export const getPlaying = (state: RootState) => state.ledEditor.playing;

// Defaults to true so a persisted state from before this field existed still
// syncs by default.
export const getThreeDSync = (state: RootState) =>
  state.ledEditor.threeDSync !== false;

export const getFormationTimeline = (state: RootState) =>
  state.ledEditor.formationTimeline ?? [];

export const getLedStartDelaySec = (state: RootState) =>
  state.ledEditor.ledStartDelaySec ?? null;

/**
 * How many authored formation phases the LED editor could pull in right now.
 * Zero means no path is loaded (or the 3D view is closed), which is what
 * disables the "path와 동기화" button. Transit segments are the planner's own
 * moves, not formations, so they never count.
 */
export const getSyncablePhaseCount = (state: RootState): number =>
  (state.ledEditor.formationTimeline ?? []).filter(
    (region) => region.kind !== 'transit' && region.phaseId
  ).length;

export const getUploadStatus = (state: RootState) => state.ledEditor.upload;

export const getTimelineDuration = (state: RootState) =>
  timelineDurationSec(state.ledEditor.boards);

export const hasTimelineOverlap = (state: RootState) =>
  hasOverlappingBoards(state.ledEditor.boards);

/**
 * Whether any board is synced to a 3D-view formation phase. When true, the LED
 * timeline's `t = 0` is the dance's own dispatch instant (boards already sit at
 * their real times, and the lead-in compiles to black frames), so the JR ARM
 * "start in" must no longer be shifted by `ledStartDelaySec`.
 */
export const hasPhaseSyncedBoards = (state: RootState): boolean =>
  state.ledEditor.boards.some((b) => Boolean(b.sourcePhaseId));

/** Whether the show is ready to be compiled and uploaded. */
export const canExport = (state: RootState) =>
  state.ledEditor.boards.length > 0 &&
  !hasOverlappingBoards(state.ledEditor.boards) &&
  state.ledEditor.upload.state !== 'running';
