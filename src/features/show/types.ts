import { type SetRequired } from 'type-fest';

import { type LonLat } from '~/utils/geography';
import type { Coordinate3D } from '~/utils/math';

import type {
  AltitudeReferenceSpecification,
  TakeoffHeadingSpecification,
} from './constants';
import { type EnvironmentType } from './enums';

export type CoordinateSystem = {
  orientation: string; // stored as a string to avoid rounding errors
};

export type OutdoorCoordinateSystem = CoordinateSystem & {
  origin?: LonLat;
  type: 'neu' | 'nwu';
};

export type OutdoorCoordinateSystemWithOrigin = SetRequired<
  OutdoorCoordinateSystem,
  'origin'
>;

export const isOutdoorCoordinateSystemWithOrigin = (
  coordinateSystem: OutdoorCoordinateSystem
): coordinateSystem is OutdoorCoordinateSystemWithOrigin =>
  coordinateSystem.origin !== undefined;

export type OutdoorEnvironment = {
  coordinateSystem: OutdoorCoordinateSystem;
  altitudeReference: AltitudeReferenceSpecification;
  takeoffHeading: TakeoffHeadingSpecification;
};

export type IndoorEnvironment = {
  coordinateSystem: CoordinateSystem;
  room: {
    visible: false;
    firstCorner: Coordinate3D;
    secondCorner: Coordinate3D;
  };
  takeoffHeading: TakeoffHeadingSpecification;
};

export type EnvironmentState = {
  editing: boolean;
  estimatingCoordinateSystem: boolean;
  outdoor: OutdoorEnvironment;
  indoor: IndoorEnvironment;
  type: EnvironmentType;
};

/** Per-UAV start-time / authorization readiness from X-SHOW-READY. */
export type UAVShowStartReadiness = {
  ready: boolean;
  connected: boolean;
  supportsScheduledTakeoff: boolean;
  hasStartTime: boolean;
  startTime: number | null;
  hasAuthorization: boolean;
  authorizationScope: string | null;
};

/** Aggregate show start readiness from X-SHOW-READY /start-readiness. */
export type ShowStartReadiness = {
  ready: boolean;
  total: number;
  readyCount: number;
  missingStartTime: string[];
  missingAuthorization: string[];
  missing: string[];
  disconnected: string[];
  unsupported: string[];
  uavs: Record<string, UAVShowStartReadiness>;
  lastUpdatedAt?: number;
};
