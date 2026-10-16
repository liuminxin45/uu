import { randomUUID } from 'node:crypto';
import { authorize, fail, identifier, integer, METHODS, object, PROTOCOL, safeCode, uuid, validateGrant, validateRequest, validateResult, validateSession, validateRef, VERSION, WRITE_METHODS } from './protocol.js';
import type { ErrorCode, EvidenceRef, Grant, Method, Request, Response, SessionIdentity } from './protocol.js';

export interface ProviderInfo { authorityId: string; capabilities: Method[]; persistentWrites: boolean }
export interface ProviderContext { session: SessionIdentity; grant: Grant }
export interface TurnCompletion { turnId: string; references: EvidenceRef[] }
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
  requestId: string; sessionId: string; durationMs?: number; errorCode?: ErrorCode; stack?: string;
}
export type DiagnosticSink = (event: Diagnostic) => void;
function checkInfo(value: unknown): asserts value is ProviderInfo {
  const p = object(value, ['authorityId', 'capabilities', 'persistentWrites']);
  identifier(p.authorityId);
  if (!Array.isArray(p.capabilities) || p.capabilities.length > METHODS.length || new Set(p.capabilities).size !== p.capabilities.length || p.capabilities.some(m => !METHODS.includes(m)) || typeof p.persistentWrites !== 'boolean') fail('INITIALIZATION_FAILED');
  if (!p.persistentWrites && p.capabilities.some(m => WRITE_METHODS.includes(m))) fail('INITIALIZATION_FAILED');
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const x of Object.values(value)) freeze(x); Object.freeze(value); } return value; }

/** One session, one explicit trusted grant. No transport, persistence, retry or fallback. */
export class MemorySession {
  readonly context: ProviderContext;
  private provider: MemoryProvider;
  private sink: DiagnosticSink;
  private phase: 'new' | 'ready' | 'closing' | 'closed' = 'new';
  private info?: ProviderInfo;
  private active?: Promise<unknown>;
  private controller?: AbortController;
  private closePromise?: Promise<void>;
  private shutdownWork?: Promise<void>;
  private isClosed(): boolean { return this.phase === 'closed'; }
  constructor(provider: MemoryProvider, context: ProviderContext, sink: DiagnosticSink = () => {}) {
    object(context, ['session', 'grant']); validateSession(context.session); validateGrant(context.grant);
    this.context = freeze(structuredClone(context)); this.provider = provider; this.sink = sink;
  }
  private emit(value: Diagnostic): void { try { this.sink(value); } catch { /* Observability cannot block memory operations. */ } }
  private async operation<T>(operation: Diagnostic['operation'], requestId: string, timeoutMs: number, action: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
    integer(timeoutMs, 1, 10000);
    const started = performance.now(); const base = { operation, requestId, sessionId: this.context.session.id };
    this.emit({ ...base, event: 'started' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    let parentListener: (() => void) | undefined;
    let operationController: AbortController | undefined;
    try {
      if (this.active) fail('PROVIDER_BUSY');
      if (parent?.aborted) fail('CANCELLED');
      const controller = new AbortController(); operationController = controller; this.controller = controller;
      const aborted = new Promise<never>((_, reject) => {
        abortListener = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', abortListener, { once: true });
      });
      // Never forward a caller's abort reason: it can contain message content.
      parentListener = () => { try { fail('CANCELLED'); } catch (e) { controller.abort(e); } };
      parent?.addEventListener('abort', parentListener, { once: true });
      timer = setTimeout(() => { try { fail('TIMEOUT'); } catch (e) { controller.abort(e); } }, timeoutMs);
      const work = Promise.resolve().then(() => { if (controller.signal.aborted) throw controller.signal.reason; return action(controller.signal); });
      this.active = work;
      // Both settlement branches observe the promise immediately and retain the slot until actual settlement.
      void work.then(() => { if (this.active === work) { this.active = undefined; this.controller = undefined; } }, () => { if (this.active === work) { this.active = undefined; this.controller = undefined; } });
      const result = await Promise.race([work, aborted]);
      this.emit({ ...base, event: 'succeeded', durationMs: performance.now() - started });
      return result;
    } catch (error) {
      const code = safeCode(error);
      this.emit({ ...base, event: code === 'CANCELLED' ? 'cancelled' : code === 'TIMEOUT' ? 'timeout' : 'failed', errorCode: code, durationMs: performance.now() - started, stack: new Error(code).stack?.slice(0, 1400) });
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (parentListener) parent?.removeEventListener('abort', parentListener);
      // A timed-out provider still receives its aborted signal and keeps its slot.
      if (abortListener) operationController?.signal.removeEventListener('abort', abortListener);
    }
  }
  async initialize(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ProviderInfo> {
    return this.operation('initialize', randomUUID(), options.timeoutMs ?? 2000, async signal => {
      if (this.phase !== 'new') fail('SESSION_CLOSED');
      const info = await this.provider.initialize(this.context, signal);
      checkInfo(info);
      if (signal.aborted) throw signal.reason;
      if (this.phase !== 'new') fail('SESSION_CLOSED');
      this.info = freeze(structuredClone(info)); this.phase = 'ready'; return this.info;
    }, options.signal);
  }
  async invoke(input: unknown, options: { signal?: AbortSignal } = {}): Promise<Response> {
    let requestId: string = randomUUID(); let request: Request | undefined; let dispatched = false;
    try {
      validateRequest(input); request = structuredClone(input); requestId = request.requestId;
      const fixed = request;
      const result = await this.operation(request.method, requestId, request.budget.timeoutMs, async signal => {
        if (this.phase !== 'ready' || !this.info) fail('SESSION_CLOSED');
        if (fixed.session.id !== this.context.session.id || fixed.session.epoch !== this.context.session.epoch) fail('SCOPE_DENIED');
        authorize(fixed, this.context.grant);
        if (!this.info.capabilities.includes(fixed.method) || (WRITE_METHODS.includes(fixed.method) && !this.info.persistentWrites)) fail('UNSUPPORTED_OPERATION');
        dispatched = true;
        const value = await this.provider.execute(freeze(fixed), signal);
        if (signal.aborted) throw signal.reason;
        validateResult(value, fixed, this.context.grant, this.info.authorityId);
        if (fixed.method === 'health') {
          const health = value as ProviderInfo;
          if (health.persistentWrites !== this.info.persistentWrites || health.capabilities.length !== this.info.capabilities.length || health.capabilities.some(method => !this.info!.capabilities.includes(method))) fail('INVALID_RESPONSE');
        }
        return structuredClone(value);
      }, options.signal);
      return { protocol: PROTOCOL, version: VERSION, requestId, session: this.context.session, ok: true, result: result as never };
    } catch (error) {
      const code = safeCode(error);
      if (!request) {
        try { requestId = uuid((input as {requestId?: unknown})?.requestId); } catch { /* Use a generated correlation id for malformed input. */ }
        this.emit({ event: 'started', operation: 'validate', requestId, sessionId: this.context.session.id });
        this.emit({ event: 'failed', operation: 'validate', requestId, sessionId: this.context.session.id, errorCode: code, stack: new Error(code).stack?.slice(0, 1400) });
      }
      const writing = request && WRITE_METHODS.includes(request.method);
      return { protocol: PROTOCOL, version: VERSION, requestId, session: this.context.session, ok: false, error: { code, writeOutcome: !writing ? 'not-applicable' : dispatched && !['VERSION_CONFLICT', 'SCOPE_DENIED', 'UNSUPPORTED_OPERATION', 'NOT_FOUND'].includes(code) ? 'unknown' : 'not-applied', retry: 'never' } };
    }
  }
  async completeTurn(turn: TurnCompletion, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<void> {
    await this.operation('turnCompleted', randomUUID(), options.timeoutMs ?? 1000, async signal => {
      object(turn, ['turnId', 'references']); uuid(turn.turnId);
      if (!Array.isArray(turn.references) || turn.references.length > 32) fail('INVALID_REQUEST'); turn.references.forEach(validateRef);
      if (this.phase !== 'ready') fail('SESSION_CLOSED');
      await this.provider.onTurnCompleted?.(freeze(structuredClone(turn)), signal);
      if (signal.aborted) throw signal.reason;
    }, options.signal);
  }
  async close(timeoutMs = 1000): Promise<void> {
    integer(timeoutMs, 1, 10000);
    if (this.phase === 'closed') return;
    if (this.closePromise) return this.closePromise;
    this.phase = 'closing';
    const started = performance.now(), base = { operation: 'close' as const, requestId: randomUUID(), sessionId: this.context.session.id };
    this.emit({ ...base, event: 'started' });
    const close = (async () => {
      const until = performance.now() + timeoutMs;
      if (this.controller && !this.controller.signal.aborted) { try { fail('CANCELLED'); } catch (e) { this.controller.abort(e); } }
      if (this.active) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([this.active.catch(() => {}), new Promise<never>((_, reject) => { timer = setTimeout(() => { try { fail('DRAIN_TIMEOUT'); } catch (e) { reject(e); } }, timeoutMs); })]); }
        finally { if (timer) clearTimeout(timer); }
      }
      if (this.isClosed()) return;
      const remaining = Math.max(1, Math.floor(until - performance.now()));
      await this.operation('shutdown', randomUUID(), remaining, async signal => {
        // Start end/shutdown once. A deadline is not permission to replay hooks.
        this.shutdownWork ||= (async () => {
          let endError: unknown; let endFailed = false;
          try { await this.provider.onSessionEnd?.(signal); } catch (error) { endFailed = true; endError = error; }
          await this.provider.shutdown(signal);
          this.phase = 'closed';
          if (endFailed) throw endError;
        })();
        await this.shutdownWork;
      });
    })();
    this.closePromise = close;
    try { await close; this.emit({ ...base, event: 'succeeded', durationMs: performance.now() - started }); }
    catch (error) { const code = safeCode(error); this.emit({ ...base, event: code === 'TIMEOUT' ? 'timeout' : 'failed', errorCode: code, durationMs: performance.now() - started, stack: new Error(code).stack?.slice(0, 1400) }); throw error; }
    finally { if (!this.isClosed()) this.closePromise = undefined; }
  }
}
