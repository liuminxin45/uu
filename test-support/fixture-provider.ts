import { fail, sameRef, visibleScope } from '../src/protocol.js';
import type { Entry, EvidenceRef, Grant, MemoryNode, Request, Scope } from '../src/protocol.js';
import type { MemoryProvider, ProviderContext, ProviderInfo } from '../src/session.js';

export const READ_METHODS = ['health', 'snapshot', 'recall', 'resolveEvidence', 'listSources', 'findEntities', 'coverWindow', 'drillDown', 'changes'] as const;
export const FIXTURE_GRANT: Grant = { scope: { principalId: 'fixture-user', namespace: 'fixture-space', projectId: 'fixture-project' }, classifications: ['public', 'personal', 'company-internal'], methods: [...READ_METHODS, 'remember', 'patch', 'forget', 'resolveConflict'] };
export interface FixtureRecord { ref: EvidenceRef; scope: Scope; classification: Entry['classification']; text: string; occurredAt: string; entities: {id: string; name: string}[]; deleted: boolean }
export interface FixtureData { kind: 'uu-m1-synthetic'; version: 1; authorityId: string; sourceIdentity: string; entries: Entry[]; records: FixtureRecord[] }
export class FixtureProvider implements MemoryProvider {
  private data: FixtureData;
  private context?: ProviderContext;
  private closed = false;
  readonly persistentWrites = false;
  constructor(data: FixtureData) { this.data = structuredClone(data); }
  async initialize(context: ProviderContext, signal: AbortSignal): Promise<ProviderInfo> {
    signal.throwIfAborted(); if (this.context || this.closed) fail('SESSION_CLOSED');
    this.context = context;
    return { authorityId: this.data.authorityId, capabilities: [...READ_METHODS], persistentWrites: false };
  }
  private visible(row: { scope: Scope; classification: Entry['classification'] }): boolean {
    return !!this.context && visibleScope(row.scope, this.context.grant.scope) && this.context.grant.classifications.includes(row.classification);
  }
  private visibleRecords(): FixtureRecord[] { return this.data.records.filter(r => this.visible(r)); }
  private node(record: FixtureRecord): MemoryNode { return { id: record.ref.itemId, version: record.ref.revision, scope: record.scope, classification: record.classification, text: record.text, refs: [record.ref] }; }
  private bounded<T>(rows: T[], request: Request, size: (row: T) => number): { rows: T[]; coverage: { omitted: number; truncated: boolean } } {
    const selected: T[] = []; let used = 0;
    for (const row of rows) { const chars = size(row); if (selected.length < request.budget.maxItems && used + chars <= request.budget.maxChars) { selected.push(row); used += chars; } }
    return { rows: selected, coverage: { omitted: rows.length - selected.length, truncated: false } };
  }
  async execute(request: Request, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted(); if (!this.context || this.closed) fail('SESSION_CLOSED');
    const records = this.visibleRecords().filter(r => !r.deleted);
    switch (request.method) {
      case 'health': return { state: 'fixture-readonly', authorityId: this.data.authorityId, capabilities: [...READ_METHODS], persistentWrites: false };
      case 'snapshot': {
        const entries = this.data.entries.filter(e => this.visible(e) && (!e.expiresAt || Date.parse(e.expiresAt) > Date.now()) && e.provenance.every(ref => records.some(r => sameRef(r.ref, ref))));
        const result = this.bounded(entries, request, e => e.text.length);
        return { authorityId: this.data.authorityId, version: 'fixture-snapshot-v1', epoch: request.session.epoch, entries: result.rows, coverage: result.coverage };
      }
      case 'recall': {
        const p = request.params;
        const hits = records.filter(r => r.text.toLocaleLowerCase().includes(p.query.toLocaleLowerCase()) && (!p.sourceIds || p.sourceIds.includes(r.ref.sourceId)) && (!p.classifications || p.classifications.includes(r.classification))).map(r => ({ ref: r.ref, scope: r.scope, classification: r.classification, excerpt: r.text, score: 1 }));
        const result = this.bounded(hits, request, h => h.excerpt.length);
        return { hits: result.rows, coverage: result.coverage };
      }
      case 'resolveEvidence': {
        const expected = request.params.ref;
        const row = records.find(r => r.ref.authorityId === expected.authorityId && r.ref.sourceId === expected.sourceId && r.ref.itemId === expected.itemId);
        if (!row) fail('NOT_FOUND'); if (row.ref.revision !== expected.revision) fail('VERSION_CONFLICT');
        if (row.text.length > request.budget.maxChars) fail('BUDGET_EXCEEDED');
        return { ref: row.ref, scope: row.scope, classification: row.classification, text: row.text, coverage: { omitted: 0, truncated: false } };
      }
      case 'listSources': {
        const sources = [...new Set(records.map(r => r.ref.sourceId))].sort().map(sourceId => ({ sourceId, state: 'ready', version: this.data.sourceIdentity }));
        const result = this.bounded(sources, request, () => 0); return { sources: result.rows, coverage: result.coverage };
      }
      case 'findEntities': {
        const query = request.params.query.toLocaleLowerCase();
        const entities = records.flatMap(r => r.entities.filter(e => e.name.toLocaleLowerCase().includes(query)).map(e => ({ entityId: e.id, name: e.name, scope: r.scope, classification: r.classification })));
        const distinct = [...new Map(entities.map(e => [e.entityId, e])).values()];
        const result = this.bounded(distinct, request, e => e.name.length); return { entities: result.rows, coverage: result.coverage };
      }
      case 'coverWindow': {
        const p = request.params;
        const nodes = records.filter(r => r.occurredAt >= p.from && r.occurredAt <= p.to && (!p.sourceIds || p.sourceIds.includes(r.ref.sourceId))).map(r => this.node(r));
        const result = this.bounded(nodes, request, n => n.text.length); return { nodes: result.rows, coverage: result.coverage, complete: !result.coverage.omitted };
      }
      case 'drillDown': {
        const row = records.find(r => r.ref.itemId === request.params.nodeId);
        if (!row) fail('NOT_FOUND'); if (row.ref.revision !== request.params.version) fail('VERSION_CONFLICT');
        const result = this.bounded([this.node(row)], request, n => n.text.length); return { nodes: result.rows, coverage: result.coverage };
      }
      case 'changes': {
        const p = request.params;
        if (p.sourceIdentity !== this.data.sourceIdentity) fail('VERSION_CONFLICT');
        const cursor = p.cursor ?? 'cursor-0'; if (!/^cursor-(0|[1-9][0-9]{0,6})$/.test(cursor)) fail('INVALID_REQUEST');
        const offset = Number(cursor.slice(7)); const all = this.visibleRecords().filter(r => r.ref.sourceId === p.sourceId);
        if (offset > all.length) fail('INVALID_REQUEST');
        const items = all.slice(offset, offset + request.budget.maxItems).map(r => ({ kind: r.deleted ? 'deleted' : 'upsert', ref: r.ref, scope: r.scope, classification: r.classification }));
        const complete = offset + items.length >= all.length;
        return { items, complete, ...(!complete ? { nextCursor: `cursor-${offset + items.length}` } : {}) };
      }
      default: fail('UNSUPPORTED_OPERATION');
    }
  }
  async onTurnCompleted(): Promise<void> { if (this.closed) fail('SESSION_CLOSED'); }
  async shutdown(): Promise<void> { this.closed = true; }
}
