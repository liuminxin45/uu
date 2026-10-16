import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { array, boolean, CLASSIFICATIONS, fail, identifier, object, string, validateEntry, validateRef, validateScope } from '../src/protocol.js';
import type { FixtureData } from './fixture-provider.js';

const bundledRoot = fileURLToPath(new URL('../../fixtures/', import.meta.url));
function within(root: string, file: string): boolean { const rel = path.relative(root, file); return !!rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); }
function noRedirect(file: string, root: string): void {
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root).toLowerCase() !== path.resolve(root).toLowerCase()) fail('SCOPE_DENIED');
  let current = root;
  for (const segment of path.relative(root, file).split(path.sep)) { current = path.join(current, segment); if (fs.lstatSync(current).isSymbolicLink()) fail('SCOPE_DENIED'); }
}
/** Reject outside paths before opening any file. No production or data-root defaults. */
export function assertFixturePath(input: string): string {
  const file = path.resolve(input);
  const temp = path.resolve(os.tmpdir()), relative = path.relative(temp, file), first = relative.split(path.sep)[0];
  const ownTemp = within(temp, file) && /^uu-m1-[A-Za-z0-9_-]+$/.test(first ?? '') && relative.split(path.sep).length > 1;
  if (!file.endsWith('.json') || (!within(bundledRoot, file) && !ownTemp)) fail('SCOPE_DENIED');
  const allowedRoot = ownTemp ? path.join(temp, first!) : bundledRoot;
  noRedirect(file, allowedRoot);
  if (ownTemp) {
    const marker = path.join(temp, first!, '.uu-m1-isolated.json');
    try { noRedirect(marker, allowedRoot); } catch { fail('SCOPE_DENIED'); }
    const stat = fs.statSync(marker); if (!stat.isFile() || stat.size > 256) fail('SCOPE_DENIED');
    const value = JSON.parse(fs.readFileSync(marker, 'utf8')); const m = object(value, ['purpose']); if (m.purpose !== 'uu-m1-synthetic-only') fail('SCOPE_DENIED');
  }
  return file;
}
export function loadFixture(input: string): FixtureData {
  const file = assertFixturePath(input); const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 131072) fail('BUDGET_EXCEEDED');
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const f = object(value, ['kind', 'version', 'authorityId', 'sourceIdentity', 'entries', 'records']);
  if (f.kind !== 'uu-m1-synthetic' || f.version !== 1) fail('INVALID_REQUEST');
  identifier(f.authorityId); identifier(f.sourceIdentity); array(f.entries, 100).forEach(e => validateEntry(e));
  for (const value of array(f.records, 100)) {
    const r = object(value, ['ref', 'scope', 'classification', 'text', 'occurredAt', 'entities', 'deleted']);
    validateRef(r.ref); validateScope(r.scope); string(r.text, 32768); boolean(r.deleted);
    if (!CLASSIFICATIONS.includes(r.classification as never)) fail('INVALID_REQUEST');
    if (typeof r.occurredAt !== 'string' || !Number.isFinite(Date.parse(r.occurredAt)) || new Date(r.occurredAt).toISOString() !== r.occurredAt) fail('INVALID_REQUEST');
    for (const e of array(r.entities, 16)) { const entity = object(e, ['id', 'name']); identifier(entity.id); string(entity.name, 256); }
    if (!String(r.ref.authorityId).startsWith('fixture-') || !String(r.ref.sourceId).startsWith('fixture-') || r.ref.authorityId !== f.authorityId) fail('SCOPE_DENIED');
  }
  return value as FixtureData;
}
