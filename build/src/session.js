import { randomUUID } from 'node:crypto';
import { authorize, fail, identifier, integer, METHODS, object, PROTOCOL, safeCode, uuid, validateGrant, validateRequest, validateResult, validateSession, validateRef, VERSION, WRITE_METHODS } from './protocol.js';
function checkInfo(value) {
    const p = object(value, ['authorityId', 'capabilities', 'persistentWrites']);
    identifier(p.authorityId);
    if (!Array.isArray(p.capabilities) || p.capabilities.length > METHODS.length || new Set(p.capabilities).size !== p.capabilities.length || p.capabilities.some(m => !METHODS.includes(m)) || typeof p.persistentWrites !== 'boolean')
        fail('INITIALIZATION_FAILED');
    if (!p.persistentWrites && p.capabilities.some(m => WRITE_METHODS.includes(m)))
        fail('INITIALIZATION_FAILED');
}
function freeze(value) { if (value && typeof value === 'object') {
    for (const x of Object.values(value))
        freeze(x);
    Object.freeze(value);
} return value; }
/** One session, one explicit trusted grant. No transport, persistence, retry or fallback. */
export class MemorySession {
    context;
    provider;
    sink;
    phase = 'new';
    info;
    active;
    controller;
    closePromise;
    shutdownWork;
    isClosed() { return this.phase === 'closed'; }
    constructor(provider, context, sink = () => { }) {
        object(context, ['session', 'grant']);
        validateSession(context.session);
        validateGrant(context.grant);
        this.context = freeze(structuredClone(context));
        this.provider = provider;
        this.sink = sink;
    }
    emit(value) { try {
        this.sink(value);
    }
    catch { /* Observability cannot block memory operations. */ } }
    async operation(operation, requestId, timeoutMs, action, parent) {
        integer(timeoutMs, 1, 10000);
        const started = performance.now();
        const base = { operation, requestId, sessionId: this.context.session.id };
        this.emit({ ...base, event: 'started' });
        let timer;
        let abortListener;
        let parentListener;
        let operationController;
        try {
            if (this.active)
                fail('PROVIDER_BUSY');
            if (parent?.aborted)
                fail('CANCELLED');
            const controller = new AbortController();
            operationController = controller;
            this.controller = controller;
            const aborted = new Promise((_, reject) => {
                abortListener = () => reject(controller.signal.reason);
                controller.signal.addEventListener('abort', abortListener, { once: true });
            });
            // Never forward a caller's abort reason: it can contain message content.
            parentListener = () => { try {
                fail('CANCELLED');
            }
            catch (e) {
                controller.abort(e);
            } };
            parent?.addEventListener('abort', parentListener, { once: true });
            timer = setTimeout(() => { try {
                fail('TIMEOUT');
            }
            catch (e) {
                controller.abort(e);
            } }, timeoutMs);
            const work = Promise.resolve().then(() => { if (controller.signal.aborted)
                throw controller.signal.reason; return action(controller.signal); });
            this.active = work;
            // Both settlement branches observe the promise immediately and retain the slot until actual settlement.
            void work.then(() => { if (this.active === work) {
                this.active = undefined;
                this.controller = undefined;
            } }, () => { if (this.active === work) {
                this.active = undefined;
                this.controller = undefined;
            } });
            const result = await Promise.race([work, aborted]);
            this.emit({ ...base, event: 'succeeded', durationMs: performance.now() - started });
            return result;
        }
        catch (error) {
            const code = safeCode(error);
            this.emit({ ...base, event: code === 'CANCELLED' ? 'cancelled' : code === 'TIMEOUT' ? 'timeout' : 'failed', errorCode: code, durationMs: performance.now() - started, stack: new Error(code).stack?.slice(0, 1400) });
            throw error;
        }
        finally {
            if (timer)
                clearTimeout(timer);
            if (parentListener)
                parent?.removeEventListener('abort', parentListener);
            // A timed-out provider still receives its aborted signal and keeps its slot.
            if (abortListener)
                operationController?.signal.removeEventListener('abort', abortListener);
        }
    }
    async initialize(options = {}) {
        return this.operation('initialize', randomUUID(), options.timeoutMs ?? 2000, async (signal) => {
            if (this.phase !== 'new')
                fail('SESSION_CLOSED');
            const info = await this.provider.initialize(this.context, signal);
            checkInfo(info);
            if (signal.aborted)
                throw signal.reason;
            if (this.phase !== 'new')
                fail('SESSION_CLOSED');
            this.info = freeze(structuredClone(info));
            this.phase = 'ready';
            return this.info;
        }, options.signal);
    }
    async invoke(input, options = {}) {
        let requestId = randomUUID();
        let request;
        let dispatched = false;
        try {
            validateRequest(input);
            request = structuredClone(input);
            requestId = request.requestId;
            const fixed = request;
            const result = await this.operation(request.method, requestId, request.budget.timeoutMs, async (signal) => {
                if (this.phase !== 'ready' || !this.info)
                    fail('SESSION_CLOSED');
                if (fixed.session.id !== this.context.session.id || fixed.session.epoch !== this.context.session.epoch)
                    fail('SCOPE_DENIED');
                authorize(fixed, this.context.grant);
                if (!this.info.capabilities.includes(fixed.method) || (WRITE_METHODS.includes(fixed.method) && !this.info.persistentWrites))
                    fail('UNSUPPORTED_OPERATION');
                dispatched = true;
                const value = await this.provider.execute(freeze(fixed), signal);
                if (signal.aborted)
                    throw signal.reason;
                validateResult(value, fixed, this.context.grant, this.info.authorityId);
                if (fixed.method === 'health') {
                    const health = value;
                    if (health.persistentWrites !== this.info.persistentWrites || health.capabilities.length !== this.info.capabilities.length || health.capabilities.some(method => !this.info.capabilities.includes(method)))
                        fail('INVALID_RESPONSE');
                }
                return structuredClone(value);
            }, options.signal);
            return { protocol: PROTOCOL, version: VERSION, requestId, session: this.context.session, ok: true, result: result };
        }
        catch (error) {
            const code = safeCode(error);
            if (!request) {
                try {
                    requestId = uuid(input?.requestId);
                }
                catch { /* Use a generated correlation id for malformed input. */ }
                this.emit({ event: 'started', operation: 'validate', requestId, sessionId: this.context.session.id });
                this.emit({ event: 'failed', operation: 'validate', requestId, sessionId: this.context.session.id, errorCode: code, stack: new Error(code).stack?.slice(0, 1400) });
            }
            const writing = request && WRITE_METHODS.includes(request.method);
            return { protocol: PROTOCOL, version: VERSION, requestId, session: this.context.session, ok: false, error: { code, writeOutcome: !writing ? 'not-applicable' : dispatched && !['VERSION_CONFLICT', 'SCOPE_DENIED', 'UNSUPPORTED_OPERATION', 'NOT_FOUND'].includes(code) ? 'unknown' : 'not-applied', retry: 'never' } };
        }
    }
    async completeTurn(turn, options = {}) {
        await this.operation('turnCompleted', randomUUID(), options.timeoutMs ?? 1000, async (signal) => {
            object(turn, ['turnId', 'references']);
            uuid(turn.turnId);
            if (!Array.isArray(turn.references) || turn.references.length > 32)
                fail('INVALID_REQUEST');
            turn.references.forEach(validateRef);
            if (this.phase !== 'ready')
                fail('SESSION_CLOSED');
            await this.provider.onTurnCompleted?.(freeze(structuredClone(turn)), signal);
            if (signal.aborted)
                throw signal.reason;
        }, options.signal);
    }
    async close(timeoutMs = 1000) {
        integer(timeoutMs, 1, 10000);
        if (this.phase === 'closed')
            return;
        if (this.closePromise)
            return this.closePromise;
        this.phase = 'closing';
        const started = performance.now(), base = { operation: 'close', requestId: randomUUID(), sessionId: this.context.session.id };
        this.emit({ ...base, event: 'started' });
        const close = (async () => {
            const until = performance.now() + timeoutMs;
            if (this.controller && !this.controller.signal.aborted) {
                try {
                    fail('CANCELLED');
                }
                catch (e) {
                    this.controller.abort(e);
                }
            }
            if (this.active) {
                let timer;
                try {
                    await Promise.race([this.active.catch(() => { }), new Promise((_, reject) => { timer = setTimeout(() => { try {
                            fail('DRAIN_TIMEOUT');
                        }
                        catch (e) {
                            reject(e);
                        } }, timeoutMs); })]);
                }
                finally {
                    if (timer)
                        clearTimeout(timer);
                }
            }
            if (this.isClosed())
                return;
            const remaining = Math.max(1, Math.floor(until - performance.now()));
            await this.operation('shutdown', randomUUID(), remaining, async (signal) => {
                // Start end/shutdown once. A deadline is not permission to replay hooks.
                this.shutdownWork ||= (async () => {
                    let endError;
                    let endFailed = false;
                    try {
                        await this.provider.onSessionEnd?.(signal);
                    }
                    catch (error) {
                        endFailed = true;
                        endError = error;
                    }
                    await this.provider.shutdown(signal);
                    this.phase = 'closed';
                    if (endFailed)
                        throw endError;
                })();
                await this.shutdownWork;
            });
        })();
        this.closePromise = close;
        try {
            await close;
            this.emit({ ...base, event: 'succeeded', durationMs: performance.now() - started });
        }
        catch (error) {
            const code = safeCode(error);
            this.emit({ ...base, event: code === 'TIMEOUT' ? 'timeout' : 'failed', errorCode: code, durationMs: performance.now() - started, stack: new Error(code).stack?.slice(0, 1400) });
            throw error;
        }
        finally {
            if (!this.isClosed())
                this.closePromise = undefined;
        }
    }
}
