export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: Record<string, string>) { super(message); }
}

export async function api<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'pmsomel', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No connection. Check your internet and try again.', 'network');
  }
  if (res.status === 204) return null as T;
  let data: any = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.message || (res.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Request failed'), e?.code, e?.details);
  }
  return data as T;
}

export const get = <T = any>(p: string, h?: Record<string, string>) => api<T>('GET', p, undefined, h);
export const post = <T = any>(p: string, b: unknown = {}, h?: Record<string, string>) => api<T>('POST', p, b, h);
export const put = <T = any>(p: string, b: unknown = {}) => api<T>('PUT', p, b);
export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

export function safeStorage() {
  return {
    get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
    set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    remove(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
}
