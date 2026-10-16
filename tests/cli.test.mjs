import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { root, fixturePath, context, request, data, temporary, cleanup } from './helpers.mjs';
import { randomUUID } from 'node:crypto';

// Resolve only after close, including stdio: callers may then remove their isolated directory.
function run(args, {cwd=root,input='',nodeArgs=[],env={}}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[...nodeArgs,path.join(root,'bin/uu.mjs'),...args],{cwd,env:{...process.env,...env},windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill()},10000);
    child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
    child.stdin.on('error',()=>{});child.stdin.end(input);
    child.on('error',e=>{clearTimeout(timer);reject(e)});
    child.on('close',(code,signal)=>{clearTimeout(timer);if(timedOut)reject(Error('CLI_TEST_TIMEOUT'));else resolve({code,signal,stdout,stderr})});
  });
}
const json = r => JSON.parse(r.stdout);

test('standalone CLI doctor and protocol start outside PHD and report M1 limits',async()=>{
  const directory=temporary();
  try {
    const doctor=await run(['doctor'],{cwd:directory});assert.equal(doctor.code,0);assert.equal(json(doctor).productionAccess,false);assert.equal(json(doctor).persistentWrites,false);assert.equal(json(doctor).runtimeDependencies,0);
    const protocol=await run(['protocol'],{cwd:directory});assert.equal(protocol.code,0);assert.equal(json(protocol).methods.length,13);assert.deepEqual(json(protocol).legacyAliases,[]);
  }finally{cleanup(directory)}
});

test('CLI recall reads only the explicit synthetic fixture and logs metadata without query or bodies',async()=>{
  const response=await run(['memory','recall','--fixture',fixturePath,'--query','发布前先验证']);
  assert.equal(response.code,0);assert.equal(json(response).result.hits.length,1);
  assert.doesNotMatch(response.stderr,/发布前先验证|OTHER_PROJECT_SENTINEL|fixture-user|fixture-space/);
  for(const event of response.stderr.trim().split('\n').map(JSON.parse)){assert.ok(event.requestId);assert.ok(event.event)}
  const phases=response.stderr.trim().split('\n').map(JSON.parse);assert.ok(phases.some(e=>e.operation==='close'&&e.event==='succeeded'));
});

test('missing fixture never falls back to environment-configured data roots',async()=>{
  const response=await run(['memory','snapshot'],{env:{PHD_DATA_ROOT:'SYNTHETIC_DENIED_ROOT',UU_MEMORY_ROOT:'SYNTHETIC_DENIED_ROOT'}});
  assert.equal(response.code,1);assert.equal(json(response).cliError.code,'INVALID_REQUEST');assert.doesNotMatch(response.stderr,/SYNTHETIC_DENIED_ROOT/);
  const outside=await run(['memory','snapshot','--fixture',path.join(path.dirname(root),'uu-denied','input.json')]);
  assert.equal(json(outside).cliError.code,'SCOPE_DENIED');
});

test('wire CLI rejects grant escalation, old protocols, malformed input and every write method',async()=>{
  const ctx=context(), options={input:JSON.stringify(request(ctx,'recall',{query:'发布'},{scope:{...ctx.grant.scope,principalId:'other'}}))};
  const denied=await run(['memory','request','--fixture',fixturePath],options);assert.equal(json(denied).error.code,'SCOPE_DENIED');
  const {id,version,...entry}=data().entries[0];
  const mutations={remember:{expectedVersion:null,entry},patch:{expectedVersion:'v1',entryId:id,text:'合成更新',provenance:entry.provenance},forget:{expectedVersion:'v1',entryId:id},resolveConflict:{expectedVersion:'v1',conflictId:'fixture-conflict',selectedVersion:'v2'}};
  for(const [method,params] of Object.entries(mutations)){
    const response=await run(['memory','request','--fixture',fixturePath],{input:JSON.stringify(request(ctx,method,{...params,idempotencyKey:randomUUID()}))});
    assert.equal(response.code,1);assert.equal(json(response).error.code,'UNSUPPORTED_OPERATION');assert.equal(json(response).error.writeOutcome,'not-applied');assert.equal(json(response).result,undefined);
  }
  const old=await run(['memory','request','--fixture',fixturePath],{input:JSON.stringify({...request(ctx),version:0})});assert.equal(json(old).cliError.code,'UNSUPPORTED_PROTOCOL');
  const malformed=await run(['memory','request','--fixture',fixturePath],{input:'PRIVATE_MALFORMED_INPUT'});assert.equal(json(malformed).cliError.code,'INVALID_REQUEST');assert.doesNotMatch(malformed.stderr,/PRIVATE_MALFORMED_INPUT/);
  const oversized=await run(['memory','request','--fixture',fixturePath],{input:'x'.repeat(65537)});assert.equal(json(oversized).cliError.code,'BUDGET_EXCEEDED');
});

test('CLI succeeds with Node filesystem permissions allowing only its own checkout for reads',async()=>{
  const response=await run(['memory','snapshot','--fixture',fixturePath],{nodeArgs:['--permission',`--allow-fs-read=${root}`]});
  assert.equal(response.code,0,response.stderr);assert.equal(json(response).result.entries.length,2);
});

test('compiled contract imports from node_modules with no PHD dependency or TypeScript runtime',async()=>{
  const directory=temporary();
  try {
    const pkg=path.join(directory,'node_modules','@uu','memory-contract');fs.mkdirSync(pkg,{recursive:true});
    fs.cpSync(path.join(root,'build/src'),path.join(pkg,'build/src'),{recursive:true});
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));delete manifest.devDependencies;
    fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify(manifest));
    const consumer=path.join(directory,'consumer.mjs');
    fs.writeFileSync(consumer,"import {METHODS,MemorySession,VERSION} from '@uu/memory-contract';import {PROTOCOL} from '@uu/memory-contract/protocol';if(METHODS.length!==13||typeof MemorySession!=='function'||VERSION!==1||PROTOCOL!=='uu.memory')throw Error('BAD_EXPORT');console.log('passed');");
    const response=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--permission',`--allow-fs-read=${directory}`,consumer],{cwd:directory,windowsHide:true});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}))});
    assert.equal(response.code,0,response.stderr);assert.equal(response.stdout.trim(),'passed');
    const typedConsumer=path.join(directory,'consumer.mts');
    fs.writeFileSync(typedConsumer,`import {METHODS,MemorySession,VERSION,type Request} from '@uu/memory-contract';
import {PROTOCOL} from '@uu/memory-contract/protocol';
const supported:readonly string[]=METHODS; const version:1=VERSION;const protocol:'uu.memory'=PROTOCOL;
declare const request:Request<'recall'>; const query:string=request.params.query;
// @ts-expect-error write fields are not valid recall parameters
const invalid=request.params.idempotencyKey;
const sessionType:typeof MemorySession=MemorySession;
`);
    const typed=await new Promise((resolve,reject)=>{
      const p=spawn(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--module','NodeNext','--moduleResolution','NodeNext','--target','es2023','--typeRoots',path.join(root,'node_modules/@types'),typedConsumer],{cwd:directory,windowsHide:true});
      let output='',timedOut=false;
      // Checking the full public declarations and Node libraries is not a latency assertion.
      const timer=setTimeout(()=>{timedOut=true;p.kill()},30000);
      p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>output+=x);
      p.on('error',e=>{clearTimeout(timer);reject(e)});p.on('close',code=>{clearTimeout(timer);resolve({code,output:timedOut?'CONSUMER_TYPECHECK_TIMEOUT':output})});
    });
    assert.equal(typed.code,0,typed.output);
  }finally{cleanup(directory)}
});
