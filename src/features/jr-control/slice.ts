/**
 * @file Redux slice for the JR-board control panel (scaffold).
 *
 * Tracks the list of JR boards to manage, their last-known health, and the
 * parameters for the ARM broadcast. Health polling and broadcasting are
 * performed by the Skybrush server's `jr_control` extension via `/api/v1/jr`.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type JRHealth = {
  state?: string;
  pps?: { state?: string; count?: number; ticks_per_sec?: number };
  show?: { loaded?: boolean; frames?: number; fps?: number };
  uptime_ms?: number;
};

export type JRBoardEntry = {
  ip: string;
};

/** Last poll result for one IP, whether the board is auto-derived or manual. */
export type JRBoardHealthEntry = {
  /** Last fetched health, or undefined if the request failed. */
  health?: JRHealth;
  error?: string;
  lastCheckedAt?: number;
};

/**
 * Operator-owned ARM settings.
 *
 * Not every field here reaches the boards, and the ones that do not are
 * deliberately absent: the server replaces the show's length and frame rate
 * with what the boards report in their own health pushes
 * (`derive_show_params`), so a controller-side guess was only ever misleading.
 * See `ArmRequest` in `actions.ts` for what is actually put on the wire.
 */
export type ArmParams = {
  /**
   * 'auto'  -> startIn follows the authored show's LED start delay (path);
   * 'manual' -> startIn is the hand-entered value below.
   */
  startInMode: 'auto' | 'manual';
  startIn: number;
  fileId: number;
  showId: number;
  repeat: number;
};

type JRControlSliceState = {
  /** Manually added boards, on top of the ones derived from connected drones. */
  boards: JRBoardEntry[];
  /** Last poll result per board IP. */
  healthByIp: Record<string, JRBoardHealthEntry>;
  healthCheck: {
    /** 5초 주기 폴링 on/off. ARM 브로드캐스트를 보내면 자동으로 꺼진다. */
    enabled: boolean;
    /** 자동으로 꺼진 이유 (사용자에게 왜 멈췄는지 알려주려고 보관) */
    disabledReason?: string;
  };
  arm: ArmParams;
  polling: boolean;
  lastArmSummary?: string;
};

const initialState: JRControlSliceState = {
  boards: [],
  healthByIp: {},
  healthCheck: {
    enabled: true,
  },
  arm: {
    startInMode: 'auto',
    startIn: 5,
    fileId: 99,
    showId: 1,
    repeat: 5,
  },
  polling: false,
};

const { actions, reducer } = createSlice({
  name: 'jr-control',
  initialState,
  reducers: {
    addBoard(state, action: PayloadAction<string>) {
      const ip = action.payload.trim();
      if (ip && !state.boards.some((b) => b.ip === ip)) {
        state.boards.push({ ip });
      }
    },
    removeBoard(state, action: PayloadAction<string>) {
      state.boards = state.boards.filter((b) => b.ip !== action.payload);
    },
    setBoardHealth(
      state,
      action: PayloadAction<{ ip: string; health?: JRHealth; error?: string }>
    ) {
      const { ip, health, error } = action.payload;
      state.healthByIp[ip] = { health, error, lastCheckedAt: Date.now() };
    },

    /**
     * Stores a whole polling round at once. One store update per round keeps a
     * 100-drone fleet from re-rendering the table 100 times every 5 seconds.
     */
    setBoardHealthBatch(
      state,
      action: PayloadAction<
        Array<{ ip: string; health?: JRHealth; error?: string }>
      >
    ) {
      const now = Date.now();
      for (const { ip, health, error } of action.payload) {
        state.healthByIp[ip] = { health, error, lastCheckedAt: now };
      }
    },

    clearBoardHealth(state) {
      state.healthByIp = {};
    },

    /**
     * Turns the 5 s health poll on/off. `reason` explains an automatic stop
     * (ARM broadcast) so the panel can tell the operator why it went quiet.
     */
    setHealthCheckEnabled(
      state,
      action: PayloadAction<boolean | { enabled: boolean; reason?: string }>
    ) {
      const payload = action.payload;
      const enabled =
        typeof payload === 'boolean' ? payload : Boolean(payload?.enabled);
      const reason = typeof payload === 'boolean' ? undefined : payload?.reason;

      state.healthCheck.enabled = enabled;
      state.healthCheck.disabledReason = enabled ? undefined : reason;
    },
    setArmParams(state, action: PayloadAction<Partial<ArmParams>>) {
      state.arm = { ...state.arm, ...action.payload };
    },
    setPolling(state, action: PayloadAction<boolean>) {
      state.polling = action.payload;
    },
    setLastArmSummary(state, action: PayloadAction<string | undefined>) {
      state.lastArmSummary = action.payload;
    },
  },
});

export const {
  addBoard,
  removeBoard,
  setBoardHealth,
  setBoardHealthBatch,
  clearBoardHealth,
  setHealthCheckEnabled,
  setArmParams,
  setPolling,
  setLastArmSummary,
} = actions;

export default reducer;
