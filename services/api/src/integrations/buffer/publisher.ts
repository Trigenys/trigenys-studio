import type { ProviderAccount, Publisher, PublishRequest, PublishResult, RemotePost } from "../types.ts";

// Buffer, through its public GraphQL API (`POST {base}/`, bearer API key).
// Buffer offers no idempotency key: the outbox never calls `publish` twice
// for the same delivery, and `lookup` lets it reconcile an uncertain send
// (same channel, same text, created after the attempt started).
// The API key never reaches a log, an error message or a thrown Error.

export type BufferPublisherOptions = {
  apiKey: string;
  baseUrl?: string;
  organizationId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
};

type GraphQlResponse<T> = { data?: T; errors?: { message: string }[] };
type BufferPost = { id: string; status?: string; dueAt?: string | null; text?: string; createdAt?: string; permalink?: string | null; error?: string | null };
type CreatePostData = {
  createPost: { __typename: string; post?: BufferPost; message?: string };
};

const DEFAULT_BASE = "https://api.buffer.com";

// Buffer's status vocabulary mapped to the one the outbox understands.
function remoteStatus(status: string | undefined): RemotePost["status"] {
  const s = (status ?? "").toLowerCase();
  if (s === "sent" || s === "published") return "sent";
  if (s === "error" || s === "failed") return "error";
  return "scheduled";
}

function toRemote(p: BufferPost): RemotePost {
  const out: RemotePost = { externalId: p.id, status: remoteStatus(p.status) };
  if (p.permalink) out.permalink = p.permalink;
  if (p.error) out.error = p.error;
  return out;
}

export class BufferPublisher implements Publisher {
  readonly name = "buffer";
  private readonly apiKey: string;
  private readonly base: string;
  private readonly organizationId: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: BufferPublisherOptions) {
    this.apiKey = options.apiKey;
    this.base = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.organizationId = options.organizationId;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.now = options.now ?? (() => new Date());
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const due = request.scheduledAt ? new Date(request.scheduledAt) : this.now();
    const imminent = due.getTime() <= this.now().getTime() + 60_000;
    const input = imminent
      ? { text: request.body, channelId: request.accountRef, schedulingType: "automatic", mode: "shareNow" }
      : { text: request.body, channelId: request.accountRef, schedulingType: "automatic", mode: "customScheduled", dueAt: due.toISOString() };
    const query = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id status dueAt } }
    ... on MutationError { message }
  }
}`;
    const res = await this.call<CreatePostData>(query, { input });
    if (res.kind === "transport") return { status: "failed", error: res.error, retryable: res.retryable, retryAfterSeconds: res.retryAfterSeconds, code: res.code };
    const result = res.data.createPost;
    if (!result || result.__typename !== "PostActionSuccess" || !result.post) {
      return { status: "failed", error: `Buffer refused the post: ${result?.message ?? "unknown error"}`, retryable: false, code: "rejected" };
    }
    return { status: imminent ? "published" : "scheduled", externalId: result.post.id };
  }

  async cancel(externalId: string): Promise<void> {
    const query = `mutation DeletePost($id: PostId!) {
  deletePost(input: { id: $id }) {
    __typename
    ... on MutationError { message }
  }
}`;
    const res = await this.call<{ deletePost: { __typename: string; message?: string } }>(query, { id: externalId });
    if (res.kind === "transport") throw new Error(`Buffer: ${res.error}`);
    if (res.data.deletePost?.__typename === "MutationError") throw new Error(`Buffer refused the deletion: ${res.data.deletePost.message}`);
  }

  async status(externalId: string): Promise<RemotePost | null> {
    const query = `query Post($id: PostId!) {
  post(input: { id: $id }) { id status dueAt text error }
}`;
    const res = await this.call<{ post: BufferPost | null }>(query, { id: externalId });
    if (res.kind === "transport") throw new Error(`Buffer: ${res.error}`);
    return res.data.post ? toRemote(res.data.post) : null;
  }

  // Posts of the channel created since the attempt started, same text: the
  // only trace Buffer keeps of a send whose response was lost.
  async lookup(q: { accountRef: string; body: string; since: string }): Promise<RemotePost | null> {
    const query = `query Posts($channelIds: [ChannelId!]!) {
  posts(input: { filter: { channelIds: $channelIds }, first: 50 }) {
    edges { node { id status dueAt text createdAt error } }
  }
}`;
    const res = await this.call<{ posts: { edges: { node: BufferPost }[] } }>(query, { channelIds: [q.accountRef] });
    if (res.kind === "transport") throw new Error(`Buffer: ${res.error}`);
    const since = new Date(q.since).getTime();
    const matches = (res.data.posts?.edges ?? [])
      .map((e) => e.node)
      .filter((p) => p.text === q.body && (!p.createdAt || new Date(p.createdAt).getTime() >= since));
    if (matches.length === 1) return toRemote(matches[0]!);
    if (matches.length > 1) throw new Error("Buffer: several identical posts found; manual check required");
    return null;
  }

  async listAccounts(): Promise<ProviderAccount[]> {
    let organizationId = this.organizationId;
    if (!organizationId) {
      const acc = await this.call<{ account: { organizations?: { id: string }[]; id?: string } }>(
        `query Account { account { id organizations { id } } }`,
        {},
      );
      if (acc.kind === "transport") throw new Error(`Buffer: ${acc.error}`);
      organizationId = acc.data.account?.organizations?.[0]?.id;
      if (!organizationId) throw new Error("Buffer: no organization on this API key");
    }
    const res = await this.call<{ channels: { id: string; name: string; service: string }[] }>(
      `query Channels($organizationId: OrganizationId!) {
  channels(input: { organizationId: $organizationId }) { id name service }
}`,
      { organizationId },
    );
    if (res.kind === "transport") throw new Error(`Buffer: ${res.error}`);
    return (res.data.channels ?? []).map((c) => ({ externalRef: c.id, service: c.service.toLowerCase(), name: c.name }));
  }

  // One GraphQL round trip. Transport-level outcomes are returned, not
  // thrown, so `publish` can classify them; GraphQL-level `errors` count as
  // a rejection (not retryable) unless the HTTP status says otherwise.
  private async call<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<{ kind: "ok"; data: T } | { kind: "transport"; error: string; retryable: boolean; retryAfterSeconds?: number; code?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return { kind: "transport", error: aborted ? "timeout" : "unreachable", retryable: true, code: aborted ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "");
      return { kind: "transport", error: "rate limited (HTTP 429)", retryable: true, retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60, code: "rate_limit" };
    }
    if (res.status === 401 || res.status === 403) return { kind: "transport", error: `authentication refused (HTTP ${res.status})`, retryable: false, code: "auth" };
    if (res.status >= 500) return { kind: "transport", error: `upstream error (HTTP ${res.status})`, retryable: true, code: "upstream" };
    if (!res.ok) return { kind: "transport", error: `HTTP ${res.status}`, retryable: false, code: "http" };
    let json: GraphQlResponse<T>;
    try {
      json = (await res.json()) as GraphQlResponse<T>;
    } catch {
      return { kind: "transport", error: "non-JSON response", retryable: true, code: "upstream" };
    }
    if (json.errors?.length || !json.data) {
      return { kind: "transport", error: json.errors?.map((e) => e.message).join("; ") || "empty response", retryable: false, code: "graphql" };
    }
    return { kind: "ok", data: json.data };
  }
}
