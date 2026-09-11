'use client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? res.statusText, (data as { details?: unknown })?.details);
  return data as T;
}

/** Normalises server validation details into { path: message }. */
export function detailsToErrors(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && typeof d === 'object' && 'message' in d) {
        const path = String((d as { path?: string; field?: string }).path ?? (d as { field?: string }).field ?? '_');
        out[path] = String((d as { message: string }).message);
      } else out._ = String(d);
    }
  }
  return out;
}
