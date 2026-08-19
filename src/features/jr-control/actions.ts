/**
 * @file Thunks for the JR-board control panel — talking to the Skybrush
 * server's `jr_control` extension at `/api/v1/jr`.
 */

import ky, { HTTPError } from 'ky';

import { showError, showSuccess } from '~/features/snackbar/actions';
import { timelineDurationSec } from '~/features/led-editor/utils';
import { type AppThunk, type RootState } from '~/store/reducers';

import {
  getJRMonitorTargetIps,
  getRecommendedArmStartInSec,
} from './selectors';
import {
  setBoardHealth,
  setBoardHealthBatch,
  setHealthCheckEnabled,
  setLastArmSummary,
  type ArmParams,
  type JRHealth,
} from './slice';

const JR_BASE = '/api/v1/jr';

/**
 * Per-request timeout for `/health`. The server answers instantly either way
 * (it now reads a board's last UDP health push from an in-memory cache
 * instead of proxying a live HTTP call to the board, so this is just a
 * safety net against a wedged server rather than a per-board network wait).
 */
const HEALTH_TIMEOUT_MS = 4500;

/**
 * Human-readable reason for a failed `/api/v1/jr` call.
 *
 * The extension answers failures with `{"error": "<why>"}` and a 4xx/5xx —
 * and that body is the only place the actual cause lives ("no ack from JR
 * board 192.168.11.5:16550 for 'reboot' within 3.0s", "health report is stale
 * (23.4s old)", ...). `HTTPError.message` is just ky's generic
 * "Request failed with status code 502", so read the body first and only fall
 * back to the status line when there is nothing better.
 */
const describeRequestError = async (error: unknown): Promise<string> => {
  if (error instanceof HTTPError) {
    try {
      const body = await error.response.json<{ error?: string }>();
      if (body?.error) {
        return body.error;
      }
    } catch {
      // Not a JSON body (proxy error page, empty response) — fall through.
    }

    return `HTTP ${error.response.status} ${error.response.statusText}`.trim();
  }

  return error instanceof Error ? error.message : String(error);
};

/**
 * Fetches one board's `/health`. A failed request is reported as an `error`
 * field rather than thrown, so a dead board cannot abort a polling round.
 */
const fetchBoardHealth = async (
  ip: string
): Promise<{ ip: string; health?: JRHealth; error?: string }> => {
  try {
    const health = await ky
      .get(`${JR_BASE}/health/${ip}`, { timeout: HEALTH_TIMEOUT_MS, retry: 0 })
      .json<JRHealth>();
    return { ip, health };
  } catch (error) {
    return { ip, error: await describeRequestError(error) };
  }
};

/** Poll a single board's `/health` and store the result. */
export const refreshBoardHealth =
  (ip: string): AppThunk<Promise<void>> =>
  async (dispatch) => {
    dispatch(setBoardHealth(await fetchBoardHealth(ip)));
  };

/** Poll the given board IPs in parallel and store the round in one update. */
export const refreshBoardHealthForIps =
  (ips: string[]): AppThunk<Promise<void>> =>
  async (dispatch) => {
    if (ips.length === 0) {
      return;
    }

    dispatch(setBoardHealthBatch(await Promise.all(ips.map(fetchBoardHealth))));
  };

/**
 * Poll every watched board — the ones derived from connected drones plus the
 * manually added IPs.
 */
export const refreshAllBoards =
  (): AppThunk<Promise<void>> => async (dispatch, getState) => {
    const state: RootState = getState();
    await dispatch(refreshBoardHealthForIps(getJRMonitorTargetIps(state)));
  };

/** Reboot a board. */
export const rebootBoard =
  (ip: string): AppThunk<Promise<void>> =>
  async (dispatch) => {
    try {
      await ky.post(`${JR_BASE}/reboot/${ip}`, { timeout: 8000 }).json();
      dispatch(showSuccess(`Reboot requested for ${ip}`));
    } catch (error) {
      dispatch(
        showError(`Reboot failed for ${ip}: ${await describeRequestError(error)}`)
      );
    }
  };

/** Trigger a re-download of the show file on a board. */
export const redownloadBoard =
  (ip: string): AppThunk<Promise<void>> =>
  async (dispatch) => {
    try {
      await ky.post(`${JR_BASE}/redownload/${ip}`, { timeout: 8000 }).json();
      dispatch(showSuccess(`Re-download requested for ${ip}`));
    } catch (error) {
      dispatch(
        showError(
          `Re-download failed for ${ip}: ${await describeRequestError(error)}`
        )
      );
    }
  };

/**
 * Solid colour for the LED wiring check. `off` wins over the channels — the
 * firmware looks for the word "off" before it parses any numbers.
 */
export type JRLedColor = {
  red?: number;
  green?: number;
  blue?: number;
  white?: number;
  off?: boolean;
};

/** Preset colours offered by the panel; `white` doubles as "everything on". */
export const JR_LED_PRESETS: Array<{ id: string; label: string; color: JRLedColor }> =
  [
    { id: 'white', label: '백색', color: { red: 255, green: 255, blue: 255 } },
    { id: 'red', label: '적', color: { red: 255, green: 0, blue: 0 } },
    { id: 'green', label: '녹', color: { red: 0, green: 255, blue: 0 } },
    { id: 'blue', label: '청', color: { red: 0, green: 0, blue: 255 } },
  ];

/** The colour the board reports it actually applied, e.g. "led 255,0,0,0". */
const ledActionOf = (reply: unknown): string =>
  (reply as { action?: string })?.action ?? 'led';

/**
 * Light one board's LEDs solid (or turn them off) for a wiring check.
 *
 * Boards ignore this while PLAYING, so it fails with a timeout during a show —
 * that is the firmware protecting the frame task's I2C bus, not a fault.
 */
export const setBoardLed =
  (ip: string, color: JRLedColor = {}): AppThunk<Promise<void>> =>
  async (dispatch) => {
    try {
      const reply = await ky
        .post(`${JR_BASE}/led/${ip}`, { json: color, timeout: 8000 })
        .json();
      dispatch(showSuccess(`${ip}: ${ledActionOf(reply)}`));
    } catch (error) {
      dispatch(
        showError(`LED failed for ${ip}: ${await describeRequestError(error)}`)
      );
    }
  };

/**
 * Apply one colour to every watched board at once.
 *
 * Reports a single summary instead of one snackbar per board — with a full
 * fleet that would otherwise bury the screen. Boards are addressed in parallel
 * and a failure on one never blocks the rest.
 */
export const setAllBoardsLed =
  (color: JRLedColor = {}): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    const state: RootState = getState();
    const ips = getJRMonitorTargetIps(state);
    if (ips.length === 0) {
      dispatch(showError('LED를 보낼 보드가 없습니다.'));
      return;
    }

    const results = await Promise.all(
      ips.map(async (ip) => {
        try {
          await ky.post(`${JR_BASE}/led/${ip}`, { json: color, timeout: 8000 }).json();
          return { ip, ok: true as const };
        } catch (error) {
          return { ip, ok: false as const, why: await describeRequestError(error) };
        }
      })
    );

    const failed = results.filter((r) => !r.ok);
    const what = color.off ? '소등' : '점등';
    if (failed.length === 0) {
      dispatch(showSuccess(`전체 ${what} 완료 (${results.length}대).`));
      return;
    }

    // Name a few of the offenders; the rest would not fit in a snackbar.
    const sample = failed
      .slice(0, 3)
      .map((r) => r.ip)
      .join(', ');
    const more = failed.length > 3 ? ` 외 ${failed.length - 3}대` : '';
    dispatch(
      showError(
        `전체 ${what}: ${results.length - failed.length}/${results.length} 성공. ` +
          `실패 ${sample}${more} — ${(failed[0] as { why: string }).why}`
      )
    );
  };

/** Broadcast an ARM sync packet to all boards over UDP. */
export const broadcastArm =
  (): AppThunk<Promise<void>> => async (dispatch, getState) => {
    const state: RootState = getState();
    // FPS and frame count are properties of the authored LED show, so derive
    // them from it rather than asking the user to keep them in sync by hand.
    const { fps, boards: ledBoards } = state.ledEditor;
    const frameCount = Math.max(1, Math.round(timelineDurationSec(ledBoards) * fps));

    // Resolve start delay: 'auto' follows the show (see
    // `getRecommendedArmStartInSec` — the path delay for a legacy LED-only
    // show, ~0 once the boards are synced to the flight phases), 'manual' uses
    // the hand-entered value. In auto mode with nothing to go on, refuse to
    // broadcast rather than silently sending a wrong (default) value.
    const { startInMode, startIn: manualStartIn } = state.jrControl.arm;
    let startIn = manualStartIn;
    if (startInMode === 'auto') {
      const recommended = getRecommendedArmStartInSec(state);
      if (recommended == null) {
        dispatch(
          showError('자동(start-in) 모드인데 path 값이 없습니다. 매뉴얼로 전환해 직접 입력하세요.')
        );
        dispatch(setLastArmSummary('ARM 취소: path 없음 (자동 모드)'));
        return;
      }
      startIn = recommended;
    }

    const arm: ArmParams = {
      ...state.jrControl.arm,
      startIn,
      fpsNum: fps,
      fpsDen: 1,
      frameCount,
    };
    try {
      const summary = await ky
        .post(`${JR_BASE}/arm`, { json: arm, timeout: 15_000 })
        .json<{ sent: number; startTimeUs: number }>();
      dispatch(
        setLastArmSummary(
          `ARM sent ×${summary.sent}, start_time=${summary.startTimeUs} µs`
        )
      );
      // ARM 이후 보드는 PLAYING 으로 넘어가 프레임 타이밍이 중요해진다 —
      // 폴링이 HTTP 서버를 계속 두드리지 않도록 헬스체크를 끈다. 다시 보려면
      // JR control 패널의 토글로 켠다.
      dispatch(
        setHealthCheckEnabled({
          enabled: false,
          reason: 'ARM 브로드캐스트를 보내 헬스체크를 멈췄습니다.',
        })
      );
      dispatch(showSuccess(`ARM broadcast sent (${summary.sent} packets).`));
    } catch (error) {
      const message = await describeRequestError(error);
      dispatch(setLastArmSummary(`ARM failed: ${message}`));
      dispatch(showError(`ARM broadcast failed: ${message}`));
    }
  };
