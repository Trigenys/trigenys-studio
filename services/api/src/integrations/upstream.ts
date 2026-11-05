// Shared plumbing for HTTP adapters: one error type the routes map to 502,
// with the upstream name and status but never the request headers.

export class UpstreamError extends Error {
  readonly status = 502;
  readonly upstream: string;
  readonly upstreamStatus: number | undefined;
  constructor(upstream: string, detail: string, upstreamStatus?: number) {
    super(`${upstream}: ${detail}`);
    this.name = "UpstreamError";
    this.upstream = upstream;
    this.upstreamStatus = upstreamStatus;
  }
}

export async function upstreamJson<T>(upstream: string, fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    throw new UpstreamError(upstream, `unreachable (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!res.ok) throw new UpstreamError(upstream, `HTTP ${res.status}`, res.status);
  try {
    return (await res.json()) as T;
  } catch {
    throw new UpstreamError(upstream, "Non-JSON response", res.status);
  }
}
