import type { ErrorCode, EvidenceRef, Grant, Method, Request, Response, SessionIdentity } from './protocol.js';
export interface ProviderInfo {
    authorityId: string;
    capabilities: Method[];
    persistentWrites: boolean;
}
export interface ProviderContext {
    session: SessionIdentity;
    grant: Grant;
}
export interface TurnCompletion {
    turnId: string;
    references: EvidenceRef[];
}
export interface MemoryProvider {
    initialize(context: ProviderContext, signal: AbortSignal): Promise<ProviderInfo>;
    execute(request: Request, signal: AbortSignal): Promise<unknown>;
    onTurnCompleted?(turn: TurnCompletion, signal: AbortSignal): Promise<void>;
    onSessionEnd?(signal: AbortSignal): Promise<void>;
    shutdown(signal: AbortSignal): Promise<void>;
}
export interface Diagnostic {
    event: 'started' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
    operation: Method | 'validate' | 'initialize' | 'turnCompleted' | 'shutdown' | 'close';
    requestId: string;
    sessionId: string;
    durationMs?: number;
    errorCode?: ErrorCode;
    stack?: string;
}
export type DiagnosticSink = (event: Diagnostic) => void;
/** One session, one explicit trusted grant. No transport, persistence, retry or fallback. */
export declare class MemorySession {
    readonly context: ProviderContext;
    private provider;
    private sink;
    private phase;
    private info?;
    private active?;
    private controller?;
    private closePromise?;
    private shutdownWork?;
    private isClosed;
    constructor(provider: MemoryProvider, context: ProviderContext, sink?: DiagnosticSink);
    private emit;
    private operation;
    initialize(options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<ProviderInfo>;
    invoke(input: unknown, options?: {
        signal?: AbortSignal;
    }): Promise<Response>;
    completeTurn(turn: TurnCompletion, options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<void>;
    close(timeoutMs?: number): Promise<void>;
}
