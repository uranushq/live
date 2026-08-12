/**
 * @file JR board status model shown in the JR control panel.
 *
 * The firmware's `GET /health` reports its cycle state machine as a string
 * (see `JR_precise_timing/firmware/dr_node/main/app_state.c`):
 *
 *   BOOT → GNSS_WAIT_PPS → WIFI_WAIT → DOWNLOADING → LOAD_SHOW → ARM_WAIT
 *   → PLAYING → (back to DOWNLOADING);  ERROR on unrecoverable failure.
 *
 * The panel reports the four states operators care about — ARM_WAIT,
 * GNSS_PPS_WAIT, DOWNLOADING and ERROR — and passes the remaining firmware
 * states through verbatim rather than mislabelling them.
 */

import { type JRHealth } from './slice';

export const JRBoardStatus = {
  /** 첫 헬스체크 전 / 헬스체크가 꺼져 있고 기록도 없음 */
  UNKNOWN: 'UNKNOWN',
  ARM_WAIT: 'ARM_WAIT',
  GNSS_PPS_WAIT: 'GNSS_PPS_WAIT',
  DOWNLOADING: 'DOWNLOADING',
  ERROR: 'ERROR',
  /** BOOT / WIFI_WAIT / LOAD_SHOW / PLAYING 등 — 원래 이름을 그대로 보여준다 */
  OTHER: 'OTHER',
} as const;

export type JRBoardStatusId =
  (typeof JRBoardStatus)[keyof typeof JRBoardStatus];

/** 펌웨어 상태 문자열 → 패널 상태 */
const FIRMWARE_STATE_TO_STATUS: Record<string, JRBoardStatusId> = {
  ARM_WAIT: JRBoardStatus.ARM_WAIT,
  // 펌웨어 이름은 GNSS_WAIT_PPS, 패널 표기는 GNSS_PPS_WAIT
  GNSS_WAIT_PPS: JRBoardStatus.GNSS_PPS_WAIT,
  GNSS_PPS_WAIT: JRBoardStatus.GNSS_PPS_WAIT,
  DOWNLOADING: JRBoardStatus.DOWNLOADING,
  ERROR: JRBoardStatus.ERROR,
};

export const JR_BOARD_STATUS_LABEL: Record<JRBoardStatusId, string> = {
  [JRBoardStatus.UNKNOWN]: '—',
  [JRBoardStatus.ARM_WAIT]: 'ARM_WAIT',
  [JRBoardStatus.GNSS_PPS_WAIT]: 'GNSS_PPS_WAIT',
  [JRBoardStatus.DOWNLOADING]: 'DOWNLOADING',
  [JRBoardStatus.ERROR]: 'ERROR',
  [JRBoardStatus.OTHER]: 'OTHER',
};

/** MUI Chip color for each status. */
export const JR_BOARD_STATUS_COLOR: Record<
  JRBoardStatusId,
  'default' | 'success' | 'warning' | 'error' | 'info'
> = {
  [JRBoardStatus.UNKNOWN]: 'default',
  [JRBoardStatus.ARM_WAIT]: 'success',
  [JRBoardStatus.GNSS_PPS_WAIT]: 'warning',
  [JRBoardStatus.DOWNLOADING]: 'info',
  [JRBoardStatus.ERROR]: 'error',
  [JRBoardStatus.OTHER]: 'default',
};

export type JRBoardHealthRecord = {
  health?: JRHealth;
  error?: string;
  lastCheckedAt?: number;
};

/**
 * Panel status for one board. A failed request (timeout, 502 from the server
 * proxy, board powered off) is ERROR with a "not responding" detail — from the
 * operator's point of view an unreachable board is an error, not an unknown.
 */
export const deriveJRBoardStatus = (
  record?: JRBoardHealthRecord
): { status: JRBoardStatusId; detail?: string } => {
  if (!record || (!record.health && !record.error)) {
    return { status: JRBoardStatus.UNKNOWN };
  }

  if (record.error) {
    return { status: JRBoardStatus.ERROR, detail: 'not responding' };
  }

  const state = record.health?.state;
  if (!state) {
    return { status: JRBoardStatus.ERROR, detail: 'no state in reply' };
  }

  const mapped = FIRMWARE_STATE_TO_STATUS[state];
  if (mapped) {
    return { status: mapped };
  }

  return { status: JRBoardStatus.OTHER, detail: state };
};
