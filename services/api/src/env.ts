export type IntegrationMode = "mock" | "live";

export type Bindings = {
  SERVICE_NAME?: string;
  HYPERDRIVE?: Hyperdrive;
  INTEGRATION_PUBLISHER_MODE?: IntegrationMode;
  INTEGRATION_CMS_MODE?: IntegrationMode;
  INTEGRATION_METRICS_MODE?: IntegrationMode;
  INTEGRATION_LLM_MODE?: IntegrationMode;
};

export type AppEnv = { Bindings: Bindings };
