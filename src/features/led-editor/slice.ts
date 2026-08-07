/**
 * @file Redux slice storing the state of the LED-show editor.
 *
 * Drone count, LEDs-per-drone and FPS are global; each board owns its own
 * formation (rows × cols) and stores colours per drone so drones keep their LED
 * contents intact when a board's formation changes.
 */

import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

import {
  type Board,
  type Clipboard,
  type FormationRegion,
  type LedEditorState,
  type LedsPerDrone,
  type RGB,
  type UploadStatus,
} from './types';
import {
  BLACK,
  DEFAULT_BOARD_DURATION_SEC,
  defaultFormation,
  droneAndLocal,
  gridDimensions,
  indexToXY,
  makeBlackDrone,
  makeBlackDrones,
  resizeDrone,
  timelineDurationSec,
  xyToIndex,
} from './utils';

const DEFAULT_LEDS_PER_DRONE: LedsPerDrone = 3;
const DEFAULT_DRONE_COUNT = 4;

const initialState: LedEditorState = {
  ledsPerDrone: DEFAULT_LEDS_PER_DRONE,
  droneCount: DEFAULT_DRONE_COUNT,
  fps: 30,
  boards: [],
  selectedBoardIds: [],
  selectedPixels: [],
  clipboard: undefined,
  boardClipboard: undefined,
  activeColor: [255, 255, 255],
  playheadSec: 0,
  playing: false,
  threeDSync: true,
  formationTimeline: [],
  ledStartDelaySec: null,
  upload: { state: 'idle' },
};

/** The board the user is currently editing (the last one selected), if any. */
const activeBoard = (state: LedEditorState): Board | undefined => {
  const id = state.selectedBoardIds[state.selectedBoardIds.length - 1];
  return id ? state.boards.find((b) => b.id === id) : undefined;
};

/** Canvas width of the active board's formation. */
const activeWidth = (state: LedEditorState): number => {
  const board = activeBoard(state);
  return (board?.cols ?? 1) * state.ledsPerDrone;
};

/** Read a colour from the active board by canvas index. */
const readPixel = (state: LedEditorState, canvasIndex: number): RGB => {
  const board = activeBoard(state);
  if (!board) {
    return [...BLACK];
  }
  const { drone, local } = droneAndLocal(
    canvasIndex,
    board.cols,
    state.ledsPerDrone
  );
  return [...(board.drones[drone]?.[local] ?? BLACK)] as RGB;
};

/** Write a colour into the active board at a canvas index. */
const writePixel = (
  state: LedEditorState,
  canvasIndex: number,
  color: RGB
): void => {
  const board = activeBoard(state);
  if (!board) {
    return;
  }
  const { drone, local } = droneAndLocal(
    canvasIndex,
    board.cols,
    state.ledsPerDrone
  );
  if (drone >= 0 && drone < state.droneCount && board.drones[drone]) {
    board.drones[drone]![local] = [...color];
  }
};

const cloneBoardDrones = (board: Board): RGB[][] =>
  board.drones.map((drone) => drone.map((p) => [...p] as RGB));

const { actions, reducer } = createSlice({
  name: 'led-editor',
  initialState,
  reducers: {
    setLedsPerDrone(state, action: PayloadAction<LedsPerDrone>) {
      const oldK = state.ledsPerDrone;
      const newK = action.payload;
      if (oldK === newK) {
        return;
      }
      state.ledsPerDrone = newK;
      for (const board of state.boards) {
        board.drones = board.drones.map((drone) =>
          resizeDrone(drone, oldK, newK)
        );
      }
      state.selectedPixels = [];
      state.clipboard = undefined;
    },

    setDroneCount(state, action: PayloadAction<number>) {
      const count = Math.max(1, Math.round(action.payload));
      state.droneCount = count;
      for (const board of state.boards) {
        // Grow / shrink the per-drone sets to match the new count.
        if (board.drones.length < count) {
          while (board.drones.length < count) {
            board.drones.push(makeBlackDrone(state.ledsPerDrone));
          }
        } else if (board.drones.length > count) {
          board.drones.length = count;
        }
        // Ensure the formation has room for every drone.
        if (board.rows * board.cols < count) {
          const fit = defaultFormation(count);
          board.rows = fit.rows;
          board.cols = fit.cols;
        }
      }
      state.selectedPixels = [];
    },

    setFps(state, action: PayloadAction<number>) {
      state.fps = Math.max(1, Math.round(action.payload));
    },

    /**
     * Change a board's formation. Editing one axis re-fits the other to the
     * (global) drone count, so the formation always holds every drone.
     */
    setBoardArrangement(
      state,
      action: PayloadAction<{ id: string; rows?: number; cols?: number }>
    ) {
      const board = state.boards.find((b) => b.id === action.payload.id);
      if (!board) {
        return;
      }
      const count = state.droneCount;
      if (action.payload.cols !== undefined) {
        const cols = Math.max(1, Math.round(action.payload.cols));
        board.cols = cols;
        board.rows = Math.max(1, Math.ceil(count / cols));
      } else if (action.payload.rows !== undefined) {
        const rows = Math.max(1, Math.round(action.payload.rows));
        board.rows = rows;
        board.cols = Math.max(1, Math.ceil(count / rows));
      }
      state.selectedPixels = [];
    },

    setActiveColor(state, action: PayloadAction<RGB>) {
      state.activeColor = action.payload;
    },

    addBoard(state, action: PayloadAction<{ name?: string } | undefined>) {
      const fit = defaultFormation(state.droneCount);
      const startSec = timelineDurationSec(state.boards);
      const board: Board = {
        id: nanoid(),
        name: action.payload?.name ?? `Board ${state.boards.length + 1}`,
        rows: fit.rows,
        cols: fit.cols,
        drones: makeBlackDrones(state.droneCount, state.ledsPerDrone),
        startSec,
        durationSec: DEFAULT_BOARD_DURATION_SEC,
      };
      state.boards.push(board);
      state.selectedBoardIds = [board.id];
      state.selectedPixels = [];
    },

    /**
     * 이미지 → 점 formation에서 추출한 드론별 색으로 보드를 만들거나
     * 갱신한다. 같은 이름의 보드가 있으면 색만 교체(타임라인 위치 유지),
     * 없으면 타임라인 끝에 새로 추가한다. 각 드론의 k×k 패널은 그 드론이
     * 맡은 이미지 점의 색으로 단색 채움; 색이 없는 드론은 검정(꺼짐).
     */
    upsertImageBoard(
      state,
      action: PayloadAction<{
        name: string;
        colors: Array<RGB | null | undefined>;
        durationSec?: number;
      }>
    ) {
      const { name, colors, durationSec } = action.payload;
      if (!name || !Array.isArray(colors) || colors.length === 0) {
        return;
      }

      // 드론 수가 모자라면 전역 드론 수를 늘리고 기존 보드도 맞춰 확장
      // (setDroneCount 와 동일한 규칙).
      if (colors.length > state.droneCount) {
        state.droneCount = colors.length;
        for (const board of state.boards) {
          while (board.drones.length < state.droneCount) {
            board.drones.push(makeBlackDrone(state.ledsPerDrone));
          }
          if (board.rows * board.cols < state.droneCount) {
            const fit = defaultFormation(state.droneCount);
            board.rows = fit.rows;
            board.cols = fit.cols;
          }
        }
      }

      const k = state.ledsPerDrone;
      const drones = Array.from({ length: state.droneCount }, (_, i) => {
        const c = colors[i];
        if (!Array.isArray(c) || c.length !== 3) {
          return makeBlackDrone(k);
        }
        const solid: RGB = [c[0], c[1], c[2]];
        return Array.from({ length: k * k }, () => [...solid] as RGB);
      });

      const existing = state.boards.find((b) => b.name === name);
      if (existing) {
        existing.drones = drones;
        if (durationSec !== undefined) {
          existing.durationSec = Math.max(0.1, durationSec);
        }
        state.selectedBoardIds = [existing.id];
      } else {
        const fit = defaultFormation(state.droneCount);
        const board: Board = {
          id: nanoid(),
          name,
          rows: fit.rows,
          cols: fit.cols,
          drones,
          startSec: timelineDurationSec(state.boards),
          durationSec: Math.max(0.1, durationSec ?? DEFAULT_BOARD_DURATION_SEC),
        };
        state.boards.push(board);
        state.selectedBoardIds = [board.id];
      }
      state.selectedPixels = [];
    },

    removeBoard(state, action: PayloadAction<string>) {
      state.boards = state.boards.filter((b) => b.id !== action.payload);
      state.selectedBoardIds = state.selectedBoardIds.filter(
        (id) => id !== action.payload
      );
      state.selectedPixels = [];
    },

    removeSelectedBoards(state) {
      const selected = new Set(state.selectedBoardIds);
      state.boards = state.boards.filter((b) => !selected.has(b.id));
      state.selectedBoardIds = [];
      state.selectedPixels = [];
    },

    selectBoard(state, action: PayloadAction<string | undefined>) {
      state.selectedBoardIds = action.payload ? [action.payload] : [];
      state.selectedPixels = [];
    },

    toggleBoardSelection(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.selectedBoardIds.includes(id)) {
        state.selectedBoardIds = state.selectedBoardIds.filter((x) => x !== id);
      } else {
        state.selectedBoardIds.push(id);
      }
      state.selectedPixels = [];
    },

    setSelectedBoards(state, action: PayloadAction<string[]>) {
      state.selectedBoardIds = action.payload;
      state.selectedPixels = [];
    },

    copyBoards(state) {
      const selected = new Set(state.selectedBoardIds);
      const copied = state.boards
        .filter((b) => selected.has(b.id))
        .sort((a, b) => a.startSec - b.startSec)
        .map((b) => ({ ...b, drones: cloneBoardDrones(b) }));
      state.boardClipboard = copied.length > 0 ? copied : state.boardClipboard;
    },

    pasteBoards(state) {
      const clip = state.boardClipboard;
      if (!clip || clip.length === 0) {
        return;
      }
      const base = timelineDurationSec(state.boards);
      const clipStart = Math.min(...clip.map((b) => b.startSec));
      const newIds: string[] = [];
      for (const board of clip) {
        const id = nanoid();
        newIds.push(id);
        state.boards.push({
          ...board,
          id,
          name: `${board.name} copy`,
          startSec: base + (board.startSec - clipStart),
          drones: board.drones.map((drone) => drone.map((p) => [...p] as RGB)),
        });
      }
      state.selectedBoardIds = newIds;
      state.selectedPixels = [];
    },

    renameBoard(state, action: PayloadAction<{ id: string; name: string }>) {
      const board = state.boards.find((b) => b.id === action.payload.id);
      if (board) {
        board.name = action.payload.name;
      }
    },

    setBoardTiming(
      state,
      action: PayloadAction<{
        id: string;
        startSec?: number;
        durationSec?: number;
      }>
    ) {
      const board = state.boards.find((b) => b.id === action.payload.id);
      if (!board) {
        return;
      }
      if (action.payload.startSec !== undefined) {
        board.startSec = Math.max(0, action.payload.startSec);
      }
      if (action.payload.durationSec !== undefined) {
        board.durationSec = Math.max(0.1, action.payload.durationSec);
      }
    },

    /** Paint canvas pixels of the active board with a colour. */
    paintPixels(
      state,
      action: PayloadAction<{ indices: number[]; color: RGB }>
    ) {
      for (const index of action.payload.indices) {
        writePixel(state, index, action.payload.color);
      }
    },

    setSelectedPixels(state, action: PayloadAction<number[]>) {
      state.selectedPixels = action.payload;
    },

    clearSelection(state) {
      state.selectedPixels = [];
    },

    /** Copy the bounding box of the current selection into the clipboard. */
    copySelection(state) {
      const board = activeBoard(state);
      if (!board || state.selectedPixels.length === 0) {
        return;
      }
      const width = activeWidth(state);
      const coords = state.selectedPixels.map((i) => indexToXY(i, width));
      const minX = Math.min(...coords.map((c) => c.x));
      const maxX = Math.max(...coords.map((c) => c.x));
      const minY = Math.min(...coords.map((c) => c.y));
      const maxY = Math.max(...coords.map((c) => c.y));
      const boxW = maxX - minX + 1;
      const boxH = maxY - minY + 1;
      const pixels: RGB[] = [];
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          pixels.push(readPixel(state, xyToIndex(x, y, width)));
        }
      }
      state.clipboard = { width: boxW, height: boxH, pixels };
    },

    /**
     * Paste the clipboard onto the active board.
     * - Multi-bulb selection: tile the clipboard across the whole selection
     *   (a single copied colour fills every selected bulb).
     * - 0–1 bulbs selected: stamp the clipboard block at the anchor.
     */
    pasteClipboard(
      state,
      action: PayloadAction<{ anchorIndex?: number } | undefined>
    ) {
      const board = activeBoard(state);
      const clipboard: Clipboard | undefined = state.clipboard;
      if (!board || !clipboard) {
        return;
      }
      const width = activeWidth(state);
      const height = board.rows * state.ledsPerDrone;
      const selection = state.selectedPixels;

      if (selection.length > 1) {
        const coords = selection.map((i) => indexToXY(i, width));
        const minX = Math.min(...coords.map((c) => c.x));
        const minY = Math.min(...coords.map((c) => c.y));
        for (const index of selection) {
          const { x, y } = indexToXY(index, width);
          const cx = (x - minX) % clipboard.width;
          const cy = (y - minY) % clipboard.height;
          writePixel(
            state,
            index,
            [...clipboard.pixels[cy * clipboard.width + cx]!] as RGB
          );
        }
        return;
      }

      let anchorIndex = action.payload?.anchorIndex;
      if (anchorIndex === undefined) {
        if (selection.length === 0) {
          return;
        }
        anchorIndex = selection[0];
      }
      const { x: ax, y: ay } = indexToXY(anchorIndex!, width);
      for (let y = 0; y < clipboard.height; y++) {
        for (let x = 0; x < clipboard.width; x++) {
          const tx = ax + x;
          const ty = ay + y;
          if (tx < width && ty < height) {
            writePixel(
              state,
              xyToIndex(tx, ty, width),
              [...clipboard.pixels[y * clipboard.width + x]!] as RGB
            );
          }
        }
      }
    },

    setPlayhead(state, action: PayloadAction<number>) {
      state.playheadSec = Math.max(0, action.payload);
    },

    setPlaying(state, action: PayloadAction<boolean>) {
      state.playing = action.payload;
    },

    setThreeDSync(state, action: PayloadAction<boolean>) {
      state.threeDSync = action.payload;
    },

    /** Mirror the 3D view's formation hold-windows + LED start delay. */
    setFormationSync(
      state,
      action: PayloadAction<{
        timeline: FormationRegion[];
        delaySec: number | null;
      }>
    ) {
      state.formationTimeline = action.payload.timeline;
      state.ledStartDelaySec = action.payload.delaySec;
    },

    setUploadStatus(state, action: PayloadAction<UploadStatus>) {
      state.upload = action.payload;
    },

    /**
     * Replace the whole LED show from an imported project file
     * (`uranus-show-project` format). Every field is coerced/clamped so a
     * hand-edited or partially corrupted file cannot produce an invalid
     * editor state; missing pixels are filled with black.
     */
    importShow(
      state,
      action: PayloadAction<{
        ledsPerDrone?: unknown;
        droneCount?: unknown;
        fps?: unknown;
        boards?: unknown;
      }>
    ) {
      const payload = action.payload ?? {};
      const k: LedsPerDrone = Number(payload.ledsPerDrone) === 4 ? 4 : 3;
      const droneCount = Math.max(
        1,
        Math.round(Number(payload.droneCount) || state.droneCount)
      );
      const fps = Number(payload.fps);

      state.ledsPerDrone = k;
      state.droneCount = droneCount;
      if (Number.isFinite(fps) && fps > 0) {
        state.fps = Math.min(120, fps);
      }

      const clampChannel = (value: unknown): number =>
        Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
      const pixelCount = k * k;
      const boards: Board[] = [];
      for (const raw of Array.isArray(payload.boards) ? payload.boards : []) {
        if (!raw || typeof raw !== 'object') continue;
        const b = raw as Record<string, unknown>;
        const rawId = b['id'];
        const rawName = b['name'];
        const rawDrones = Array.isArray(b['drones'])
          ? (b['drones'] as unknown[])
          : [];
        const drones: RGB[][] = [];
        for (let i = 0; i < droneCount; i += 1) {
          const src = Array.isArray(rawDrones[i]) ? (rawDrones[i] as unknown[]) : [];
          const drone: RGB[] = [];
          for (let j = 0; j < pixelCount; j += 1) {
            const px = Array.isArray(src[j]) ? (src[j] as unknown[]) : BLACK;
            drone.push([
              clampChannel(px[0]),
              clampChannel(px[1]),
              clampChannel(px[2]),
            ]);
          }
          drones.push(drone);
        }
        boards.push({
          id: typeof rawId === 'string' && rawId ? rawId : nanoid(),
          name:
            typeof rawName === 'string' && rawName
              ? rawName
              : `board-${boards.length + 1}`,
          rows: Math.max(1, Math.round(Number(b['rows']) || 1)),
          cols: Math.max(1, Math.round(Number(b['cols']) || 1)),
          drones,
          startSec: Math.max(0, Number(b['startSec']) || 0),
          durationSec: Math.max(
            0.1,
            Number(b['durationSec']) || DEFAULT_BOARD_DURATION_SEC
          ),
        });
      }
      state.boards = boards;
      state.selectedBoardIds = [];
      state.selectedPixels = [];
      state.playheadSec = 0;
      state.playing = false;
      state.upload = { state: 'idle' };
    },
  },
});

export const {
  setLedsPerDrone,
  setDroneCount,
  setFps,
  setBoardArrangement,
  setActiveColor,
  addBoard,
  upsertImageBoard,
  removeBoard,
  removeSelectedBoards,
  selectBoard,
  toggleBoardSelection,
  setSelectedBoards,
  copyBoards,
  pasteBoards,
  renameBoard,
  setBoardTiming,
  paintPixels,
  setSelectedPixels,
  clearSelection,
  copySelection,
  pasteClipboard,
  setPlayhead,
  setPlaying,
  setThreeDSync,
  setFormationSync,
  setUploadStatus,
  importShow,
} = actions;

export default reducer;
