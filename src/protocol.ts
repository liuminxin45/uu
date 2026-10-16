export const PROTOCOL = 'uu.memory' as const;
export const VERSION = 1 as const;
export const METHODS = Object.freeze(['health', 'snapshot', 'recall', 'resolveEvidence', 'listSources', 'findEntities', 'coverWindow', 'drillDown', 'changes', 'remember', 'patch', 'forget', 'resolveConflict'] as const);
export type Method = typeof METHODS[number];
export const WRITE_METHODS: readonly Method[] = Object.freeze(['remember', 'patch', 'forget', 'resolveConflict']);
export const CLASSIFICATIONS = Object.freeze(['public', 'personal', 'company-internal', 'restricted'] as const);
export type Classification = typeof CLASSIFICATIONS[number];
export const ERROR_CODES = Object.freeze(['INVALID_REQUEST', 'UNSUPPORTED_PROTOCOL', 'SCOPE_DENIED', 'BUDGET_EXCEEDED', 'UNSUPPORTED_OPERATION', 'CANCELLED', 'TIMEOUT', 'PROVIDER_FAILED', 'PROVIDER_BUSY', 'SESSION_CLOSED', 'NOT_FOUND', 'VERSION_CONFLICT', 'INVALID_RESPONSE', 'DRAIN_TIMEOUT', 'INITIALIZATION_FAILED'] as const);
export type ErrorCode = typeof ERROR_CODES[number];
export interface Scope { principalId: string; namespace: string; projectId?: string }
export interface SessionIdentity { id: string; epoch: string }
export interface Budget { maxItems: number; maxChars: number; timeoutMs: number }
/** A trusted Host supplies this grant; never construct it from a wire request. */
export interface Grant { scope: Scope; classifications: Classification[]; methods: Method[] }
export interface EvidenceRef { authorityId: string; sourceId: string; itemId: string; revision: string }
export interface Coverage { omitted: number; truncated: boolean }
export interface Entry { id: string; version: string; target: 'memory' | 'user'; scope: Scope; classification: Classification; text: string; provenance: EvidenceRef[]; expiresAt?: string }
export interface Hit { ref: EvidenceRef; scope: Scope; classification: Classification; excerpt: string; score: number }
export interface MemoryNode { id: string; version: string; scope: Scope; classification: Classification; text: string; refs: EvidenceRef[] }
export interface WriteReceipt { writeId: string; idempotencyKey: string; authorityId: string; previousVersion?: string; version: string; durable: true; verified: true }
export interface WriteResult { receipt: WriteReceipt; entryRef: { id: string; version: string } }
export interface Params {
  health: Record<string, never>;
  snapshot: Record<string, never>;
  recall: { query: string; sourceIds?: string[]; classifications?: Classification[] };
  resolveEvidence: { ref: EvidenceRef };
  listSources: Record<string, never>;
  findEntities: { query: string };
  coverWindow: { from: string; to: string; sourceIds?: string[] };
  drillDown: { nodeId: string; version: string };
  changes: { sourceId: string; sourceIdentity: string; cursor?: string };
  remember: { idempotencyKey: string; expectedVersion: null; entry: Omit<Entry, 'id' | 'version'> };
  patch: { idempotencyKey: string; expectedVersion: string; entryId: string; text: string; provenance: EvidenceRef[] };
  forget: { idempotencyKey: string; expectedVersion: string; entryId: string };
  resolveConflict: { idempotencyKey: string; expectedVersion: string; conflictId: string; selectedVersion: string };
}
export interface Results {
  health: { state: 'ready' | 'degraded' | 'fixture-readonly'; authorityId: string; capabilities: Method[]; persistentWrites: boolean };
  snapshot: { authorityId: string; version: string; epoch: string; entries: Entry[]; coverage: Coverage };
  recall: { hits: Hit[]; coverage: Coverage };
  resolveEvidence: { ref: EvidenceRef; scope: Scope; classification: Classification; text: string; coverage: Coverage };
  listSources: { sources: { sourceId: string; state: 'ready' | 'stale' | 'unavailable' | 'disabled'; version: string }[]; coverage: Coverage };
  findEntities: { entities: { entityId: string; name: string; scope: Scope; classification: Classification }[]; coverage: Coverage };
  coverWindow: { nodes: MemoryNode[]; coverage: Coverage; complete: boolean };
  drillDown: { nodes: MemoryNode[]; coverage: Coverage };
  changes: { items: { kind: 'upsert' | 'deleted'; ref: EvidenceRef; scope: Scope; classification: Classification }[]; nextCursor?: string; complete: boolean };
  remember: WriteResult; patch: WriteResult; forget: WriteResult; resolveConflict: WriteResult;
}
export type Request<M extends Method = Method> = M extends Method ? { protocol: typeof PROTOCOL; version: typeof VERSION; requestId: string; session: SessionIdentity; scope: Scope; budget: Budget; method: M; params: Params[M] } : never;
export interface Failure { code: ErrorCode; writeOutcome: 'not-applicable' | 'not-applied' | 'unknown'; retry: 'never' }
export type Response<M extends Method = Method> = { protocol: typeof PROTOCOL; version: typeof VERSION; requestId: string; session: SessionIdentity } & ({ ok: true; result: Results[M] } | { ok: false; error: Failure });
export class MemoryError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) { super(code); this.code = code; }
}
export function fail(code: ErrorCode): never { throw new MemoryError(code); }
export function safeCode(error: unknown, fallback: ErrorCode = 'PROVIDER_FAILED'): ErrorCode { return error instanceof MemoryError && ERROR_CODES.includes(error.code) ? error.code : fallback; }
export type RecordValue = Record<string, unknown>;
export function object(value: unknown, required: readonly string[], optional: readonly string[] = []): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_REQUEST');
  const obj = value as RecordValue;
  if (required.some(k => !Object.hasOwn(obj, k)) || Reflect.ownKeys(obj).some(k => typeof k !== 'string' || (!required.includes(k) && !optional.includes(k)))) fail('INVALID_REQUEST');
  if (Object.values(Object.getOwnPropertyDescriptors(obj)).some(d => !('value' in d) || !d.enumerable)) fail('INVALID_REQUEST');
  return obj;
}
export function string(value: unknown, max = 256): string { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('INVALID_REQUEST'); return value; }
export function identifier(value: unknown): string { const s = string(value, 128); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s)) fail('INVALID_REQUEST'); return s; }
export function uuid(value: unknown): string { const s = string(value, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) fail('INVALID_REQUEST'); return s; }
export function integer(value: unknown, min: number, max: number): number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail('INVALID_REQUEST'); return value as number; }
export function boolean(value: unknown): boolean { if (typeof value !== 'boolean') fail('INVALID_REQUEST'); return value; }
export function array(value: unknown, max = 100): unknown[] { if (!Array.isArray(value) || value.length > max) fail('INVALID_REQUEST'); return value; }
function member<T extends string>(value: unknown, values: readonly T[]): T { if (!values.includes(value as T)) fail('INVALID_REQUEST'); return value as T; }
function date(value: unknown): string { const s = string(value, 24); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) fail('INVALID_REQUEST'); return s; }
export function validateScope(value: unknown): asserts value is Scope { const s = object(value, ['principalId', 'namespace'], ['projectId']); identifier(s.principalId); identifier(s.namespace); if (s.projectId !== undefined) identifier(s.projectId); }
export function sameScope(a: Scope, b: Scope): boolean { return a.principalId === b.principalId && a.namespace === b.namespace && a.projectId === b.projectId; }
export function visibleScope(record: Scope, request: Scope): boolean { return record.principalId === request.principalId && record.namespace === request.namespace && (record.projectId === undefined || record.projectId === request.projectId); }
export function validateSession(value: unknown): asserts value is SessionIdentity { const s = object(value, ['id', 'epoch']); uuid(s.id); uuid(s.epoch); }
export function validateRef(value: unknown): asserts value is EvidenceRef { const r = object(value, ['authorityId', 'sourceId', 'itemId', 'revision']); Object.values(r).forEach(identifier); }
export function sameRef(a: EvidenceRef, b: EvidenceRef): boolean { return a.authorityId === b.authorityId && a.sourceId === b.sourceId && a.itemId === b.itemId && a.revision === b.revision; }
function refs(value: unknown): void { array(value, 16).forEach(validateRef); }
function classifications(value: unknown): void { const values = array(value, 4); if (!values.length || new Set(values).size !== values.length) fail('INVALID_REQUEST'); values.forEach(v => member(v, CLASSIFICATIONS)); }
export function validateGrant(value: unknown): asserts value is Grant { const g = object(value, ['scope', 'classifications', 'methods']); validateScope(g.scope); classifications(g.classifications); const methods = array(g.methods, METHODS.length); if (!methods.length || new Set(methods).size !== methods.length) fail('INVALID_REQUEST'); methods.forEach(m => member(m, METHODS)); }
function sourceIds(value: unknown): void { const ids = array(value, 8); if (!ids.length || new Set(ids).size !== ids.length) fail('INVALID_REQUEST'); ids.forEach(identifier); }
export function validateEntry(value: unknown, write = false): void {
  const e = object(value, [...(write ? [] : ['id', 'version']), 'target', 'scope', 'classification', 'text', 'provenance'], ['expiresAt']);
  if (!write) { identifier(e.id); identifier(e.version); }
  member(e.target, ['memory', 'user']); validateScope(e.scope); member(e.classification, CLASSIFICATIONS); string(e.text, 32768); refs(e.provenance); if (e.expiresAt !== undefined) date(e.expiresAt);
}
export function validateRequest(value: unknown): asserts value is Request {
  const r = object(value, ['protocol', 'version', 'requestId', 'session', 'scope', 'budget', 'method', 'params']);
  if (r.protocol !== PROTOCOL || r.version !== VERSION) fail('UNSUPPORTED_PROTOCOL');
  uuid(r.requestId); validateSession(r.session); validateScope(r.scope);
  const b = object(r.budget, ['maxItems', 'maxChars', 'timeoutMs']); integer(b.maxItems, 1, 100); integer(b.maxChars, 1, 32768); integer(b.timeoutMs, 1, 10000);
  const method = member(r.method, METHODS);
  const p = r.params;
  switch (method) {
    case 'health': case 'snapshot': case 'listSources': object(p, []); break;
    case 'recall': { const a = object(p, ['query'], ['sourceIds', 'classifications']); string(a.query, 2048); if (a.sourceIds !== undefined) sourceIds(a.sourceIds); if (a.classifications !== undefined) classifications(a.classifications); break; }
    case 'resolveEvidence': { const a = object(p, ['ref']); validateRef(a.ref); break; }
    case 'findEntities': { const a = object(p, ['query']); string(a.query, 2048); break; }
    case 'coverWindow': { const a = object(p, ['from', 'to'], ['sourceIds']); if (date(a.from) > date(a.to)) fail('INVALID_REQUEST'); if (a.sourceIds !== undefined) sourceIds(a.sourceIds); break; }
    case 'drillDown': { const a = object(p, ['nodeId', 'version']); identifier(a.nodeId); identifier(a.version); break; }
    case 'changes': { const a = object(p, ['sourceId', 'sourceIdentity'], ['cursor']); identifier(a.sourceId); identifier(a.sourceIdentity); if (a.cursor !== undefined) identifier(a.cursor); break; }
    case 'remember': { const a = object(p, ['idempotencyKey', 'expectedVersion', 'entry']); uuid(a.idempotencyKey); if (a.expectedVersion !== null) fail('INVALID_REQUEST'); validateEntry(a.entry, true); break; }
    case 'patch': { const a = object(p, ['idempotencyKey', 'expectedVersion', 'entryId', 'text', 'provenance']); uuid(a.idempotencyKey); identifier(a.expectedVersion); identifier(a.entryId); string(a.text, 32768); refs(a.provenance); break; }
    case 'forget': { const a = object(p, ['idempotencyKey', 'expectedVersion', 'entryId']); uuid(a.idempotencyKey); identifier(a.expectedVersion); identifier(a.entryId); break; }
    case 'resolveConflict': { const a = object(p, ['idempotencyKey', 'expectedVersion', 'conflictId', 'selectedVersion']); uuid(a.idempotencyKey); identifier(a.expectedVersion); identifier(a.conflictId); identifier(a.selectedVersion); break; }
  }
  if (JSON.stringify(value).length > 65536) fail('BUDGET_EXCEEDED');
}
export function authorize(request: Request, grant: Grant): void {
  if (!sameScope(request.scope, grant.scope)) fail('SCOPE_DENIED');
  if (!grant.methods.includes(request.method)) fail('UNSUPPORTED_OPERATION');
  if (request.method === 'recall' && request.params.classifications?.some(c => !grant.classifications.includes(c))) fail('SCOPE_DENIED');
  if (request.method === 'remember') { const e = request.params.entry; if (!sameScope(e.scope, grant.scope) || !grant.classifications.includes(e.classification)) fail('SCOPE_DENIED'); }
}
function coverage(value: unknown): void { const c = object(value, ['omitted', 'truncated']); integer(c.omitted, 0, Number.MAX_SAFE_INTEGER); boolean(c.truncated); }
function scoped(value: unknown, request: Request, grant: Grant): void {
  const v = value as { scope: unknown; classification: unknown };
  validateScope(v.scope); const c = member(v.classification, CLASSIFICATIONS);
  if (!visibleScope(v.scope, request.scope) || !grant.classifications.includes(c)) fail('SCOPE_DENIED');
}
function node(value: unknown, request: Request, grant: Grant): void { const n = object(value, ['id', 'version', 'scope', 'classification', 'text', 'refs']); identifier(n.id); identifier(n.version); string(n.text, 32768); refs(n.refs); scoped(n, request, grant); }
function countContent(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((n, x) => n + countContent(x), 0);
  if (value && typeof value === 'object') return Object.entries(value).reduce((n, [key, x]) => n + (['text', 'excerpt', 'name'].includes(key) && typeof x === 'string' ? x.length : countContent(x)), 0);
  return 0;
}
function resultItems(value: unknown, request: Request): unknown[] { if (Array.isArray(value) && value.length > request.budget.maxItems) fail('BUDGET_EXCEEDED'); return array(value, request.budget.maxItems); }
/** Reject malformed, cross-scope, over-budget or falsely durable provider results. */
export function validateResult(value: unknown, request: Request, grant: Grant, authorityId: string): void {
  try {
    const method = request.method;
    if (WRITE_METHODS.includes(method)) {
      const v = object(value, ['receipt', 'entryRef']), r = object(v.receipt, ['writeId', 'idempotencyKey', 'authorityId', 'version', 'durable', 'verified'], ['previousVersion']);
      uuid(r.writeId); uuid(r.idempotencyKey); identifier(r.authorityId); identifier(r.version);
      if (r.durable !== true || r.verified !== true || r.authorityId !== authorityId || r.idempotencyKey !== (request.params as Params['forget']).idempotencyKey) fail('INVALID_RESPONSE');
      if (method !== 'remember' && r.previousVersion !== (request.params as Params['forget']).expectedVersion) fail('INVALID_RESPONSE');
      if (method === 'remember' && r.previousVersion !== undefined) fail('INVALID_RESPONSE');
      const ref = object(v.entryRef, ['id', 'version']); identifier(ref.id); if (ref.version !== r.version) fail('INVALID_RESPONSE');
      if ((request.method === 'patch' || request.method === 'forget') && ref.id !== request.params.entryId) fail('INVALID_RESPONSE');
    } else switch (method) {
      case 'health': {
        const h = object(value, ['state', 'authorityId', 'capabilities', 'persistentWrites']);
        member(h.state, ['ready', 'degraded', 'fixture-readonly']);
        if (h.authorityId !== authorityId) fail('INVALID_RESPONSE');
        const capabilities = array(h.capabilities, METHODS.length);
        capabilities.forEach(m => member(m, METHODS)); boolean(h.persistentWrites);
        if (new Set(capabilities).size !== capabilities.length || (!h.persistentWrites && capabilities.some(m => WRITE_METHODS.includes(m as Method)))) fail('INVALID_RESPONSE');
        break;
      }
      case 'snapshot': {
        const s = object(value, ['authorityId', 'version', 'epoch', 'entries', 'coverage']);
        if (s.authorityId !== authorityId || s.epoch !== request.session.epoch) fail('INVALID_RESPONSE');
        identifier(s.version); resultItems(s.entries, request).forEach(e => { validateEntry(e); scoped(e, request, grant); }); coverage(s.coverage); break;
      }
      case 'recall': {
        const r = object(value, ['hits', 'coverage']), params = (request as Request<'recall'>).params;
        resultItems(r.hits, request).forEach(h => {
          const hit = object(h, ['ref', 'scope', 'classification', 'excerpt', 'score']); validateRef(hit.ref); string(hit.excerpt, 32768);
          if (typeof hit.score !== 'number' || !Number.isFinite(hit.score) || hit.score < 0 || hit.score > 1) fail('INVALID_RESPONSE');
          scoped(hit, request, grant);
          if ((params.sourceIds && !params.sourceIds.includes(hit.ref.sourceId)) || (params.classifications && !params.classifications.includes(hit.classification as Classification))) fail('INVALID_RESPONSE');
        }); coverage(r.coverage); break;
      }
      case 'resolveEvidence': {
        const e = object(value, ['ref', 'scope', 'classification', 'text', 'coverage']); validateRef(e.ref);
        if (!sameRef(e.ref, (request as Request<'resolveEvidence'>).params.ref)) fail('INVALID_RESPONSE');
        string(e.text, 32768); scoped(e, request, grant); coverage(e.coverage); break;
      }
      case 'listSources': { const r = object(value, ['sources', 'coverage']); resultItems(r.sources, request).forEach(s => { const row = object(s, ['sourceId', 'state', 'version']); identifier(row.sourceId); identifier(row.version); member(row.state, ['ready', 'stale', 'unavailable', 'disabled']); }); coverage(r.coverage); break; }
      case 'findEntities': { const r = object(value, ['entities', 'coverage']); resultItems(r.entities, request).forEach(e => { const row = object(e, ['entityId', 'name', 'scope', 'classification']); identifier(row.entityId); string(row.name, 256); scoped(row, request, grant); }); coverage(r.coverage); break; }
      case 'coverWindow': case 'drillDown': { const r = object(value, ['nodes', 'coverage', ...(method === 'coverWindow' ? ['complete'] : [])]); resultItems(r.nodes, request).forEach(n => node(n, request, grant)); coverage(r.coverage); if (method === 'coverWindow') { boolean(r.complete); if (r.complete && (r.coverage as Coverage).omitted > 0) fail('INVALID_RESPONSE'); } break; }
      case 'changes': {
        const r = object(value, ['items', 'complete'], ['nextCursor']); resultItems(r.items, request).forEach(i => {
          const c = object(i, ['kind', 'ref', 'scope', 'classification']); member(c.kind, ['upsert', 'deleted']); validateRef(c.ref); scoped(c, request, grant);
          if (c.ref.sourceId !== (request as Request<'changes'>).params.sourceId) fail('INVALID_RESPONSE');
        }); boolean(r.complete); if (r.nextCursor !== undefined) identifier(r.nextCursor); if (!r.complete && !r.nextCursor) fail('INVALID_RESPONSE'); break;
      }
    }
    if (countContent(value) > request.budget.maxChars || JSON.stringify(value).length > 262144) fail('BUDGET_EXCEEDED');
  } catch (error) {
    if (error instanceof MemoryError && ['SCOPE_DENIED', 'BUDGET_EXCEEDED', 'INVALID_RESPONSE'].includes(error.code)) throw error;
    fail('INVALID_RESPONSE');
  }
}

export function validateResponse(value: unknown, request: Request, grant: Grant, authorityId: string): asserts value is Response {
  try {
    const v = object(value, ['protocol', 'version', 'requestId', 'session', 'ok', (value as {ok?: unknown})?.ok === true ? 'result' : 'error']);
    if (v.protocol !== PROTOCOL || v.version !== VERSION || v.requestId !== request.requestId) fail('INVALID_RESPONSE');
    validateSession(v.session);
    if (v.session.id !== request.session.id || v.session.epoch !== request.session.epoch) fail('INVALID_RESPONSE');
    if (v.ok === true) validateResult(v.result, request, grant, authorityId);
    else {
      if (v.ok !== false) fail('INVALID_RESPONSE');
      const e = object(v.error, ['code', 'writeOutcome', 'retry']);
      member(e.code, ERROR_CODES); member(e.writeOutcome, ['not-applicable', 'not-applied', 'unknown']);
      if (e.retry !== 'never' || (!WRITE_METHODS.includes(request.method) && e.writeOutcome !== 'not-applicable')) fail('INVALID_RESPONSE');
    }
  } catch (error) {
    if (error instanceof MemoryError && error.code !== 'INVALID_REQUEST') throw error;
    fail('INVALID_RESPONSE');
  }
}
