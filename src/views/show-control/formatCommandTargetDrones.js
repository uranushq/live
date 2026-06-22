import { formatMissionId } from '~/utils/formatting';

/**
 * Formats UAV IDs for display in command target UI.
 * Uses mission slot labels (s1, s2, …) when available, otherwise the raw ID.
 */
export function formatCommandTargetDrones(uavIds, reverseMissionMapping) {
  if (!Array.isArray(uavIds) || uavIds.length === 0) {
    return '';
  }

  return uavIds
    .map((uavId) => {
      const missionIndex = reverseMissionMapping?.[uavId];
      return missionIndex !== undefined
        ? formatMissionId(missionIndex)
        : String(uavId);
    })
    .join(', ');
}
