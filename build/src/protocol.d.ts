export declare const PROTOCOL: "uu.memory";
export declare const VERSION: 1;
export declare const METHODS: readonly ["health", "snapshot", "recall", "resolveEvidence", "listSources", "findEntities", "coverWindow", "drillDown", "changes", "remember", "patch", "forget", "resolveConflict"];
export type Method = typeof METHODS[number];
export declare const WRITE_METHODS: readonly Method[];
export declare const CLASSIFICATIONS: readonly ["public", "personal", "company-internal", "restricted"];
export type Classification = typeof CLASSIFICATIONS[number];
export declare const ERROR_CODES: readonly ["INVALID_REQUEST", "UNSUPPORTED_PROTOCOL", "SCOPE_DENIED", "BUDGET_EXCEEDED", "UNSUPPORTED_OPERATION", "CANCELLED", "TIMEOUT", "PROVIDER_FAILED", "PROVIDER_BUSY", "SESSION_CLOSED", "NOT_FOUND", "VERSION_CONFLICT", "INVALID_RESPONSE", "DRAIN_TIMEOUT", "INITIALIZATION_FAILED"];
export type ErrorCode = typeof ERROR_CODES[number];
export interface Scope {
    principalId: string;
    namespace: string;
    projectId?: string;
}
export interface SessionIdentity {
    id: string;
    epoch: string;
}
export interface Budget {
    maxItems: number;
    maxChars: number;
    timeoutMs: number;
}
/** A trusted Host supplies this grant; never construct it from a wire request. */
export interface Grant {
    scope: Scope;
    classifications: Classification[];
    methods: Method[];
}
export interface EvidenceRef {
    authorityId: string;
    sourceId: string;
    itemId: string;
    revision: string;
}
export interface Coverage {
    omitted: number;
    truncated: boolean;
}
export interface Entry {
    id: string;
    version: string;
    target: 'memory' | 'user';
    scope: Scope;
    classification: Classification;
    text: string;
    provenance: EvidenceRef[];
    expiresAt?: string;
}
export interface Hit {
    ref: EvidenceRef;
    scope: Scope;
    classification: Classification;
    excerpt: string;
    score: number;
}
export interface MemoryNode {
    id: string;
    version: string;
    scope: Scope;
    classification: Classification;
    text: string;
    refs: EvidenceRef[];
}
export interface WriteReceipt {
    writeId: string;
    idempotencyKey: string;
    authorityId: string;
    previousVersion?: string;
    version: string;
    durable: true;
    verified: true;
}
export interface WriteResult {
    receipt: WriteReceipt;
    entryRef: {
        id: string;
        version: string;
    };
}
export interface Params {
    health: Record<string, never>;
    snapshot: Record<string, never>;
    recall: {
        query: string;
        sourceIds?: string[];
        classifications?: Classification[];
    };
    resolveEvidence: {
        ref: EvidenceRef;
    };
    listSources: Record<string, never>;
    findEntities: {
        query: string;
    };
    coverWindow: {
        from: string;
        to: string;
        sourceIds?: string[];
    };
    drillDown: {
        nodeId: string;
        version: string;
    };
    changes: {
        sourceId: string;
        sourceIdentity: string;
        cursor?: string;
    };
    remember: {
        idempotencyKey: string;
        expectedVersion: null;
        entry: Omit<Entry, 'id' | 'version'>;
    };
    patch: {
        idempotencyKey: string;
        expectedVersion: string;
        entryId: string;
        text: string;
        provenance: EvidenceRef[];
    };
    forget: {
        idempotencyKey: string;
        expectedVersion: string;
        entryId: string;
    };
    resolveConflict: {
        idempotencyKey: string;
        expectedVersion: string;
        conflictId: string;
        selectedVersion: string;
    };
}
export interface Results {
    health: {
        state: 'ready' | 'degraded' | 'fixture-readonly';
        authorityId: string;
        capabilities: Method[];
        persistentWrites: boolean;
    };
    snapshot: {
        authorityId: string;
        version: string;
        epoch: string;
        entries: Entry[];
        coverage: Coverage;
    };
    recall: {
        hits: Hit[];
        coverage: Coverage;
    };
    resolveEvidence: {
        ref: EvidenceRef;
        scope: Scope;
        classification: Classification;
        text: string;
        coverage: Coverage;
    };
    listSources: {
        sources: {
            sourceId: string;
            state: 'ready' | 'stale' | 'unavailable' | 'disabled';
            version: string;
        }[];
        coverage: Coverage;
    };
    findEntities: {
        entities: {
            entityId: string;
            name: string;
            scope: Scope;
            classification: Classification;
        }[];
        coverage: Coverage;
    };
    coverWindow: {
        nodes: MemoryNode[];
        coverage: Coverage;
        complete: boolean;
    };
    drillDown: {
        nodes: MemoryNode[];
        coverage: Coverage;
    };
    changes: {
        items: {
            kind: 'upsert' | 'deleted';
            ref: EvidenceRef;
            scope: Scope;
            classification: Classification;
        }[];
        nextCursor?: string;
        complete: boolean;
    };
    remember: WriteResult;
    patch: WriteResult;
    forget: WriteResult;
    resolveConflict: WriteResult;
}
export type Request<M extends Method = Method> = M extends Method ? {
    protocol: typeof PROTOCOL;
    version: typeof VERSION;
    requestId: string;
    session: SessionIdentity;
    scope: Scope;
    budget: Budget;
    method: M;
    params: Params[M];
} : never;
export interface Failure {
    code: ErrorCode;
    writeOutcome: 'not-applicable' | 'not-applied' | 'unknown';
    retry: 'never';
}
export type Response<M extends Method = Method> = {
    protocol: typeof PROTOCOL;
    version: typeof VERSION;
    requestId: string;
    session: SessionIdentity;
} & ({
    ok: true;
    result: Results[M];
} | {
    ok: false;
    error: Failure;
});
export declare class MemoryError extends Error {
    readonly code: ErrorCode;
    constructor(code: ErrorCode);
}
export declare function fail(code: ErrorCode): never;
export declare function safeCode(error: unknown, fallback?: ErrorCode): ErrorCode;
export type RecordValue = Record<string, unknown>;
export declare function object(value: unknown, required: readonly string[], optional?: readonly string[]): RecordValue;
export declare function string(value: unknown, max?: number): string;
export declare function identifier(value: unknown): string;
export declare function uuid(value: unknown): string;
export declare function integer(value: unknown, min: number, max: number): number;
export declare function boolean(value: unknown): boolean;
export declare function array(value: unknown, max?: number): unknown[];
export declare function validateScope(value: unknown): asserts value is Scope;
export declare function sameScope(a: Scope, b: Scope): boolean;
export declare function visibleScope(record: Scope, request: Scope): boolean;
export declare function validateSession(value: unknown): asserts value is SessionIdentity;
export declare function validateRef(value: unknown): asserts value is EvidenceRef;
export declare function sameRef(a: EvidenceRef, b: EvidenceRef): boolean;
export declare function validateGrant(value: unknown): asserts value is Grant;
export declare function validateEntry(value: unknown, write?: boolean): void;
export declare function validateRequest(value: unknown): asserts value is Request;
export declare function authorize(request: Request, grant: Grant): void;
/** Reject malformed, cross-scope, over-budget or falsely durable provider results. */
export declare function validateResult(value: unknown, request: Request, grant: Grant, authorityId: string): void;
export declare function validateResponse(value: unknown, request: Request, grant: Grant, authorityId: string): asserts value is Response;
