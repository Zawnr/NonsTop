// Thin fetch wrapper for the NonsTop server API.
import type {
  FieldOp,
  PullResponse,
  PushPublicKey,
  PushResponse,
  PushSubscriptionRequest,
  PushTestResult,
  SessionInfo,
} from '@nonstop/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'unknown_error');
  return data as T;
}

export const api = {
  session: () => request<SessionInfo>('GET', '/api/auth/session'),
  login: (password: string) => request<SessionInfo>('POST', '/api/auth/login', { password }),
  logout: () => request<SessionInfo>('POST', '/api/auth/logout', {}),
  pushPublicKey: () => request<PushPublicKey>('GET', '/api/push/public-key'),
  pushSubscribe: (sub: PushSubscriptionRequest) => request<{ ok: true }>('POST', '/api/push/subscribe', sub),
  pushTest: () => request<PushTestResult>('POST', '/api/push/test', {}),
  syncPush: (ops: FieldOp[]) => request<PushResponse>('POST', '/api/sync/push', { ops }),
  syncPull: (since: number) => request<PullResponse>('GET', `/api/sync/pull?since=${since}`),
};

/** No connection: fetch failed, or the Tailscale proxy answered because the NonsTop server is down. */
export function isOfflineError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof ApiError && [502, 503, 504].includes(err.status));
}
