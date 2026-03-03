const BASE = import.meta.env.VITE_API_BASE_URL || '';

const DEFAULT_TIMEOUT_MS = 120_000;  // 2분. 영상 생성 등은 백엔드 600s 내
const MAX_RETRIES = 2;

function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...init,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));
}

async function request<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
  retryCount = 0
): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  try {
    const { timeoutMs, ...init } = options;
    const headers = new Headers(init.headers || {});
    // Default JSON header unless we're sending FormData (browser sets the boundary).
    const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
    if (!isForm && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const merged: RequestInit = { ...init, headers };

    const res = await fetchWithTimeout(url, { ...merged, timeoutMs });
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const err = text ? JSON.parse(text) : {};
        msg = (err as { detail?: string }).detail ?? (err as { error?: string }).error ?? msg;
      } catch {
        if (res.status >= 500) msg = '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
      }
      if (res.status >= 500 && retryCount < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (retryCount + 1)));
        return request<T>(path, options, retryCount + 1);
      }
      throw new Error(msg);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return res.json();
  } catch (e) {
    const isRetryable =
      e instanceof TypeError && (e.message === 'Failed to fetch' || e.message.includes('aborted'));
    if (isRetryable && retryCount < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * (retryCount + 1)));
      return request<T>(path, options, retryCount + 1);
    }
    if (e instanceof Error) {
      if (e.name === 'AbortError') throw new Error('요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
      throw e;
    }
    throw e;
  }
}

export const api = {
  get: <T>(path: string, opts?: { timeoutMs?: number }) =>
    request<T>(path, { method: 'GET', ...opts }),
  post: <T>(path: string, body: unknown, opts?: { timeoutMs?: number }) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), ...opts }),
  postForm: <T>(path: string, body: FormData, opts?: { timeoutMs?: number }) =>
    request<T>(path, { method: 'POST', body, ...opts }),
  patch: <T>(path: string, body: unknown, opts?: { timeoutMs?: number }) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body), ...opts }),
  delete: (path: string, opts?: { timeoutMs?: number }) =>
    request<void>(path, { method: 'DELETE', ...opts }),
};
