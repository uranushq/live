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
    // Same test `syncPhaseBoards` applies, so the button is enabled exactly
    // when pressing it would produce something. A zero-length hold is a
    // fly-through, not a formation, and gets no board.
    (region) =>
      region.kind !== 'transit' &&
      region.phaseId &&
      region.endSec > region.startSec
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

/**
 * Whether the operator has authored any LED content at all.
 *
 * Used to decide whether a show start should reach the LED boards: the JR
 * board list is derived from the connected drones and is therefore non-empty
 * for every show, so it cannot answer that question on its own.
 */
export const hasAuthoredLedShow = (state: RootState): boolean =>
  state.ledEditor.boards.length > 0;

/** Whether the show is ready to be compiled and uploaded. */
export const canExport = (state: RootState) =>
  state.ledEditor.boards.length > 0 &&
  !hasOverlappingBoards(state.ledEditor.boards) &&
  state.ledEditor.upload.state !== 'running';

export const getDroneMapping = (state: RootState): Record<number, number> =>
  state.ledEditor.droneMapping ?? {};

/**
 * The download slot each drone's compiled `.bin` must occupy, in drone order.
 *
 * A JR board asks for `GET /download/<client_id>` and works out `client_id`
 * from its own address as *last octet - 1*; it never learns a filename. The
 * slot is therefore the only thing that decides which board plays which
 * drone's LEDs, and drone number `n` maps to slot `n - 1`.
 */
export const getLedTileIds = (state: RootState): number[] => {
  const mapping = getDroneMapping(state);
  return Array.from(
    { length: state.ledEditor.droneCount },
    (_unused, index) => (mapping[index] ?? index + 1) - 1
  );
};

/**
 * Drone numbers that more than one LED show slot has been pointed at.
 *
 * Such a mapping cannot be uploaded: the two files would land on the same
 * download slot and silently overwrite each other, leaving one airframe dark
 * with nothing to indicate why.
 */
export const getLedMappingConflicts = (state: RootState): number[] => {
  const seen = new Set<number>();
  const clashes = new Set<number>();
  for (const tileId of getLedTileIds(state)) {
    if (seen.has(tileId)) {
      clashes.add(tileId);
    }

    seen.add(tileId);
  }

  return [...clashes].map((tileId) => tileId + 1).sort((a, b) => a - b);
};

/** The active board's path-declared drone groups, if it has any. */
export const getActiveDroneGroups = (
  state: RootState
): number[][] | undefined => getActiveBoard(state)?.droneGroups;

/**
 * What a path sync would actually be able to do, and why.
 *
 * The shape and the drone count both come from `phaseLayouts`, so a mirror
 * that has regions but no layouts silently syncs timing only — boards appear,
 * nothing is reshaped, and the drone count never moves. Reporting the split
 * turns that into something the operator can read instead of guess at.
 */
export const getPhaseSyncDronePlan = (
  state: RootState
): {
  regions: number;
  withLayout: number;
  droneCount: number;
  currentDroneCount: number;
  /** Layout points that carry 3D world coordinates — what grouping needs. */
  withWorld: number;
  /** Points with a flat projection but no world coordinates (old format). */
  flatOnly: number;
  /** Slots the phase had no position for at all (drone-id mismatch). */
  missing: number;
} => {
  const layouts = state.ledEditor.phaseLayouts ?? {};
  const regions = (state.ledEditor.formationTimeline ?? []).filter(
    (region) =>
      region.kind !== 'transit' &&
      region.phaseId &&
      region.endSec > region.startSec
  );
  let withLayout = 0;
  let droneCount = 0;
  let withWorld = 0;
  let flatOnly = 0;
  let missing = 0;
  for (const region of regions) {
    const layout = layouts[region.phaseId!];
    const length = layout?.length ?? 0;
    if (length === 0) {
      continue;
    }

    withLayout += 1;
    droneCount = Math.max(droneCount, length);
    // Report the best phase, not a sum: one phase missing a drone should not
    // read the same as every phase missing every drone.
    withWorld = Math.max(
      withWorld,
      layout!.filter((point) => point?.world).length
    );
    flatOnly = Math.max(
      flatOnly,
      layout!.filter((point) => point && !point.world).length
    );
    missing = Math.max(missing, layout!.filter((point) => !point).length);
  }

  return {
    regions: regions.length,
    withLayout,
    droneCount,
    currentDroneCount: state.ledEditor.droneCount,
    withWorld,
    flatOnly,
    missing,
  };
};

/**
 * The flight phase the editor is currently showing, if the active board is
 * synced to one. Read by the 3D view so selecting a board there follows.
 */
export const getActiveBoardPhaseId = (state: RootState): string | undefined =>
  getActiveBoard(state)?.sourcePhaseId;

/**
 * Phase-synced boards whose times are the client estimate, not the planner's.
 *
 * These are the boards that will play at the wrong instant on the aircraft.
 * The estimate is a straight line over cruise speed and knows nothing about
 * acceleration, avoidance or holds, so it drifts further the longer the show
 * runs — and it looks exactly like a correct timeline.
 */
export const getEstimatedTimingBoards = (state: RootState): string[] =>
  state.ledEditor.boards
    .filter((board) => board.sourcePhaseId && board.timingEstimated !== false)
    .map((board) => board.name);
