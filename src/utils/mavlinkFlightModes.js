import { abbreviateFlightMode } from '~/model/enums';

const FLIGHT_MODES_API_URL = '/api/v1/mavlink/flight-modes';

/** Common ArduPilot Copter custom_mode numbers used in FLTMODE slots. */
const ARDUPILOT_MODE_NUMBER_TO_FLIGHT_MODE = Object.freeze({
  0: 'stab',
  2: 'alt',
  3: 'auto',
  4: 'guided',
  5: 'loiter',
  6: 'rth',
  9: 'land',
  127: 'show',
});

/** ArduPilot mode numbers exposed in the FLTMODE5/FLTMODE6 UI. */
export const FLIGHT_MODE_PRESETS = Object.freeze([
  { value: 0, labelKey: 'stabilize' },
  { value: 3, labelKey: 'auto' },
  { value: 4, labelKey: 'guided' },
  { value: 5, labelKey: 'loiter' },
  { value: 127, labelKey: 'show' },
]);

const DEFAULT_FLIGHT_MODE = 127;

const buildUavQuery = (uavs) => {
  if (!uavs?.length) {
    return '';
  }

  const params = new URLSearchParams();
  for (const uavId of uavs) {
    params.append('uavs', String(uavId));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
};

const parseResponseBody = async (response) => {
  const text = await response.text().catch(() => '');
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const formatApiError = (body, response) =>
  (typeof body?.message === 'string' && body.message) ||
  (typeof body?.error === 'string' && body.error) ||
  (Array.isArray(body?.errors) && body.errors.join('; ')) ||
  response.statusText ||
  `Request failed (${response.status})`;

/**
 * Reads FLTMODE5/FLTMODE6 for the given UAVs. Omit `uavs` to query all
 * connected MAVLink drones.
 */
export async function getFlightModes(uavs) {
  const response = await fetch(
    `${FLIGHT_MODES_API_URL}${buildUavQuery(uavs)}`
  );
  const body = await parseResponseBody(response);

  if (!response.ok && response.status !== 207) {
    throw new Error(formatApiError(body, response));
  }

  return body;
}

/**
 * Sets FLTMODE5 and FLTMODE6 on the given UAVs. Omit `uavs` to target all
 * connected MAVLink drones.
 */
export async function setFlightModes(mode, uavs) {
  const payload = { mode };
  if (uavs?.length) {
    payload.uavs = uavs.map(String);
  }

  const response = await fetch(FLIGHT_MODES_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await parseResponseBody(response);

  if (!response.ok && response.status !== 207) {
    throw new Error(formatApiError(body, response));
  }

  return { body, partial: response.status === 207 };
}

export function getDefaultFlightModeValue() {
  return DEFAULT_FLIGHT_MODE;
}

export function ardupilotModeNumberToFlightMode(modeNumber) {
  if (typeof modeNumber !== 'number' || !Number.isFinite(modeNumber)) {
    return undefined;
  }

  return ARDUPILOT_MODE_NUMBER_TO_FLIGHT_MODE[modeNumber];
}

export function formatArduPilotModeNumber(modeNumber) {
  if (typeof modeNumber !== 'number' || !Number.isFinite(modeNumber)) {
    return undefined;
  }

  const flightMode = ardupilotModeNumberToFlightMode(modeNumber);
  return flightMode ? abbreviateFlightMode(flightMode) : String(modeNumber);
}

/**
 * Formats FLTMODE5/6 slot values for compact list display.
 */
export function formatFltModeSlots(fltMode5, fltMode6) {
  const has5 = typeof fltMode5 === 'number' && Number.isFinite(fltMode5);
  const has6 = typeof fltMode6 === 'number' && Number.isFinite(fltMode6);

  if (!has5 && !has6) {
    return undefined;
  }

  if (!has6 || fltMode5 === fltMode6) {
    return formatArduPilotModeNumber(fltMode5);
  }

  if (!has5) {
    return formatArduPilotModeNumber(fltMode6);
  }

  return `${formatArduPilotModeNumber(fltMode5)}/${formatArduPilotModeNumber(fltMode6)}`;
}

/**
 * Parses a GET /flight-modes response into per-UAV FLTMODE slot values.
 */
export function parseFltModeSlotsByUavId(body) {
  const results = body?.results;
  if (!results || typeof results !== 'object') {
    return {};
  }

  const parsed = {};

  for (const [uavId, uavResult] of Object.entries(results)) {
    if (!uavResult || typeof uavResult !== 'object') {
      continue;
    }

    const fltMode5 = Number(uavResult.FLTMODE5);
    const fltMode6 = Number(uavResult.FLTMODE6);
    parsed[uavId] = {
      fltMode5: Number.isFinite(fltMode5) ? fltMode5 : undefined,
      fltMode6: Number.isFinite(fltMode6) ? fltMode6 : undefined,
    };
  }

  return parsed;
}

/**
 * Derives a single display mode from a GET /flight-modes response body.
 */
export function summarizeFlightModeFromResults(body) {
  const results = body?.results;
  if (!results || typeof results !== 'object') {
    return typeof body?.mode === 'number' ? body.mode : undefined;
  }

  const modes = new Set();
  for (const uavResult of Object.values(results)) {
    if (!uavResult || typeof uavResult !== 'object') {
      continue;
    }

    for (const value of Object.values(uavResult)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        modes.add(value);
      }
    }
  }

  if (modes.size === 1) {
    return [...modes][0];
  }

  return undefined;
}
