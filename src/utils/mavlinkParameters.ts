const PARAMETERS_API_URL = '/api/v1/mavlink/parameters';

export type MavlinkParameter = Readonly<{
  name: string;
  value: number | string;
  type: string;
  default?: number | string;
}>;

export type MavlinkParametersUavResult = Readonly<{
  count: number;
  parameters: MavlinkParameter[];
}>;

export type ParametersApiBody = Readonly<{
  results?: Record<string, MavlinkParametersUavResult>;
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
): Promise<ParametersApiBody> => {
  const text = await response.text().catch(() => '');
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as ParametersApiBody;
  } catch {
    return { message: text };
  }
};

const formatApiError = (body: ParametersApiBody, response: Response) =>
  (typeof body.message === 'string' && body.message) ||
  (typeof body.error === 'string' && body.error) ||
  (Array.isArray(body.errors) && body.errors.join('; ')) ||
  response.statusText ||
  `Request failed (${response.status})`;

/**
 * Reads all FC parameters for the given UAVs via MAVFTP param pack.
 * Omit `uavs` to query all connected MAVLink drones.
 */
export async function getParameters(
  uavs?: string[]
): Promise<ParametersApiBody> {
  const response = await fetch(
    `${PARAMETERS_API_URL}${buildUavQuery(uavs)}`
  );
  const body = await parseResponseBody(response);

  if (!response.ok && response.status !== 207) {
    throw new Error(formatApiError(body, response));
  }

  return body;
}

/**
 * Returns the parameter list for a single UAV from an API response body.
 */
export function getParametersForUav(
  body: ParametersApiBody,
  uavId: string
): MavlinkParameter[] {
  const result = body.results?.[uavId];
  if (!result || !Array.isArray(result.parameters)) {
    return [];
  }

  return result.parameters;
}

/**
 * Formats a parameter value for display.
 */
export function formatParameterValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

/**
 * Returns the parameter group label derived from the PX4-style name prefix.
 */
export function getParameterGroup(name: string): string {
  if (!name) {
    return '';
  }

  const separator = name.indexOf('_');
  return separator > 0 ? name.slice(0, separator) : name;
}

/**
 * Compares two parameter values, treating numeric strings as numbers.
 */
export function parameterValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }

  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    return na === nb;
  }

  return String(a) === String(b);
}

/**
 * Coerces an edited draft string back toward the original value type.
 */
export function coerceParameterValue(
  draft: string,
  original: unknown
): number | string {
  if (typeof original === 'number') {
    const parsed = Number(draft);
    return Number.isNaN(parsed) ? draft : parsed;
  }

  return draft;
}

export type ComparedParameter = Readonly<{
  name: string;
  type: string;
  group: string;
  default?: number | string;
  /** Per-UAV values; missing means the parameter is not present on that UAV. */
  values: Record<string, number | string | undefined>;
}>;

/**
 * Merges per-UAV parameter lists into a name-keyed comparison index.
 */
export function buildComparedParameters(
  body: ParametersApiBody,
  uavIds: string[]
): ComparedParameter[] {
  const byName = new Map<string, ComparedParameter>();

  for (const uavId of uavIds) {
    for (const param of getParametersForUav(body, uavId)) {
      const name = String(param.name);
      let entry = byName.get(name);
      if (!entry) {
        entry = {
          name,
          type: String(param.type ?? ''),
          group: getParameterGroup(name),
          default: param.default,
          values: {},
        };
        byName.set(name, entry);
      } else if (param.default !== undefined && entry.default === undefined) {
        entry = { ...entry, default: param.default };
        byName.set(name, entry);
      }

      entry.values[uavId] = param.value;
    }
  }

  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}
