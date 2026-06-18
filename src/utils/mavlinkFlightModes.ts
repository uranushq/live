import { abbreviateFlightMode } from '~/model/enums';

const FLIGHT_MODES_API_URL = '/api/v1/mavlink/flight-modes';

/** Common ArduPilot Copter custom_mode numbers used in FLTMODE slots. */
const ARDUPILOT_MODE_NUMBER_TO_FLIGHT_MODE: Readonly<
  Record<number, string>
> = Object.freeze({
  0: 'stab',
  2: 'alt',
  3: 'auto',
  4: 'guided',
  5: 'loiter',
  6: 'rth',
  9: 'land',
  127: 'show',
});

export type FlightModePreset = Readonly<{
  value: number;
  labelKey: string;
}>;

/** ArduPilot mode numbers exposed in the FLTMODE5/FLTMODE6 UI. */
export const FLIGHT_MODE_PRESETS: readonly FlightModePreset[] = Object.freeze([
  { value: 0, labelKey: 'stabilize' },
  { value: 3, labelKey: 'auto' },
  { value: 4, labelKey: 'guided' },
  { value: 5, labelKey: 'loiter' },
  { value: 127, labelKey: 'show' },
]);

export type CurrentFlightModeCommand = Readonly<{
  command: string;
  labelKey: string;
  telemetry?: string;
}>;

/** OBJ-CMD `mode` arguments supported by the server (handle_command_mode). */
export const CURRENT_FLIGHT_MODE_COMMANDS: readonly CurrentFlightModeCommand[] =
  Object.freeze([
    { command: 'stabilize', labelKey: 'stabilize', telemetry: 'stab' },
    { command: 'loiter', labelKey: 'loiter', telemetry: 'loiter' },
    { command: 'guided', labelKey: 'guided', telemetry: 'guided' },
    { command: 'pos hold', labelKey: 'posHold', telemetry: 'pos' },
    { command: 'land', labelKey: 'land', telemetry: 'land' },
    { command: 'show', labelKey: 'show', telemetry: 'show' },
  ]);

const DEFAULT_CURRENT_FLIGHT_MODE_COMMAND = 'stabilize';

const DEFAULT_FLIGHT_MODE = 127;

export type FltModeSlotValues = Readonly<{
  fltMode5?: number;
  fltMode6?: number;
}>;

export type FlightModesApiBody = Readonly<{
  mode?: number;
  parameters?: string[];
  results?: Record<string, Record<string, number>>;
  skipped?: string[];
  errors?: string[];
  message?: string;
  error?: string;
}>;

const buildUavQuery = (uavs?: string[]) => {
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

const parseResponseBody = async (
  response: Response
): Promise<FlightModesApiBody> => {
  const text = await response.text().catch(() => '');
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as FlightModesApiBody;
  } catch {
    return { message: text };
  }
};

const formatApiError = (body: FlightModesApiBody, response: Response) =>
  (typeof body.message === 'string' && body.message) ||
  (typeof body.error === 'string' && body.error) ||
  (Array.isArray(body.errors) && body.errors.join('; ')) ||
  response.statusText ||
  `Request failed (${response.status})`;

/**
 * Reads FLTMODE5/FLTMODE6 for the given UAVs. Omit `uavs` to query all
 * connected MAVLink drones.
 */
export async function getFlightModes(
  uavs?: string[]
): Promise<FlightModesApiBody> {
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
export async function setFlightModes(
  mode: number,
  uavs?: string[]
): Promise<{ body: FlightModesApiBody; partial: boolean }> {
  const payload: { mode: number; uavs?: string[] } = { mode };
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

export function getDefaultFlightModeValue(): number {
  return DEFAULT_FLIGHT_MODE;
}

export function getDefaultCurrentFlightModeCommand(): string {
  return DEFAULT_CURRENT_FLIGHT_MODE_COMMAND;
}

export function isSupportedCurrentFlightModeCommand(
  command: string
): command is CurrentFlightModeCommand['command'] {
  return CURRENT_FLIGHT_MODE_COMMANDS.some((entry) => entry.command === command);
}

export function telemetryModeToCommand(mode?: string): string | undefined {
  if (!mode) {
    return undefined;
  }

  const preset = CURRENT_FLIGHT_MODE_COMMANDS.find(
    (entry) => entry.telemetry === mode
  );
  return preset?.command;
}

export function summarizeTelemetryModes(
  modes: Array<string | undefined>
): string | undefined {
  const defined = modes.filter((mode): mode is string => Boolean(mode));
  if (defined.length === 0) {
    return undefined;
  }

  const commands = new Set(
    defined
      .map((mode) => telemetryModeToCommand(mode))
      .filter((command): command is string => Boolean(command))
  );
  return commands.size === 1 ? [...commands][0] : undefined;
}

export function ardupilotModeNumberToFlightMode(
  modeNumber: number
): string | undefined {
  if (typeof modeNumber !== 'number' || !Number.isFinite(modeNumber)) {
    return undefined;
  }

  return ARDUPILOT_MODE_NUMBER_TO_FLIGHT_MODE[modeNumber];
}

export function formatArduPilotModeNumber(
  modeNumber?: number
): string | undefined {
  if (typeof modeNumber !== 'number' || !Number.isFinite(modeNumber)) {
    return undefined;
  }

  const flightMode = ardupilotModeNumberToFlightMode(modeNumber);
  return flightMode ? abbreviateFlightMode(flightMode) : String(modeNumber);
}

/**
 * Formats FLTMODE5/6 slot values for compact list display.
 */
export function formatFltModeSlots(
  fltMode5?: number,
  fltMode6?: number
): string | undefined {
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
export function parseFltModeSlotsByUavId(
  body: FlightModesApiBody
): Record<string, FltModeSlotValues> {
  const results = body.results;
  if (!results || typeof results !== 'object') {
    return {};
  }

  const parsed: Record<string, FltModeSlotValues> = {};

  for (const [uavId, uavResult] of Object.entries(results)) {
    if (!uavResult || typeof uavResult !== 'object') {
      continue;
    }

    const fltMode5 = Number(uavResult['FLTMODE5']);
    const fltMode6 = Number(uavResult['FLTMODE6']);
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
export function summarizeFlightModeFromResults(
  body: FlightModesApiBody
): number | undefined {
  const results = body.results;
  if (!results || typeof results !== 'object') {
    return typeof body.mode === 'number' ? body.mode : undefined;
  }

  const modes = new Set<number>();
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
