// Integration contracts. Product logic depends on these interfaces only;
// adapters (mock today, live later) are selected by configuration.

export type Channel = "linkedin" | "x" | "instagram" | "facebook";

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
  | { status: "failed"; error: string; retryable: boolean };

export interface Publisher {
  readonly name: string;
  publish(request: PublishRequest): Promise<PublishResult>;
  cancel(externalId: string): Promise<void>;
}

export type CmsArticle = {
  externalRef: string;
  title: string;
  url: string;
  publishedAt: string;
  excerpt: string;
};

export interface Cms {
  readonly name: string;
  listRecent(limit: number): Promise<CmsArticle[]>;
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

export type Integrations = {
  publisher: Publisher;
  cms: Cms;
  metrics: MetricsProvider;
  llm: Llm;
  email: Mailer;
};
