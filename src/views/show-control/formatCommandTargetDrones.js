import { formatMissionId } from '~/utils/formatting';

/**
 * Formats UAV IDs for display in command target UI.
 * Uses mission slot labels (s1, s2, …) when available, otherwise the raw ID.
 * When every known UAV is selected, returns "All".
 */
export function formatCommandTargetDrones(
  uavIds,
  reverseMissionMapping,
  allUAVIds
) {
  if (!Array.isArray(uavIds) || uavIds.length === 0) {
    return '';
  }

  if (Array.isArray(allUAVIds) && allUAVIds.length > 0) {
    const selected = new Set(uavIds.map(String));
    const allSelected =
      uavIds.length === allUAVIds.length &&
      allUAVIds.every((id) => selected.has(String(id)));
    if (allSelected) {
      return 'All';
    }
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
