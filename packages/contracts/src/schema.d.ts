export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness and readiness of the API */
        get: {
            parameters: {
                query?: {
                    /** @description When true, also checks the database connection */
                    deep?: "true" | "false";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Service state */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Health"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Problem: {
            /** @default about:blank */
            type: string;
            title: string;
            status: number;
            detail?: string;
            instance?: string;
            errors?: {
                path: string;
                message: string;
            }[];
        };
        Health: {
            /** @enum {string} */
            status: "ok" | "degraded";
            service: string;
            version: string;
            /** Format: date-time */
            time: string;
            /** @enum {string} */
            database: "ok" | "unavailable" | "unconfigured" | "unchecked";
            integrations: {
                [key: string]: "mock" | "live";
            };
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
