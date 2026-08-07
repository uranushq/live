const VIRTUAL_UAVS_API_URL = '/api/v1/virtual-uavs';

export type VirtualUavsStatus = Readonly<{
  enabled: boolean;
  count: number;
  uavIds: string[];
  message?: string;
  error?: string;
}>;

type ApiBody = VirtualUavsStatus &
  Readonly<{
    message?: string;
    error?: string;
  }>;

const parseResponseBody = async (response: Response): Promise<ApiBody> => {
  const text = await response.text().catch(() => '');
  if (!text) {
    return { enabled: false, count: 0, uavIds: [] };
  }

  try {
    return JSON.parse(text) as ApiBody;
  } catch {
    return { enabled: false, count: 0, uavIds: [], message: text };
  }
};

const formatApiError = (body: ApiBody, response: Response) =>
  (typeof body.message === 'string' && body.message) ||
  (typeof body.error === 'string' && body.error) ||
  response.statusText ||
  `Request failed (${response.status})`;

const normalizeStatus = (body: ApiBody): VirtualUavsStatus => ({
  enabled: Boolean(body.enabled),
  count: Number.isFinite(body.count) ? Number(body.count) : 0,
  uavIds: Array.isArray(body.uavIds)
    ? body.uavIds.map(String)
    : [],
});

/**
 * Returns the current virtual UAV fleet status from the server extension.
 */
export async function getVirtualUavsStatus(): Promise<VirtualUavsStatus> {
  const response = await fetch(`${VIRTUAL_UAVS_API_URL}/`);
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(formatApiError(body, response));
  }

  return normalizeStatus(body);
}

/**
 * Starts the virtual UAV fleet.
 */
export async function enableVirtualUavs(): Promise<VirtualUavsStatus> {
  const response = await fetch(`${VIRTUAL_UAVS_API_URL}/enable`, {
    method: 'POST',
  });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(formatApiError(body, response));
  }

  return normalizeStatus(body);
}

/**
 * Stops the virtual UAV fleet and removes them from the registry.
 */
export async function disableVirtualUavs(): Promise<VirtualUavsStatus> {
  const response = await fetch(`${VIRTUAL_UAVS_API_URL}/disable`, {
    method: 'POST',
  });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(formatApiError(body, response));
  }

  return normalizeStatus(body);
}

/**
 * Sets the number of virtual UAVs. May restart the fleet depending on server.
 */
export async function setVirtualUavCount(
  count: number
): Promise<VirtualUavsStatus> {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('Count must be a non-negative integer');
  }

  const response = await fetch(`${VIRTUAL_UAVS_API_URL}/count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(formatApiError(body, response));
  }

  return normalizeStatus(body);
}
