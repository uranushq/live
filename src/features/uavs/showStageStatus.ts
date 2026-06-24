import UAVErrorCode from '~/flockwave/UAVErrorCode';

import type { StoredUAV } from './types';

export const SHOW_STAGE_LANDED_ERROR_CODE = UAVErrorCode.LANDED;
export const SHOW_STAGE_ERROR_ERROR_CODE = UAVErrorCode.CONFIGURATION_ERROR;

export function uavHasShowStageLanded(uav?: StoredUAV): boolean {
  return Boolean(uav?.errors?.includes(SHOW_STAGE_LANDED_ERROR_CODE));
}

export function uavHasShowStageError(uav?: StoredUAV): boolean {
  return Boolean(uav?.errors?.includes(SHOW_STAGE_ERROR_ERROR_CODE));
}

export function isArmBlockedForUav(uav?: StoredUAV): boolean {
  return uavHasShowStageLanded(uav);
}

export function getShowStageStatusMessageKey(
  uav?: StoredUAV
): 'showStageStatus.error' | 'showStageStatus.landed' | undefined {
  if (uavHasShowStageError(uav)) {
    return 'showStageStatus.error';
  }

  if (uavHasShowStageLanded(uav)) {
    return 'showStageStatus.landed';
  }

  return undefined;
}

export function getShowStageStatusLabelKey(
  uav?: StoredUAV
): 'uavStatus.showError' | 'uavStatus.landed' | undefined {
  if (uavHasShowStageError(uav)) {
    return 'uavStatus.showError';
  }

  if (uavHasShowStageLanded(uav)) {
    return 'uavStatus.landed';
  }

  return undefined;
}

export function summarizeShowStageFlightControlStatus(
  targetUAVIds: readonly string[],
  uavStatesById: Record<string, StoredUAV | undefined>
) {
  let landedCount = 0;
  let errorCount = 0;

  for (const uavId of targetUAVIds) {
    const uav = uavStatesById[uavId];
    if (uavHasShowStageLanded(uav)) {
      landedCount++;
    }

    if (uavHasShowStageError(uav)) {
      errorCount++;
    }
  }

  const statusMessageKey =
    errorCount > 0
      ? 'showStageStatus.error'
      : landedCount > 0
        ? 'showStageStatus.landed'
        : undefined;

  return {
    armDisabled: landedCount > 0,
    errorCount,
    landedCount,
    statusMessageKey,
  };
}
