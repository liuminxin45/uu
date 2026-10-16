import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root=process.cwd(),parent=path.join(root,'.tmp');fs.mkdirSync(parent,{recursive:true});
const output=fs.mkdtempSync(path.join(parent,'distribution-check-'));
try {
  execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'-p','tsconfig.json','--outDir',output],{stdio:'pipe',windowsHide:true,timeout:45000});
  const generated=path.join(output,'src'),shipped=path.join(root,'build/src');
  const list=directory=>fs.readdirSync(directory,{recursive:true}).filter(file=>/\.(js|d\.ts)$/.test(file)).sort();
  const files=list(generated);assert.deepEqual(list(shipped),files,'Stale or missing distribution file');
  for(const file of files)assert.ok(fs.readFileSync(path.join(shipped,file)).equals(fs.readFileSync(path.join(generated,file))),'Distribution differs from source: '+file);
  console.log(JSON.stringify({status:'passed',compiledFiles:files.length,sourceAndDistributionIdentical:true,installScriptsRequired:false}));
}finally{
  assert.equal(path.dirname(output),parent);assert.ok(path.basename(output).startsWith('distribution-check-'));assert.equal(fs.lstatSync(output).isSymbolicLink(),false);
  fs.rmSync(output,{recursive:true,force:true});
}
