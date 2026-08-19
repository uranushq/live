/**
 * @file Selectors for the JR-board control panel.
 *
 * The boards to watch are derived from the drones the server currently knows
 * about: the drone number becomes the last octet of the board address, so
 * drone 1 is `192.168.11.1`. Manually added IPs are merged on top for boards
 * that have no drone attached yet.
 */

import { createSelector } from '@reduxjs/toolkit';

import {
  getLedStartDelaySec,
  hasPhaseSyncedBoards,
} from '~/features/led-editor/selectors';
import {
  getAllUAVIdList,
  getUAVIdToStateMapping,
} from '~/features/uavs/selectors';
import { UAVAge } from '~/model/uav';
import type { AppSelector, RootState } from '~/store/reducers';

import {
  deriveJRBoardStatus,
  type JRBoardStatusId,
  type JRBoardHealthRecord,
} from './status';
import { type JRBoardHealthEntry, type JRHealth } from './slice';

/** JR 보드 주소의 앞 세 옥텟 — 마지막 옥텟은 드론 번호. */
export const JR_IP_PREFIX = '192.168.11.';

/** 유효한 마지막 옥텟 범위 (0 = 네트워크, 255 = 브로드캐스트) */
const MIN_OCTET = 1;
const MAX_OCTET = 254;

/**
 * UAV id에서 드론 번호를 뽑는다 — 뒤쪽 숫자를 쓰므로 `7`, `drone-7`,
 * `UAV07` 모두 7이 된다. 마지막 옥텟으로 쓸 수 없으면 null.
 */
export const droneNumberFromUAVId = (uavId: string): number | null => {
  const match = /(\d+)\s*$/.exec(String(uavId ?? ''));
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1]!, 10);
  return Number.isInteger(value) && value >= MIN_OCTET && value <= MAX_OCTET
    ? value
    : null;
};

export const jrBoardIpForDroneNumber = (droneNumber: number): string =>
  `${JR_IP_PREFIX}${droneNumber}`;

export const isJRHealthCheckEnabled = (state: RootState): boolean =>
  state.jrControl.healthCheck.enabled;

export const getJRHealthCheckDisabledReason = (
  state: RootState
): string | undefined => state.jrControl.healthCheck.disabledReason;

export const getJRHealthByIp = (
  state: RootState
): Record<string, JRBoardHealthEntry> => state.jrControl.healthByIp;

const getManualBoards = (state: RootState) => state.jrControl.boards;

/**
 * Drones that are connected right now, i.e. known to the server and not marked
 * as gone. Boards keep their row while a drone is briefly inactive so the table
 * does not flicker. Uses the unfiltered UAV list on purpose — an active named
 * group filter must not hide JR boards that are still powered on.
 */
const getConnectedUAVIds: AppSelector<string[]> = createSelector(
  getAllUAVIdList,
  getUAVIdToStateMapping,
  (uavIds, uavsById) =>
    uavIds.filter((uavId) => uavsById[uavId]?.age !== UAVAge.GONE)
);

export type JRMonitorTarget = {
  ip: string;
  /** 연결된 드론에서 온 대상이면 그 UAV id */
  uavId?: string;
  droneNumber?: number;
  /** 손으로 추가한 IP인지 (표에서 삭제 버튼을 붙일지 판단) */
  manual: boolean;
};

/**
 * Boards to poll: one per connected drone, plus every manually added IP that a
 * drone did not already claim.
 */
export const getJRMonitorTargets: AppSelector<JRMonitorTarget[]> =
  createSelector(getConnectedUAVIds, getManualBoards, (uavIds, manualBoards) => {
    const targets: JRMonitorTarget[] = [];
    const seen = new Set<string>();

    for (const uavId of uavIds) {
      const droneNumber = droneNumberFromUAVId(uavId);
      if (droneNumber === null) {
        continue;
      }

      const ip = jrBoardIpForDroneNumber(droneNumber);
      if (seen.has(ip)) {
        continue;
      }

      seen.add(ip);
      targets.push({ ip, uavId, droneNumber, manual: false });
    }

    for (const board of manualBoards) {
      if (!board.ip || seen.has(board.ip)) {
        continue;
      }

      seen.add(board.ip);
      targets.push({ ip: board.ip, manual: true });
    }

    return targets;
  });

/** IP 목록만 — 폴링 루프가 얕은 비교로 쓰기 위한 문자열 키. */
export const getJRMonitorTargetIps: AppSelector<string[]> = createSelector(
  getJRMonitorTargets,
  (targets) => targets.map((target) => target.ip)
);

export type JRBoardRow = JRMonitorTarget & {
  status: JRBoardStatusId;
  statusDetail?: string;
  health?: JRHealth;
  error?: string;
  lastCheckedAt?: number;
};

/** 표에 그릴 행 — 대상 + 마지막 헬스체크 결과에서 뽑은 상태. */
export const getJRBoardRows: AppSelector<JRBoardRow[]> = createSelector(
  getJRMonitorTargets,
  getJRHealthByIp,
  (targets, healthByIp) =>
    targets.map((target) => {
      const record: JRBoardHealthRecord | undefined = healthByIp[target.ip];
      const { status, detail } = deriveJRBoardStatus(record);
      return {
        ...target,
        status,
        statusDetail: detail,
        health: record?.health,
        error: record?.error,
        lastCheckedAt: record?.lastCheckedAt,
      };
    })
);

/**
 * Lead time (seconds) the ARM 'auto' mode uses once the LED show is synced to
 * the flight path. The boards already sit at their real times on a
 * dispatch-relative clock, so frame 0 must fire at dispatch — raise this only
 * if the hardware needs a head start.
 */
export const PHASE_SYNC_ARM_LEAD_SEC = 0;

/**
 * What ARM's 'auto' start-in resolves to, or null when it cannot be determined
 * (which makes `broadcastArm` refuse rather than send a made-up value).
 *
 * A phase-synced show is checked first and *without* consulting
 * `ledStartDelaySec`: that value is cleared when the 3D view unmounts, and a
 * synced show must still arm correctly after the user closes the 3D view.
 * Legacy LED-only shows keep the old behaviour exactly.
 */
export const getRecommendedArmStartInSec = (
  state: RootState
): number | null => {
  if (hasPhaseSyncedBoards(state)) {
    return PHASE_SYNC_ARM_LEAD_SEC;
  }

  const delaySec = getLedStartDelaySec(state);
  return delaySec != null && Number.isFinite(delaySec)
    ? Math.round(delaySec * 10) / 10
    : null;
};

/** 상태별 대수 — 패널 요약용. */
export const getJRBoardStatusCounts: AppSelector<
  Partial<Record<JRBoardStatusId, number>>
> = createSelector(getJRBoardRows, (rows) => {
  const counts: Partial<Record<JRBoardStatusId, number>> = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return counts;
});
