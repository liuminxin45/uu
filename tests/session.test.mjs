import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemorySession,MemoryError } from '../build/src/index.js';
import { context,request,provider,data,deferred,tick } from './helpers.mjs';
const info={authorityId:'fixture-demo',capabilities:['health'],persistentWrites:false};
const health={state:'ready',...info};
const mock=(overrides={})=>({initialize:async()=>info,execute:async()=>health,shutdown:async()=>{},...overrides});
test('initialize, per-turn references and idempotent close form an explicit lifecycle',async()=>{const ctx=context(),events=[];const p=mock({initialize:async()=>{events.push('init');return info},onTurnCompleted:async()=>events.push('turn'),onSessionEnd:async()=>events.push('end'),shutdown:async()=>events.push('shutdown')});const s=new MemorySession(p,ctx);assert.equal((await s.invoke(request(ctx))).error.code,'SESSION_CLOSED');await s.initialize();await assert.rejects(s.initialize(),e=>e.code==='SESSION_CLOSED');await s.completeTurn({turnId:randomUUID(),references:[data().records[0].ref]});await Promise.all([s.close(),s.close()]);await s.close();assert.deepEqual(events,['init','turn','end','shutdown']);assert.equal((await s.invoke(request(ctx))).error.code,'SESSION_CLOSED')});
test('fixture writes fail explicitly and never execute or fabricate receipts',async()=>{const ctx=context(),p=provider();let writes=0;const execute=p.execute.bind(p);p.execute=async(...args)=>{if(args[0].method==='remember')writes++;return execute(...args)};const s=new MemorySession(p,ctx);await s.initialize();try{const {id,version,...entry}=data().entries[0];const result=await s.invoke(request(ctx,'remember',{entry,idempotencyKey:randomUUID(),expectedVersion:null}));assert.equal(result.error.code,'UNSUPPORTED_OPERATION');assert.equal(result.error.writeOutcome,'not-applied');assert.equal(writes,0)}finally{await s.close()}});
test('session and grant binding are immutable and requests cannot widen them',async()=>{const ctx=context(),s=new MemorySession(provider(),ctx);ctx.grant.classifications.push('restricted');await s.initialize();try{assert.equal((await s.invoke(request(ctx,'recall',{query:'发布',classifications:['restricted']}))).error.code,'SCOPE_DENIED');assert.equal((await s.invoke(request(ctx,'health',{}, {session:{...ctx.session,epoch:randomUUID()}}))).error.code,'SCOPE_DENIED')}finally{await s.close()}});
test('timeout retains the busy slot and shutdown waits for actual provider completion',async()=>{const ctx=context(),work=deferred(),entered=deferred();let calls=0,closed=0;const s=new MemorySession(mock({execute:async()=>{calls++;entered.resolve();return work.promise},shutdown:async()=>{closed++}}),ctx);await s.initialize();const pending=s.invoke(request(ctx,'health',{}, {budget:{maxItems:8,maxChars:4096,timeoutMs:30}}));await entered.promise;assert.equal((await pending).error.code,'TIMEOUT');assert.equal((await s.invoke(request(ctx))).error.code,'PROVIDER_BUSY');await assert.rejects(s.close(30),e=>e.code==='DRAIN_TIMEOUT');assert.equal(closed,0);assert.equal(calls,1);work.resolve(health);await tick();await s.close();assert.equal(closed,1)});
test('cancellation observes caller intent without logging the abort reason',async()=>{const ctx=context(),events=[],entered=deferred(),work=deferred(),controller=new AbortController();const s=new MemorySession(mock({execute:async()=>{entered.resolve();return work.promise}}),ctx,e=>events.push(e));await s.initialize();const pending=s.invoke(request(ctx),{signal:controller.signal});await entered.promise;controller.abort(new Error('PRIVATE_ABORT_CONTENT'));assert.equal((await pending).error.code,'CANCELLED');work.resolve(health);await tick();await s.close();assert.ok(events.some(e=>e.event==='cancelled'));assert.doesNotMatch(JSON.stringify(events),/PRIVATE_ABORT_CONTENT/)});
test('opaque provider errors never leak message text, query or scope into diagnostics',async()=>{const ctx=context(),events=[];const s=new MemorySession(mock({execute:async()=>{throw Error('PRIVATE_PROVIDER_CONTENT')}}),ctx,e=>events.push(e));await s.initialize();const result=await s.invoke(request(ctx));assert.equal(result.error.code,'PROVIDER_FAILED');await s.close();assert.doesNotMatch(JSON.stringify(events),/PRIVATE_PROVIDER_CONTENT|fixture-user|fixture-space/);assert.ok(events.find(e=>e.event==='failed').stack)});
test('diagnostic sink failure does not prevent a successful request',async()=>{const ctx=context(),s=new MemorySession(mock(),ctx,()=>{throw Error('sink failed')});await s.initialize();assert.equal((await s.invoke(request(ctx))).ok,true);await s.close()});
test('a timed-out write has unknown outcome, remains busy and is never replayed',async()=>{const ctx=context(),work=deferred(),entered=deferred();let calls=0;const s=new MemorySession(mock({initialize:async()=>({...info,capabilities:['remember'],persistentWrites:true}),execute:async()=>{calls++;entered.resolve();return work.promise}}),ctx);await s.initialize();const {id,version,...entry}=data().entries[0];const pending=s.invoke(request(ctx,'remember',{entry,idempotencyKey:randomUUID(),expectedVersion:null},{budget:{maxItems:8,maxChars:4096,timeoutMs:30}}));await entered.promise;const result=await pending;assert.equal(result.error.writeOutcome,'unknown');assert.equal(result.error.retry,'never');work.reject(new MemoryError('PROVIDER_FAILED'));await tick();await s.close();assert.equal(calls,1)});
test('invalid provider capabilities are rejected rather than enabling hidden writes',async()=>{const s=new MemorySession(mock({initialize:async()=>({...info,capabilities:['health','remember'],persistentWrites:false})}),context());await assert.rejects(s.initialize(),e=>e.code==='INITIALIZATION_FAILED');await s.close()});
test('a failed shutdown is observed and not blindly replayed',async()=>{let calls=0;const s=new MemorySession(mock({shutdown:async()=>{calls++;throw Error('shutdown failed')}}),context());await s.initialize();await assert.rejects(s.close());await assert.rejects(s.close());assert.equal(calls,1)});
test('initialization cancellation does not begin provider work',async()=>{let calls=0;const controller=new AbortController();controller.abort();const s=new MemorySession(mock({initialize:async()=>{calls++;return info}}),context());await assert.rejects(s.initialize({signal:controller.signal}),e=>e.code==='CANCELLED');assert.equal(calls,0);await s.close()});

test('close cancels an initializing provider and waits for its actual completion',async()=>{
  const work=deferred(),entered=deferred();let shut=0;
  const s=new MemorySession(mock({initialize:async()=>{entered.resolve();return work.promise},shutdown:async()=>{shut++}}),context());
  const initializing=s.initialize();const observed=assert.rejects(initializing,e=>e.code==='CANCELLED');await entered.promise;
  const closing=s.close(1000);await tick();assert.equal(shut,0);work.resolve(info);await Promise.all([closing,observed]);assert.equal(shut,1);
});

test('a slow shutdown is not acknowledged until actual completion and is never replayed',async()=>{
  const work=deferred();let calls=0;const events=[];
  const s=new MemorySession(mock({shutdown:async()=>{calls++;await work.promise}}),context(),e=>events.push(e));await s.initialize();
  await assert.rejects(s.close(30),e=>e.code==='TIMEOUT');assert.equal(calls,1);
  const closing=s.close(1000);work.resolve();await closing;await s.close();assert.equal(calls,1);
  assert.ok(events.some(e=>e.operation==='close'&&e.event==='timeout'));
});

test('end-hook failure is observed while shutdown still releases the provider',async()=>{
  for(const thrown of [Error('PRIVATE_END_HOOK'),undefined]){
    let shut=0;const s=new MemorySession(mock({onSessionEnd:async()=>{throw thrown},shutdown:async()=>{shut++}}),context());
    await s.initialize();await assert.rejects(s.close());assert.equal(shut,1);await s.close();assert.equal(shut,1);
  }
});

test('invalid turn bodies and forged provider error codes cannot leak into diagnostics',async()=>{
  const ctx=context(),events=[];let turns=0;const s=new MemorySession(mock({execute:async()=>{throw new MemoryError('PRIVATE_FORGED_CODE')},onTurnCompleted:async()=>{turns++}}),ctx,e=>events.push(e));
  await s.initialize();await assert.rejects(s.completeTurn({turnId:randomUUID(),references:[],raw:'PRIVATE_TURN_BODY'}),e=>e.code==='INVALID_REQUEST');
  assert.equal(turns,0);assert.equal((await s.invoke(request(ctx))).error.code,'PROVIDER_FAILED');await s.close();assert.doesNotMatch(JSON.stringify(events),/PRIVATE_FORGED_CODE|PRIVATE_TURN_BODY/);
});

test('health cannot silently change the capabilities negotiated at initialization',async()=>{
  const ctx=context(),s=new MemorySession(mock({execute:async()=>({...health,capabilities:['health','remember'],persistentWrites:true})}),ctx);
  await s.initialize();try{assert.equal((await s.invoke(request(ctx))).error.code,'INVALID_RESPONSE')}finally{await s.close()}
});
