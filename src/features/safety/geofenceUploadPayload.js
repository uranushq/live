import { getMissionType } from '~/features/mission/selectors';
import { getWaypointMissionGeofenceSpecification } from '~/features/mission/upload';
import { getShowMissionGeofenceUploadSpecification } from '~/features/show/upload';
import { MissionType } from '~/model/missions';

/**
 * Builds the geofence-only upload payload sent to the server via
 * `__geofence_upload`. Waypoint missions use geodetic coordinates; show
 * missions include the flat-Earth coordinate system used by the geofence
 * polygon vertices.
 */
export function getGeofenceUploadSpecification(state) {
  if (getMissionType(state) === MissionType.SHOW) {
    return getShowMissionGeofenceUploadSpecification(state);
  }

  return {
    version: 1,
    coordinateSystem: 'geodetic',
    geofence: getWaypointMissionGeofenceSpecification(state),
  };
}
