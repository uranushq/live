import { getClockById } from '~/features/clocks/selectors';
import { CommonClockId } from '~/features/clocks/types';
import {
  getTickCountOnClockAt,
  isClockAffectedByClockSkew,
} from '~/features/clocks/utils';
import { getRoundedClockSkewInMilliseconds } from '~/features/servers/selectors';
import type { RootState } from '~/store/reducers';

import {
  getShowClockReference,
  getShowDuration,
  getShowStartTime,
  hasLoadedShowFile,
  hasScheduledStartTime,
} from './selectors';

export type ShowTimerPhase = 'waiting' | 'running';

export type ShowTimerSnapshot = {
  durationSeconds: number;
  elapsedSeconds: number;
  phase: ShowTimerPhase;
  remainingSeconds: number;
  /** Total scheduled pre-show wait, in seconds (waiting phase only). */
  waitDurationSeconds?: number;
};

/**
 * Formats a duration as MM:SS.s for the show timer overlay.
 */
export function formatShowTimer(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const totalTenths = Math.round(clamped * 10);
  const minutes = Math.floor(totalTenths / 600);
  const secsTenths = totalTenths % 600;
  const secsWhole = Math.floor(secsTenths / 10);
  const secsFrac = secsTenths % 10;

  return `${String(minutes).padStart(2, '0')}:${String(secsWhole).padStart(2, '0')}.${secsFrac}`;
}

export function getSecondsUntilShowStart(
  state: RootState,
  nowMs = Date.now()
): number | null {
  const startTime = getShowStartTime(state);
  if (startTime == null) {
    return null;
  }

  const clockRef = getShowClockReference(state);
  const skew = getRoundedClockSkewInMilliseconds(state) || 0;

  if (!clockRef) {
    // Absolute UTC start times are authored against the server clock.
    return startTime - (nowMs + skew) / 1000;
  }

  const clock = getClockById(state, clockRef);
  if (!clock) {
    return null;
  }

  const clockSkew = isClockAffectedByClockSkew(clock) ? skew : 0;
  const currentSeconds =
    getTickCountOnClockAt(clock, nowMs + clockSkew) / clock.ticksPerSecond;

  return startTime - currentSeconds;
}

export function getShowElapsedSeconds(
  state: RootState,
  nowMs = Date.now()
): number | null {
  const showClock = getClockById(state, CommonClockId.SHOW);
  if (!showClock?.running) {
    return null;
  }

  const skew = getRoundedClockSkewInMilliseconds(state) || 0;
  const ticks = getTickCountOnClockAt(showClock, nowMs + skew);

  return ticks / showClock.ticksPerSecond;
}

export function getShowTimerSnapshot(
  state: RootState,
  nowMs = Date.now()
): ShowTimerSnapshot | null {
  if (!hasLoadedShowFile(state)) {
    return null;
  }

  const durationSeconds = getShowDuration(state);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  const rawElapsedSeconds = getShowElapsedSeconds(state, nowMs);

  let untilStart: number | null = null;
  if (rawElapsedSeconds != null && rawElapsedSeconds < 0) {
    untilStart = -rawElapsedSeconds;
  } else if (hasScheduledStartTime(state)) {
    const fromSchedule = getSecondsUntilShowStart(state, nowMs);
    if (fromSchedule != null && fromSchedule > 0) {
      untilStart = fromSchedule;
    }
  }

  if (untilStart != null && untilStart > 0) {
    return {
      durationSeconds,
      elapsedSeconds: 0,
      phase: 'waiting',
      remainingSeconds: untilStart,
      waitDurationSeconds: untilStart,
    };
  }

  if (rawElapsedSeconds != null) {
    const elapsedSeconds = Math.max(0, rawElapsedSeconds);

    if (elapsedSeconds >= durationSeconds) {
      return null;
    }

    return {
      durationSeconds,
      elapsedSeconds,
      phase: 'running',
      remainingSeconds: Math.max(0, durationSeconds - elapsedSeconds),
    };
  }

  return null;
}
