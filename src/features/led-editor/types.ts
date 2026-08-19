/**
 * @file Type definitions for the LED-show editor feature.
 *
 * Each drone carries a `k×k` LED panel (`ledsPerDrone = k`). The **drone count**
 * and **FPS** are global, fixed properties of the show. Each **board**, however,
 * owns its own **formation** (`rows × cols`) so the same dance can be shown in
 * different formations as the flight evolves.
 *
 * Crucially, colours are stored **per drone** (each drone's `k×k` set), not as a
 * flat canvas. Drones are numbered in reading order (left→right, top→bottom), so
 * when a board's formation changes the drones simply re-flow into the new grid
 * while keeping their LED contents intact as a unit.
 */

/** An RGB triplet, each channel in the 0..255 range. */
export type RGB = [number, number, number];

/** Number of LEDs per drone edge (so each drone is `k×k`). */
export type LedsPerDrone = 3 | 4;

/** One drone's LED colours, row-major, length `k*k`. */
export type DronePixels = RGB[];

/**
 * A drone's position on the audience-facing plane, in metres, frozen from the
 * flight phase this board was created from. The audience stands south looking
 * at +x, so `x` is world *-y* (their left is +y) and `y` is world *-z* (larger
 * altitude draws higher). Same convention as `layoutDotsOnPlane`; flipping
 * either sign renders every synced board mirrored.
 */
export type DroneLayoutPoint = { x: number; y: number };

/** A still frame placed on the timeline, with its own formation. */
export type Board = {
  id: string;
  name: string;
  /** Formation rows for this board. */
  rows: number;
  /** Formation columns for this board. */
  cols: number;
  /** Per-drone colour sets, length `droneCount`; each entry is `k*k` long. */
  drones: DronePixels[];
  startSec: number;
  durationSec: number;
  /**
   * Id of the 3D view's formation phase this board is synced to, or undefined
   * for a hand-made board (and for a board whose phase was later deleted — it
   * is demoted, never removed). Purely a join key: the compiler never sees it.
   */
  sourcePhaseId?: string;
  /**
   * Where each drone sits in the phase's real formation, index-aligned with
   * `drones` (length `droneCount`; null for drones the phase does not place).
   * Present only on phase-synced boards; when set, the bulb grid lays the
   * drones out in this shape instead of the dense `rows × cols` grid.
   */
  droneLayout?: Array<DroneLayoutPoint | null>;
};

/**
 * One formation's hold window on the shared timeline (seconds), mirrored from
 * the 3D view's path so it can be drawn as a coloured region on the LED
 * timeline / simulator.
 */
export type FormationRegion = {
  name: string;
  startSec: number;
  endSec: number;
  color: string;
  /**
   * Region kind: undefined for a user formation's hold window; `'transit'`
   * for planner-reported non-formation segments (staging-grid entry,
   * return-to-start) so consumers can style or skip them.
   */
  kind?: 'transit';
  /**
   * Stable id of the 3D view's formation phase this region mirrors, used to
   * join a phase to its LED board. Absent on `'transit'` regions (they have no
   * authored phase). Phase *names* are not usable as a key — unnamed phases are
   * all sent to the planner as the literal string `phase`.
   */
  phaseId?: string;
};

/** A rectangular block of pixels held on the editor clipboard. */
export type Clipboard = {
  width: number;
  height: number;
  pixels: RGB[];
};

/** Per-drone result of a compile + upload request. */
export type UploadTileResult = {
  droneIndex: number;
  bytes: number;
  filename?: string;
  url?: string;
  message?: string;
  error?: string;
};

export type UploadState = 'idle' | 'running' | 'done' | 'error';

export type UploadStatus = {
  state: UploadState;
  message?: string;
  totalFrames?: number;
  tiles?: UploadTileResult[];
};

export type LedEditorState = {
  // --- global show properties (fixed at the top of the editor) ---
  ledsPerDrone: LedsPerDrone;
  droneCount: number;
  fps: number;

  // --- boards ---
  boards: Board[];

  // --- editor UI state ---
  /**
   * Selected timeline boards, in click order. The last entry is the "active"
   * board shown and edited in the bulb grid.
   */
  selectedBoardIds: string[];
  /**
   * Selected bulbs as *canvas indices* within the active board's current
   * formation (`index = y * (cols*k) + x`).
   */
  selectedPixels: number[];
  /** Pixel colours copied from the bulb grid. */
  clipboard: Clipboard | undefined;
  /** Boards copied from the timeline. */
  boardClipboard: Board[] | undefined;
  activeColor: RGB;
  /** Shared playback time (seconds) for the timeline scrubber and simulator. */
  playheadSec: number;
  /** Whether the show is currently playing back. */
  playing: boolean;
  /**
   * Whether the 3D view mirrors LED-show playback. When on, the 3D drones and
   * their pixel panels follow the shared playhead; when off, the pixel panels
   * are hidden and the 3D view plays independently.
   */
  threeDSync: boolean;
  /**
   * Formation hold-windows mirrored from the 3D view while 3D sync is on, shown
   * as coloured regions on the LED timeline/simulator. Empty when sync is off
   * or there are no formations.
   */
  formationTimeline: FormationRegion[];
  /**
   * Each phase's real formation shape, keyed by phase id and mirrored from the
   * 3D view alongside `formationTimeline`. Read only when the user presses
   * "path와 동기화", which freezes a copy onto the boards it creates. Empty
   * when no path is loaded.
   */
  phaseLayouts: Record<string, Array<DroneLayoutPoint | null>>;
  /**
   * Recommended delay (seconds) from drone-dance start until the first
   * formation is formed — used as the JR-Control ARM "start in" default. Null
   * when unknown (no formations / sync off).
   */
  ledStartDelaySec: number | null;
  upload: UploadStatus;
};
