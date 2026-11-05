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
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Current user and role grants */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Authenticated principal */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Me"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
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
    "/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List role assignments (admin) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Assignments */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RoleAssignment"][];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not an admin */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Grant a role to a user (admin, audited) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["GrantRole"];
                };
            };
            responses: {
                /** @description Already granted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RoleAssignment"];
                    };
                };
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RoleAssignment"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not an admin */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown user */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/roles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke a role assignment (admin, audited) */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Revoked */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not an admin */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown assignment */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List products */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Products */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Product"][];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No role */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Create a product (admin, audited, idempotent on id) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateProduct"];
                };
            };
            responses: {
                /** @description Already exists with the same name */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Product"];
                    };
                };
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Product"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not an admin */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Id already used with another name */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List tasks visible to the caller (filters: product, state, assignee, due date) */
        get: {
            parameters: {
                query?: {
                    productId?: string;
                    state?: "qualifying" | "preparing" | "reviewing" | "visuals" | "awaiting_approval" | "approved" | "scheduled" | "published" | "measured" | "needs_fix" | "rejected" | "failed";
                    assigneeId?: string;
                    dueBefore?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Tasks */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Task"][];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No role */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Create a task in its initial state (audited, Idempotency-Key) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Replays an identical request */
                    "idempotency-key"?: string;
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateTask"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TaskDetail"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown product */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Idempotency-Key reused for a different request */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Task with its latest content, approval and allowed transitions */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Task */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TaskDetail"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update task fields (optimistic concurrency on version, audited) */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UpdateTask"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TaskDetail"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Stale version */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/tasks/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Content versions, newest first */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Versions */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContentVersion"][];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Add a content version; invalidates a pending or granted approval (audited, Idempotency-Key) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Replays an identical request */
                    "idempotency-key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateContentVersion"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContentVersion"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Content is frozen in this state */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Idempotency-Key reused for a different request */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Comments, oldest first */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Comments */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Comment"][];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Comment a task (Idempotency-Key) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Replays an identical request */
                    "idempotency-key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateComment"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Comment"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Idempotency-Key reused for a different request */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/transitions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Transition history, oldest first */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Transitions */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TaskTransition"][];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Move the task along the pipeline (role and guards decided server side, audited, Idempotency-Key) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Replays an identical request */
                    "idempotency-key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["RequestTransition"];
                };
            };
            responses: {
                /** @description Moved */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TaskDetail"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Role or approval missing for this transition */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Transition not available from the current state */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Idempotency-Key reused for a different request */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/approvals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Approval decisions, newest first */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Approvals */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Approval"][];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Approve or reject the current content (reviewer, no self-approval, audited, Idempotency-Key) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Replays an identical request */
                    "idempotency-key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["DecideApproval"];
                };
            };
            responses: {
                /** @description Decided */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TaskDetail"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not a reviewer, or author of the content */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Task is not awaiting approval */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Idempotency-Key reused for a different request */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sources attached to the editorial dossier of the task */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Sources, oldest first */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TaskSource"][];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Attach a source to the dossier (audited, Idempotency-Key) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Replays an identical request */
                    "idempotency-key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateTaskSource"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TaskSource"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Idempotency-Key reused for a different request */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/sources/{sourceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Detach a source from the dossier (audited) */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    sourceId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Removed */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task or source */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/assistant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Assistant interactions on the task, newest first */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Interactions */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AiInteraction"][];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Ask the assistant for a proposal built from the dossier (audited, Idempotency-Key); never writes content */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Replays an identical request */
                    "idempotency-key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["AssistRequest"];
                };
            };
            responses: {
                /** @description Proposal recorded */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AiInteraction"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Content is frozen, or the action needs a version that does not exist */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Idempotency-Key reused for a different request, or the model declined */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description LLM provider rate limit */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description LLM provider unavailable */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/assistant/{interactionId}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Turn a proposal into a new content version (audited, Idempotency-Key) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Replays an identical request */
                    "idempotency-key"?: string;
                };
                path: {
                    id: string;
                    interactionId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Version created from the proposal */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContentVersion"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task or interaction */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Content is frozen or the proposal was already decided */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Idempotency-Key reused for a different request */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{id}/assistant/{interactionId}/dismiss": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Discard a proposal (kept in the journal) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    interactionId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Dismissed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AiInteraction"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown task or interaction */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description The proposal was already decided */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Items received from the CMS and the radar, most recent first */
        get: {
            parameters: {
                query?: {
                    origin?: "cms" | "radar";
                    status?: "new" | "linked" | "ignored";
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Items */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ImportItem"][];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
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
    "/imports/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pull recent items from the CMS and/or the radar (upsert, never resets decisions) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["SyncImports"];
                };
            };
            responses: {
                /** @description Per-origin counts */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SyncReport"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Upstream unavailable */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Integration not configured */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One item, for preview before any editorial action */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Item */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ImportItem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown import */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
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
    "/imports/{id}/task": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a task from the item, with sources carrying its provenance (audited, Idempotency-Key) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Replays an identical request */
                    "idempotency-key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["LinkImport"];
                };
            };
            responses: {
                /** @description Item now linked to the created task */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ImportItem"];
                    };
                };
                /** @description Invalid body */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed on this product */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown import or product */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Item already linked or ignored */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Idempotency-Key reused for a different request */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}/ignore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set the item aside without creating anything (audited) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Item ignored */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ImportItem"];
                    };
                };
                /** @description No valid session */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not allowed */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown import */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Item already linked to a task */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
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
        Me: {
            userId: string;
            /** Format: email */
            email: string;
            name: string;
            grants: components["schemas"]["RoleGrant"][];
        };
        RoleGrant: {
            /** @enum {string} */
            role: "admin" | "operator" | "reviewer";
            /** @description null when the role covers every product */
            productId: string | null;
        };
        RoleAssignment: {
            /** Format: uuid */
            id: string;
            userId: string;
            /** @enum {string} */
            role: "admin" | "operator" | "reviewer";
            productId: string | null;
            grantedBy: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        GrantRole: {
            userId: string;
            /** @enum {string} */
            role: "admin" | "operator" | "reviewer";
            /** @default null */
            productId: string | null;
        };
        Product: {
            id: string;
            name: string;
            /** Format: date-time */
            createdAt: string;
        };
        CreateProduct: {
            /** @example insight */
            id: string;
            name: string;
        };
        Task: {
            /** Format: uuid */
            id: string;
            productId: string;
            type: string;
            title: string;
            brief: string;
            /** @enum {string} */
            state: "qualifying" | "preparing" | "reviewing" | "visuals" | "awaiting_approval" | "approved" | "scheduled" | "published" | "measured" | "needs_fix" | "rejected" | "failed";
            priority: number;
            /** Format: date-time */
            dueAt: string | null;
            assigneeId: string | null;
            version: number;
            createdBy: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        TaskDetail: components["schemas"]["Task"] & {
            latestVersion: components["schemas"]["ContentVersion"] | null;
            latestApproval: components["schemas"]["Approval"] | null;
            approvalValid: boolean;
            allowedTransitions: ("qualifying" | "preparing" | "reviewing" | "visuals" | "awaiting_approval" | "approved" | "scheduled" | "published" | "measured" | "needs_fix" | "rejected" | "failed")[];
        };
        ContentVersion: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            taskId: string;
            n: number;
            channel: string;
            body: string;
            contentHash: string;
            aiAssisted: boolean;
            authorId: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        Approval: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            taskId: string;
            /** Format: uuid */
            contentVersionId: string;
            contentHash: string;
            assetSetHash: string;
            approverId: string | null;
            /** @enum {string} */
            decision: "approved" | "rejected";
            comment: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        CreateTask: {
            productId: string;
            /** @example post */
            type: string;
            title: string;
            /** @default  */
            brief: string;
            /** @default 0 */
            priority: number;
            /**
             * Format: date-time
             * @default null
             */
            dueAt: string | null;
            /** @default null */
            assigneeId: string | null;
        };
        UpdateTask: {
            version: number;
            type?: string;
            title?: string;
            brief?: string;
            priority?: number;
            /** Format: date-time */
            dueAt?: string | null;
            assigneeId?: string | null;
        };
        CreateContentVersion: {
            /** @example linkedin */
            channel: string;
            body: string;
            /** @default false */
            aiAssisted: boolean;
        };
        Comment: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            taskId: string;
            authorId: string | null;
            body: string;
            /** Format: date-time */
            createdAt: string;
        };
        CreateComment: {
            body: string;
        };
        TaskTransition: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            taskId: string;
            /** @enum {string} */
            fromState: "qualifying" | "preparing" | "reviewing" | "visuals" | "awaiting_approval" | "approved" | "scheduled" | "published" | "measured" | "needs_fix" | "rejected" | "failed";
            /** @enum {string} */
            toState: "qualifying" | "preparing" | "reviewing" | "visuals" | "awaiting_approval" | "approved" | "scheduled" | "published" | "measured" | "needs_fix" | "rejected" | "failed";
            actorId: string | null;
            reason: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        RequestTransition: {
            /** @enum {string} */
            to: "qualifying" | "preparing" | "reviewing" | "visuals" | "awaiting_approval" | "approved" | "scheduled" | "published" | "measured" | "needs_fix" | "rejected" | "failed";
            /** @default null */
            reason: string | null;
        };
        DecideApproval: {
            /** @enum {string} */
            decision: "approved" | "rejected";
            /** @default null */
            comment: string | null;
        };
        TaskSource: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            taskId: string;
            /** @enum {string} */
            origin: "manual" | "radar" | "cms";
            title: string;
            url: string | null;
            note: string;
            addedBy: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        CreateTaskSource: {
            /**
             * @default manual
             * @enum {string}
             */
            origin: "manual" | "radar" | "cms";
            title: string;
            /**
             * Format: uri
             * @default null
             */
            url: string | null;
            /** @default  */
            note: string;
        };
        AiInteraction: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            taskId: string;
            /** @enum {string} */
            action: "propose" | "fix" | "summarize" | "adapt";
            channel: string;
            instruction: string;
            model: string;
            actorId: string | null;
            contextRefs: string[];
            inputHash: string;
            output: string;
            tokensIn: number;
            tokensOut: number;
            /** @enum {string} */
            status: "proposed" | "accepted" | "dismissed";
            /** Format: uuid */
            acceptedVersionId: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        AssistRequest: {
            /** @enum {string} */
            action: "propose" | "fix" | "summarize" | "adapt";
            /** @example linkedin */
            channel: string;
            /** @default  */
            instruction: string;
        };
        ImportItem: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            origin: "cms" | "radar";
            externalRef: string;
            title: string;
            url: string | null;
            summary: string;
            sources: string[];
            payload: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            observedAt: string;
            /** @enum {string} */
            status: "new" | "linked" | "ignored";
            /** Format: uuid */
            taskId: string | null;
            decidedBy: string | null;
            /** Format: date-time */
            decidedAt: string | null;
            /** Format: date-time */
            firstSeenAt: string;
            /** Format: date-time */
            syncedAt: string;
        };
        SyncReport: {
            origins: {
                /** @enum {string} */
                origin: "cms" | "radar";
                fetched: number;
                created: number;
                updated: number;
            }[];
        };
        SyncImports: {
            /**
             * @default all
             * @enum {string}
             */
            origin: "cms" | "radar" | "all";
            /** @default 50 */
            limit: number;
            /**
             * Format: date-time
             * @description Only items updated upstream after this instant
             */
            since?: string;
        };
        LinkImport: {
            productId: string;
            /** @default post */
            type: string;
            title?: string;
            /** @default null */
            assigneeId: string | null;
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
