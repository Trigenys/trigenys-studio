// Integration contracts. Product logic depends on these interfaces only;
// adapters (mock today, live later) are selected by configuration.

export const SOCIAL_CHANNELS = ["linkedin", "x", "instagram", "facebook", "threads"] as const;
export type Channel = (typeof SOCIAL_CHANNELS)[number];
export const isSocialChannel = (value: string): value is Channel => (SOCIAL_CHANNELS as readonly string[]).includes(value);

export type PublishRequest = {
  idempotencyKey: string;
  accountRef: string;
  channel: Channel;
  body: string;
  mediaUrls: string[];
  scheduledAt?: string;
};

export type PublishResult =
  | { status: "scheduled" | "published"; externalId: string; permalink?: string }
  | { status: "failed"; error: string; retryable: boolean; retryAfterSeconds?: number; code?: string };

// A channel as the provider knows it, offered to admins to map accounts.
export type ProviderAccount = { externalRef: string; service: string; name: string };

// What the provider reports about a post it holds.
export type RemotePost = {
  externalId: string;
  status: "scheduled" | "sent" | "error";
  permalink?: string;
  error?: string;
};

export interface Publisher {
  readonly name: string;
  publish(request: PublishRequest): Promise<PublishResult>;
  cancel(externalId: string): Promise<void>;
  // Optional capabilities. The outbox degrades explicitly without them: no
  // reconciliation means an uncertain send is failed, never re-sent.
  listAccounts?(): Promise<ProviderAccount[]>;
  status?(externalId: string): Promise<RemotePost | null>;
  lookup?(query: { accountRef: string; body: string; since: string }): Promise<RemotePost | null>;
}

// What Studio reads from the CMS: enough to preview an article and link it
// to a task without copying its body. `externalRef` is stable across syncs.
export type CmsArticle = {
  externalRef: string;
  locale: string;
  title: string;
  excerpt: string;
  status: "draft" | "published";
  url: string | null;
  publishedAt: string | null;
  updatedAt: string;
};

export type ListQuery = {
  // Only items changed after this instant (ISO); adapters without such a
  // filter return the most recent ones and the sync dedupes.
  since?: string;
  limit: number;
};

export interface Cms {
  readonly name: string;
  listArticles(query: ListQuery): Promise<CmsArticle[]>;
}

// A topic the radar proposes, with where it came from and when it was seen.
export type RadarTopic = {
  externalRef: string;
  title: string;
  angle: string | null;
  format: string | null;
  vertical: string | null;
  score: number | null;
  sources: string[];
  observedAt: string;
  updatedAt: string;
};

export interface Radar {
  readonly name: string;
  listProposals(query: ListQuery): Promise<RadarTopic[]>;
}

export type MetricTarget = { kind: "deliverable" | "url"; ref: string };

export type MetricSnapshot = {
  target: MetricTarget;
  measuredAt: string;
  metrics: Record<string, number>;
};

export interface MetricsProvider {
  readonly name: string;
  fetch(target: MetricTarget): Promise<MetricSnapshot>;
}

export type LlmRequest = {
  step: string;
  // Optional system framing; adapters that have no notion of it prepend it.
  system?: string;
  prompt: string;
  contextRefs: string[];
};

export type LlmResult = {
  model: string;
  output: string;
  tokens: { input: number; output: number };
};

export interface Llm {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResult>;
}

export type Mail = {
  to: string;
  template: "magic-link";
  subject: string;
  text: string;
};

export interface Mailer {
  readonly name: string;
  send(mail: Mail): Promise<void>;
}

export type MediaObject = { bytes: Uint8Array; mime: string };

// Content-addressed object storage for logos and rendered visuals. Keys are
// chosen by the API (never by a client); a put of the same key is idempotent.
export interface MediaStore {
  readonly name: string;
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<MediaObject | null>;
}

export type Integrations = {
  publisher: Publisher;
  cms: Cms;
  radar: Radar;
  metrics: MetricsProvider;
  llm: Llm;
  email: Mailer;
  media: MediaStore;
};
