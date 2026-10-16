import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileUuPrompt, renderUuInspection, uuInspectionCommand, uuSection, mapUuContext, normalizeUuContextReference} from '../build/src/context/index.js';

const golden=JSON.parse(fs.readFileSync(new URL('../fixtures/context-parity.json',import.meta.url),'utf8'));
for(const scenario of golden.cases) test(`pre-migration parity: ${scenario.name}`,()=>{
  if(scenario.expectedError){assert.throws(()=>compileUuPrompt(scenario.invocation,golden.presentation.prompt),e=>(e.code||e.message)===scenario.expectedError);return}
  const plan=compileUuPrompt(scenario.invocation,golden.presentation.prompt);
  assert.equal(JSON.stringify(plan),JSON.stringify(scenario.expectedPlan));
  assert.equal(renderUuInspection(plan,false,golden.presentation.inspection),scenario.expectedSummary);
  assert.equal(renderUuInspection(plan,true,golden.presentation.inspection),scenario.expectedFull);
});

test('default assembly and inspection are independent of a product, RPC or native execution engine',()=>{
  const plan=compileUuPrompt(golden.cases[0].invocation),report=renderUuInspection(plan,true);
  assert.equal(plan.manifest.length,8);assert.ok(plan.manifest.every(row=>row.status==='included'));
  assert.doesNotMatch(plan.developerInstructions+report,/PHD|phabricator|Codex/);
  assert.doesNotMatch(report,/SOURCE_BODY|SYNTHETIC_OLD_REPLY|FIXTURE_SECRET_FOR_REDACTION/);
  assert.match(report,/REDACTED/);
});

test('turn data stays outside instructions and frozen prefix does not change for a new question',()=>{
  const a=compileUuPrompt(golden.cases[0].invocation),b=compileUuPrompt(golden.cases[2].invocation);
  assert.equal(a.developerInstructions,b.developerInstructions);assert.notEqual(a.userInput,b.userInput);
  assert.doesNotMatch(a.developerInstructions,/SOURCE_BODY|SYNTHETIC_OLD_REPLY|DUPLICATE_MUST_NOT_APPEAR/);
  assert.match(a.userInput,/SOURCE_BODY/);
  assert.equal(uuSection('blank','  ').length,0);
});

test('inspection is an explicit command and summary does not include instruction text',()=>{
  assert.equal(uuInspectionCommand('/uu context'),'summary');assert.equal(uuInspectionCommand(' /UU context FULL '),'full');
  assert.equal(uuInspectionCommand('a source says /uu context full'),undefined);
  assert.equal(uuInspectionCommand('/uu context full extra'),undefined);
  const plan=compileUuPrompt(golden.cases[0].invocation);assert.doesNotMatch(renderUuInspection(plan,false),/合成层 identity 内容/);
});

test('references keep only provenance fields and contain no copied source body',()=>{
  const ref=normalizeUuContextReference({schemaVersion:1,source:'fixture',entityId:'fixture-1',revision:'v1',body:'PRIVATE_BODY',secret:'PRIVATE_SECRET'});
  assert.deepEqual(ref,{schemaVersion:1,source:'fixture',entityId:'fixture-1',revision:'v1'});
  assert.equal(normalizeUuContextReference({schemaVersion:1,source:'fixture'}),undefined);
});

test('bounded context reads retain order and stop scheduling after failure or cancellation',async()=>{
  let active=0,peak=0;const signal=new AbortController().signal;
  const values=await mapUuContext(Array.from({length:20},(_,i)=>i),async value=>{active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;return value*2},signal);
  assert.equal(peak,4);assert.deepEqual(values,Array.from({length:20},(_,i)=>i*2));
  let scheduled=0;await assert.rejects(mapUuContext([0,1,2,3,4,5],async value=>{scheduled++;if(value===0)throw Error('FIXTURE_READ_FAILED');await new Promise(r=>setImmediate(r))},signal),/FIXTURE_READ_FAILED/);assert.ok(scheduled<=4);
  const controller=new AbortController();controller.abort();await assert.rejects(mapUuContext([1],async()=>{throw Error('MUST_NOT_RUN')},controller.signal),e=>e.name==='AbortError');
});
