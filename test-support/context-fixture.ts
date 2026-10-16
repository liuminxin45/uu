import fs from 'node:fs';
import {assertFixturePath} from './fixture-loader.js';
import {fail,object} from '../src/protocol.js';
import type {UuInvocation} from '../src/context/index.js';

export function loadContextFixture(input: string): UuInvocation {
  const file=assertFixturePath(input),stat=fs.statSync(file);
  if(!stat.isFile()||stat.size>131072)fail('BUDGET_EXCEEDED');
  const value=object(JSON.parse(fs.readFileSync(file,'utf8')),['kind','version','invocation']);
  if(value.kind!=='uu-m1b-context-synthetic'||value.version!==1)fail('INVALID_REQUEST');
  const invocation=object(value.invocation,['profile','turn'],['surfaceId','layers','projectRules','rebuildInstructions','maxInputChars','inspectContext','layerReasons']);
  if(!['conversation','task','inference'].includes(invocation.profile as string))fail('INVALID_REQUEST');
  const turn=object(invocation.turn,['text'],['evidence','history']);
  if(typeof turn.text!=='string'||turn.text.length>32768)fail('INVALID_REQUEST');
  return invocation as unknown as UuInvocation;
}
