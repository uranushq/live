import turfContains from '@turf/boolean-contains';
import * as TurfHelpers from '@turf/helpers';

import type { LonLat } from '~/utils/geography';
import { createGeometryFromPoints } from '~/utils/math';

type GeofencePositionInput = Readonly<{
  lon?: number;
  lat?: number;
}>;

/**
 * Returns whether a GPS position is inside the given geofence polygon.
 * Returns undefined when the check cannot be performed.
 */
export function isPositionInsideGeofencePolygon(
  position: GeofencePositionInput | undefined,
  geofencePoints: LonLat[] | undefined
): boolean | undefined {
  if (
    position?.lon === undefined ||
    position?.lat === undefined ||
    !geofencePoints?.length
  ) {
    return undefined;
  }

  const geofence = createGeometryFromPoints(geofencePoints);
  if (geofence.isErr() || geofence.value.type !== 'Polygon') {
    return undefined;
  }

  const point = TurfHelpers.point([position.lon, position.lat]);
  const polygon = TurfHelpers.feature(geofence.value);

  return turfContains(polygon, point);
}

/**
 * Returns whether a GPS position is outside the given geofence polygon.
 * Returns undefined when the check cannot be performed.
 */
export function isPositionOutsideGeofencePolygon(
  position: GeofencePositionInput | undefined,
  geofencePoints: LonLat[] | undefined
): boolean | undefined {
  const inside = isPositionInsideGeofencePolygon(position, geofencePoints);

  if (inside === undefined) {
    return undefined;
  }

  return !inside;
}
