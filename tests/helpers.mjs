import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PROTOCOL, VERSION } from '../build/src/index.js';
import { FIXTURE_GRANT, FixtureProvider } from '../build/test-support/fixture-provider.js';
import { loadFixture } from '../build/test-support/fixture-loader.js';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const fixturePath = path.join(root, 'fixtures/demo.json');
export const data = () => loadFixture(fixturePath);
export const context = () => ({session:{id:randomUUID(),epoch:randomUUID()},grant:structuredClone(FIXTURE_GRANT)});
export const request = (ctx,method='health',params={},patch={}) => ({protocol:PROTOCOL,version:VERSION,requestId:randomUUID(),session:ctx.session,scope:ctx.grant.scope,budget:{maxItems:8,maxChars:4096,timeoutMs:1000},method,params,...patch});
export const provider = () => new FixtureProvider(data());
export const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
export const tick = () => new Promise(resolve=>setImmediate(resolve));
export function temporary() {const directory=fs.mkdtempSync(path.join(os.tmpdir(),'uu-m1-'));fs.writeFileSync(path.join(directory,'.uu-m1-isolated.json'),JSON.stringify({purpose:'uu-m1-synthetic-only'}));return directory;}
export function cleanup(directory) {if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('uu-m1-')||fs.lstatSync(directory).isSymbolicLink())throw Error('UNSAFE_TEST_CLEANUP');fs.rmSync(directory,{recursive:true,force:true});}
