/**
 * @file Thunks for the JR-board control panel — talking to the Skybrush
 * server's `jr_control` extension at `/api/v1/jr`.
 */

import ky, { HTTPError } from 'ky';

import {
  showError,
  showNotification,
  showSuccess,
} from '~/features/snackbar/actions';
import { MessageSemantics } from '~/features/snackbar/types';
import {
  areStartConditionsSyncedWithServer,
  didStartConditionSyncFail,
  getShowStartTime,
} from '~/features/show/selectors';
import { type AppThunk, type RootState } from '~/store/reducers';

import {
  getJRArmReadiness,
  getJRMonitorTargetIps,
  getRecommendedArmStartInSec,
} from './selectors';
import {
  setBoardHealth,
  setBoardHealthBatch,
  setHealthCheckEnabled,
  setLastArmSummary,
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

/**
 * Body of `POST /api/v1/jr/arm`, narrowed to what actually reaches the boards.
 *
 * `fpsNum`/`fpsDen`/`frameCount` are deliberately absent: the server replaces
 * them with what the boards report in their own health pushes
 * (`derive_show_params`), so sending them only made it look as though the
 * controller had chosen the show length. Spreading the whole `ArmParams` also
 * leaked `startInMode`, which is a panel concept the server knows nothing
 * about.
 *
 * Timing rides on exactly one of two fields:
 *
 * - `startIn` — a delay the server resolves against *its own* clock.
 * - `startAtUnixSec` — an absolute instant; see {@link armForShowStart}.
 */
type ArmRequest = {
  showId: number;
  fileId: number;
  repeat: number;
  startIn?: number;
  startAtUnixSec?: number;
};

/**
 * Broadcast an ARM sync packet to all boards over UDP.
 *
 * Pass `startAtUnixSec` to pin playback to an absolute instant; omit it to let
 * the panel's auto/manual start-in setting decide, which is what the standalone
 * ARM button does.
 */
export const broadcastArm =
  ({ startAtUnixSec }: { startAtUnixSec?: number } = {}): AppThunk<
    Promise<void>
  > =>
  async (dispatch, getState) => {
    const state: RootState = getState();
    const { showId, fileId, repeat } = state.jrControl.arm;
    const request: ArmRequest = { showId, fileId, repeat };

    if (startAtUnixSec === undefined) {
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

      request.startIn = startIn;
    } else {
      request.startAtUnixSec = startAtUnixSec;
    }

    try {
      const summary = await ky
        .post(`${JR_BASE}/arm`, { json: request, timeout: 15_000 })
        .json<{
          sent: number;
          startTimeUs: number;
          startTimeSource?: 'absolute' | 'relative';
        }>();
      dispatch(
        setLastArmSummary(
          `ARM sent ×${summary.sent}, start_time=${summary.startTimeUs} µs`
        )
      );
      // A server predating `startAtUnixSec` accepts the request anyway and
      // quietly resolves it against its own clock, which slides the LEDs off
      // the aircraft by however far that clock has drifted. The two repos
      // deploy separately, so say it out loud instead of reporting a clean
      // success.
      if (
        startAtUnixSec !== undefined &&
        summary.startTimeSource !== 'absolute'
      ) {
        dispatch(
          showNotification({
            message:
              '서버가 절대 시각 ARM 을 지원하지 않아 상대 지연으로 처리됐습니다 — ' +
              'LED 가 드론과 최대 0.5초 어긋날 수 있습니다. 서버를 업데이트하세요.',
            semantics: MessageSemantics.WARNING,
          })
        );
      }
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

/**
 * Arm the LED boards for the show start that has just been scheduled.
 *
 * Handing the boards the show's own absolute start instant — rather than a
 * delay — is what puts LED frame 0 on the same second the GPS-synced drones
 * reach their first formation. A board labels its PPS edges with the absolute
 * time the controller sends and snaps that label to the nearest whole second
 * (`show_clock.c`), so once locked its clock *is* true GPS UTC and whatever
 * error the server's clock carried has been rounded away. A relative
 * `startIn` would instead fold that error into the absolute start time and
 * slide the LEDs off the drones by up to the half second the snap tolerates.
 *
 * Reads the scheduled start time out of the store rather than recomputing one,
 * so the LEDs and the drones can never be told two different instants — which
 * means this must run *after* the start time has been dispatched.
 */
/** How long to wait for the drone show's start time to reach the server. */
const SHOW_SYNC_TIMEOUT_MS = 8000;
const SHOW_SYNC_POLL_MS = 50;

/**
 * Resolve once the server has acknowledged the show's start conditions, or
 * `false` if that push failed or never landed.
 *
 * Polls rather than subscribing: this runs once per show start, and a store
 * subscription would have to be torn down on every exit path of the caller.
 */
const waitForStartConditionsSynced = async (
  getState: () => RootState
): Promise<boolean> => {
  const deadline = Date.now() + SHOW_SYNC_TIMEOUT_MS;
  for (;;) {
    const state = getState();
    if (areStartConditionsSyncedWithServer(state)) {
      return true;
    }

    if (didStartConditionSyncFail(state) || Date.now() >= deadline) {
      return false;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, SHOW_SYNC_POLL_MS);
    });
  }
};

export const armForShowStart =
  (): AppThunk<Promise<void>> => async (dispatch, getState) => {
    // Wait for the drone show to be committed before arming, because arming is
    // the half that cannot be taken back. `scheduleShowStartWithDelay` ends by
    // dispatching `synchronizeShowSettings('toServer')`, which merely *queues*
    // a saga that then performs the SHOW-SETCFG round trip — so broadcasting
    // straight away races that call, and a UDP broadcast normally wins.
    //
    // Losing that race is unrecoverable: the firmware ignores every command
    // except ARM (`on_sync_pkt`: "ABORT 는 받지 않음") and latches only the
    // first ARM of a cycle (`s_arm_consumed`), so once the boards hold a start
    // instant it can be neither cancelled nor moved. Arming ahead of the drones
    // would risk a full LED show playing over a fleet that never took off.
    if (!(await waitForStartConditionsSynced(getState))) {
      dispatch(setLastArmSummary('ARM 취소: 쇼 시작 시각이 서버에 반영되지 않음'));
      dispatch(
        showError(
          '쇼 시작 시각이 서버에 반영되지 않아 LED 보드를 ARM 하지 않았습니다. 드론 쇼 예약 상태를 먼저 확인하세요.'
        )
      );
      return;
    }

    // Read the schedule only now, so the boards are armed to whatever the
    // server actually holds rather than to a value that may have moved while
    // the push was in flight.
    const state: RootState = getState();
    const startAtUnixSec = getShowStartTime(state);
    if (startAtUnixSec == null) {
      dispatch(setLastArmSummary('ARM 건너뜀: 쇼 시작 시각 없음'));
      dispatch(showError('쇼 시작 시각이 없어 LED 보드를 ARM 하지 못했습니다.'));
      return;
    }

    // A board only latches an ARM while it waits in ARM_WAIT; one that is
    // mid-download misses the burst and stays dark for the entire show. Say so
    // now, while the operator can still act on it, rather than leaving it to be
    // discovered in the air.
    const { notReady } = getJRArmReadiness(state);
    if (notReady.length > 0) {
      const sample = notReady.slice(0, 3).join(', ');
      const more = notReady.length > 3 ? ` 외 ${notReady.length - 3}대` : '';
      dispatch(
        showNotification({
          message:
            `LED 보드 ${notReady.length}대가 ARM_WAIT 이 아닙니다 (${sample}${more}) — ` +
            '이 기체는 이번 쇼에서 LED 가 나오지 않습니다.',
          semantics: MessageSemantics.WARNING,
        })
      );
    }

    await dispatch(broadcastArm({ startAtUnixSec }));
  };
