import { randomUUID } from 'node:crypto';
import { MemorySession } from '../src/session.js';
import { fail, METHODS, PROTOCOL, safeCode, validateRequest, VERSION, WRITE_METHODS } from '../src/protocol.js';
import type { Request, SessionIdentity } from '../src/protocol.js';
import { FixtureProvider, FIXTURE_GRANT, READ_METHODS } from '../test-support/fixture-provider.js';
import { loadFixture } from '../test-support/fixture-loader.js';
import {loadContextFixture} from '../test-support/context-fixture.js';
import {compileUuPrompt,renderUuInspection} from '../src/context/index.js';

function log(event: Record<string, unknown>): void { try { process.stderr.write(JSON.stringify(event) + '\n'); } catch { /* stderr is best effort. */ } }
async function stdin(): Promise<unknown> {
  if (process.stdin.isTTY) fail('INVALID_REQUEST');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let length = 0; let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return; settled = true; clearTimeout(timer); process.stdin.pause();
      process.stdin.removeListener('data', data); process.stdin.removeListener('end', end); process.stdin.removeListener('error', broken);
      if (error) reject(error); else try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { try { fail('INVALID_REQUEST'); } catch (e) { reject(e); } }
    };
    const invalid = () => { try { fail('BUDGET_EXCEEDED'); } catch (e) { finish(e); } };
    const data = (chunk: Buffer) => { length += chunk.length; if (length > 65536) invalid(); else chunks.push(chunk); };
    const end = () => finish(); const broken = () => { try { fail('INVALID_REQUEST'); } catch (e) { finish(e); } };
    const timer = setTimeout(() => { try { fail('TIMEOUT'); } catch (e) { finish(e); } }, 5000);
    process.stdin.on('data', data); process.stdin.once('end', end); process.stdin.once('error', broken); process.stdin.resume();
  });
}
async function main(): Promise<void> {
  const started = performance.now(), requestId = randomUUID();
  const [command, operation, ...args] = process.argv.slice(2);
  log({ event: 'started', operation: 'cli', requestId });
  try {
    if (command === 'doctor' && !operation) {
      console.log(JSON.stringify({ milestone: 'M1b', node: process.versions.node, protocol: PROTOCOL, version: VERSION, contextLayers:8, productionAccess: false, persistentWrites: false, runtimeDependencies: 0 }));
    } else if (command === 'protocol' && !operation) {
      console.log(JSON.stringify({ protocol: PROTOCOL, version: VERSION, methods: METHODS, writeMethods: [...WRITE_METHODS], fixtureCapabilities: READ_METHODS, legacyAliases: [], transport: 'Host-owned; M1 fixture CLI only' }));
    } else if(command==='context'&&operation==='inspect') {
      if(args.length<2||args[0]!=='--fixture'||!args[1]||args.length>3||(args.length===3&&args[2]!=='--full'))fail('INVALID_REQUEST');
      const plan=compileUuPrompt(loadContextFixture(args[1]));
      console.log(renderUuInspection(plan,args[2]==='--full'));
    } else {
      if (command !== 'memory' || !['snapshot', 'recall', 'health', 'listSources', 'request'].includes(operation ?? '')) fail('INVALID_REQUEST');
      const options = new Map<string, string>();
      for (let i = 0; i < args.length; i += 2) {
        const key = args[i], value = args[i + 1];
        if (!key || !['--fixture', '--query'].includes(key) || !value || options.has(key)) fail('INVALID_REQUEST'); options.set(key, value);
      }
      const fixturePath = options.get('--fixture'); if (!fixturePath || (operation !== 'recall' && options.has('--query'))) fail('INVALID_REQUEST');
      const fixture = loadFixture(fixturePath);
      let session: SessionIdentity = { id: randomUUID(), epoch: randomUUID() };
      let request: Request;
      if (operation === 'request') { const value = await stdin(); validateRequest(value); request = value; session = value.session; }
      else {
        if (operation === 'recall' && !options.get('--query')) fail('INVALID_REQUEST');
        request = { protocol: PROTOCOL, version: VERSION, requestId, session, scope: FIXTURE_GRANT.scope, budget: { maxItems: 8, maxChars: 4096, timeoutMs: 2000 }, method: operation, params: operation === 'recall' ? {query: options.get('--query')!} : {} } as Request;
      }
      const controller = new AbortController(), cancel = () => controller.abort();
      process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
      const client = new MemorySession(new FixtureProvider(fixture), { session, grant: FIXTURE_GRANT }, event => log({ ...event }));
      let response;
      try { await client.initialize({ signal: controller.signal }); response = await client.invoke(request, { signal: controller.signal }); }
      finally { try { await client.close(); } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); } }
      console.log(JSON.stringify(response)); if (!response.ok) process.exitCode = 1;
    }
    log({ event: process.exitCode ? 'failed' : 'succeeded', operation: 'cli', requestId, durationMs: performance.now() - started });
  } catch (error) {
    const code = safeCode(error, 'INVALID_REQUEST');
    console.log(JSON.stringify({ cliError: { code } }));
    log({ event: code === 'TIMEOUT' ? 'timeout' : code === 'CANCELLED' ? 'cancelled' : 'failed', operation: 'cli', requestId, durationMs: performance.now() - started, errorCode: code });
    process.exitCode = 1;
  }
}
await main();
