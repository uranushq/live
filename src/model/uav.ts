/**
 * @file Classes, functions and constants related to the representation of
 * an UAV.
 */

import { type RSSI, type UAVStatusInfo } from '@skybrush/flockwave-spec';
import { Base64 } from 'js-base64';
import isEqual from 'lodash-es/isEqual';
import isNil from 'lodash-es/isNil';
import memoizeOne from 'memoize-one';
import { shallowEqual } from 'react-redux';

import { type StoredUAV } from '~/features/uavs/types';
import { type ErrorCode } from '~/flockwave/errors';
import { type Latitude, type Longitude } from '~/utils/geography';
import { type Coordinate3D } from '~/utils/math';

import { GPSFixType } from './enums';
import { isGPSPositionValid, type GPSFix, type GPSPosition } from './geography';
import { type VelocityNED, type VelocityXYZ } from './velocity';

/**
 * Age constants for a UAV. Used in the Redux store to mark UAVs for which we
 * have not received a status update for a while.
 */
export enum UAVAge {
  ACTIVE = 'active',
  INACTIVE = 'inactive', // means "no telemetry" in a while
  GONE = 'gone',
  FORGOTTEN = 'forgotten',
}

export type UAVBattery = {
  voltage?: number;
  percentage?: number;
  charging?: boolean;
};

/**
 * Representation of a single UAV.
 */
export default class UAV {
  // TODO: Properly hide private properties with `#` once it's
  //       ensured that they are not accessed from the outside.
  _debug?: string;
  _debugAsByteArray?: Uint8Array;
  _debugString?: string;
  _errors: ErrorCode[];
  _id: string;
  _mostSevereError: ErrorCode;
  _position?: GPSPosition;
  age?: UAVAge;
  battery: UAVBattery;
  gpsFix: GPSFix;
  heading?: number;
  lastUpdated?: number;
  light: number /* RGB565 */;
  localPosition?: Coordinate3D;
  localVelocity?: VelocityXYZ;
  mode?: string;
  velocity?: VelocityNED;
  rssi: RSSI;

  // TODO: This should be unnecessary if we can ensure that no mutation happens
  //       to the output later on, thus the object spread can be avoided.
  _positionMemoizer: (position: GPSPosition) => GPSPosition;

  /**
   * Constructor.
   *
   * Creates a new UAV with no known position.
   *
   * @param id - The ID of the UAV
   */
  constructor(id: string) {
    this._debug = undefined;
    this._debugAsByteArray = undefined;
    this._debugString = undefined;

    this._id = id;
    this._errors = [];
    this._mostSevereError = 0;
    this._position = undefined;

    this.battery = {
      voltage: undefined,
      percentage: undefined,
      charging: undefined,
    };
    this.gpsFix = {
      type: GPSFixType.NO_GPS,
      numSatellites: undefined,
      horizontalAccuracy: undefined,
      verticalAccuracy: undefined,
    };
    this.heading = undefined;
    this.lastUpdated = undefined;
    this.light = 0xffff; /* white in RGB565 */
    this.localPosition = undefined;
    this.localVelocity = undefined;
    this.mode = undefined;
    this.velocity = undefined;
    this.rssi = [];

    this._positionMemoizer = memoizeOne<typeof this._positionMemoizer>(
      (position) => ({ ...position })
    );
  }

  /**
   * Returns the altitude above ground level, if known.
   */
  get agl(): number | undefined {
    return this._position?.agl;
  }

  /**
   * Returns the altitude above home level, if known.
   */
  get ahl(): number | undefined {
    return this._position?.ahl;
  }

  /**
   * Returns the altitude above mean sea level, if known.
   */
  get amsl(): number | undefined {
    return this._position?.amsl;
  }

  /**
   * Returns the debug information associated with the UAV as a byte array
   * (not as a string).
   */
  get debug(): Uint8Array | undefined {
    if (this._debugAsByteArray === undefined && this._debug !== undefined) {
      try {
        const data = Base64.atob(this._debug);
        this._debugAsByteArray = new Uint8Array(new ArrayBuffer(data.length));
        for (let i = 0; i < data.length; i++) {
          // NOTE: Bang justified by `i < data.length`
          this._debugAsByteArray[i] = data.codePointAt(i)!;
        }
      } catch {
        this._debugAsByteArray = new Uint8Array();
      }
    }

    return this._debugAsByteArray;
  }

  /**
   * Returns the debug information associated with the UAV as a string,
   * replacing non-printable characters with a dot.
   */
  get debugString(): string | undefined {
    if (this._debugString === undefined && this.debug !== undefined) {
      this._debugString = Array.from(this.debug)
        .map((c) => (c >= 32 && c < 128 ? String.fromCodePoint(c) : '.'))
        .join('');
    }

    return this._debugString;
  }

  /**
   * Returns a single error code from the list of error codes sent by the
   * UAV, or undefined if there are no errors.
   */
  get error(): ErrorCode | undefined {
    return this._errors && this._errors.length > 0
      ? this._errors[0]
      : undefined;
  }

  /**
   * Returns the list of error codes sent by the UAV.
   */
  get errors(): ErrorCode[] {
    return this._errors;
  }

  /**
   * Returns the ID of the UAV.
   */
  get id(): string {
    return this._id;
  }

  /**
   * Returns the latitude of the UAV, if known.
   */
  get lat(): number | undefined {
    return this._position?.lat;
  }

  /**
   * Returns the longitude of the UAV, if known.
   */
  get lon(): number | undefined {
    return this._position?.lon;
  }

  /**
   * Returns the most severe error code from the list of error codes sent by the
   * UAV, or zero if there are no errors.
   */
  get mostSevereError(): ErrorCode {
    return this._mostSevereError;
  }

  /**
   * Returns whether the UAV has a known local position.
   */
  get hasLocalPosition(): boolean {
    return !isNil(this.localPosition);
  }

  /**
   * Returns the position object if it is available, `undefined` otherwise.
   */
  get position(): GPSPosition | undefined {
    /* Null Island / non-finite coords are treated as "no position info" */
    return isGPSPositionValid(this._position)
      ? this._positionMemoizer(this._position)
      : undefined;
  }

  /**
   * Replaces the position object of the UAV if the new value is actually
   * different from the current one.
   *
   * Invalid coordinates (NaN, Null Island) are ignored so a brief GPS dropout
   * cannot wipe the last-known good location used by the map.
   */
  set position(value) {
    if (value != null && !isGPSPositionValid(value)) {
      return;
    }

    if (!shallowEqual(this._position, value)) {
      this._position = value;
    }
  }

  /**
   * Handles the status information related to a single UAV from an UAV-INF
   * message.
   *
   * @param status - The status information of this UAV from an UAV-INF message
   * @returns Whether the status information has been updated
   */
  /* eslint-disable complexity */
  handleUAVStatusInfo = (status: UAVStatusInfo): boolean => {
    const {
      timestamp,
      position,
      positionXYZ,
      heading,
      mode,
      gps,
      errors,
      battery,
      light,
      debug,
      velocity,
      velocityXYZ,
      rssi,
    } = status;

    let errorList: ErrorCode[];
    let updated = false;

    if (timestamp) {
      this.lastUpdated = timestamp;
      updated = true;
    }

    if (Array.isArray(position) && position.length >= 2) {
      const lat = Number(position[0]) / 1e7;
      const lon = Number(position[1]) / 1e7;
      const nextPosition: GPSPosition = {
        // NOTE: Type assertion justified by `flockwave-spec`:
        // UAVStatusInfo['position'] is supposed to be of type `GPSCoordinate`,
        // which is at least a `[Latitude, Longitude]` pair
        lat: lat as Latitude,
        lon: lon as Longitude,
        amsl: isNil(position[2]) ? undefined : Number(position[2]) / 1e3,
        ahl: isNil(position[3]) ? undefined : Number(position[3]) / 1e3,
        agl: isNil(position[4]) ? undefined : Number(position[4]) / 1e3,
      };

      // Skip Null Island / NaN so map markers keep the last-good fix.
      if (isGPSPositionValid(nextPosition)) {
        this.position = nextPosition;
        updated = true;
      }
    }

    if (positionXYZ && Array.isArray(positionXYZ) && positionXYZ.length >= 3) {
      const x = Number(positionXYZ[0]) / 1e3;
      const y = Number(positionXYZ[1]) / 1e3;
      const z = Number(positionXYZ[2]) / 1e3;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        this.localPosition = [x, y, z];
        updated = true;
      }
    }

    if (heading !== undefined && this.heading !== heading / 10) {
      this.heading = heading / 10; /* conversion to degrees */
      updated = true;
    }

    if (velocity !== undefined && this.velocity !== velocity) {
      this.velocity = [velocity[0] / 1e3, velocity[1] / 1e3, velocity[2] / 1e3];
      updated = true;
    }

    if (velocityXYZ) {
      this.localVelocity = [
        velocityXYZ[0] / 1e3,
        velocityXYZ[1] / 1e3,
        velocityXYZ[2] / 1e3,
      ];
      updated = true;
    }

    if (light !== undefined && this.light !== light) {
      this.light = light;
      updated = true;
    }

    if (mode !== undefined && this.mode !== mode) {
      this.mode = mode;
      updated = true;
    }

    if (gps !== undefined && Array.isArray(gps)) {
      this.gpsFix.type = gps.length > 0 ? gps[0] : GPSFixType.NO_GPS;
      this.gpsFix.numSatellites =
        gps.length > 1 && typeof gps[1] === 'number' ? gps[1] : undefined;
      this.gpsFix.horizontalAccuracy =
        typeof gps[2] === 'number' ? gps[2] / 1e3 : undefined;
      this.gpsFix.verticalAccuracy =
        typeof gps[3] === 'number' ? gps[3] / 1e3 : undefined;
      updated = true;
    }

    if (debug !== undefined && this._debug !== debug) {
      this._debug = debug;
      this._debugAsByteArray = undefined;
      this._debugString = undefined;
      updated = true;
    }

    if (Array.isArray(errors)) {
      errorList = errors;
    } else {
      errorList = errors ? [errors] : [];
    }

    if (!isEqual(this._errors, errorList)) {
      this._errors.splice(0, this._errors.length, ...errorList);
      this._mostSevereError = Math.max(0, ...this._errors);
      updated = true;
    }

    if (Array.isArray(battery)) {
      const [newVoltageRaw, newPercentage, newCharging] = battery;

      if (this.battery.voltage !== newVoltageRaw / 10) {
        this.battery.voltage = newVoltageRaw / 10;
        updated = true;
      }

      if (this.battery.percentage !== newPercentage) {
        this.battery.percentage = newPercentage;
        updated = true;
      }

      if (this.battery.charging !== newCharging) {
        this.battery.charging = newCharging;
        updated = true;
      }
    }

    if (Array.isArray(rssi)) {
      this.rssi = rssi;
    }

    return updated;
  };
  /* eslint-enable complexity */

  /**
   * Returns a pure JavaScript object representation of the UAV that can be
   * used in a Redux store.
   */
  toJSON(): StoredUAV {
    const localPosition = this.hasLocalPosition
      ? structuredClone(this.localPosition)
      : undefined;

    return {
      id: this._id,
      age: this.age,
      battery: { ...this.battery },
      debugString: this.debugString,
      errors: [...this._errors],
      gpsFix: { ...this.gpsFix },
      heading: this.heading,
      lastUpdated: this.lastUpdated,
      light: this.light,
      localPosition,
      localVelocity: structuredClone(this.localVelocity),
      mode: this.mode,
      position: this.position,
      velocity: structuredClone(this.velocity),
      rssi: structuredClone(this.rssi),
    };
  }
}
