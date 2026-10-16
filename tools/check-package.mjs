import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Inspect npm's actual allowlist resolution, without creating or publishing a tarball.
const npm = path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
const [pack] = JSON.parse(execFileSync(process.execPath,[npm,'pack','--dry-run','--json','--ignore-scripts'],{encoding:'utf8',windowsHide:true,maxBuffer:262144}));
const files=pack.files.map(file=>file.path).sort();
assert.ok(files.length>=9);
for(const file of files)assert.ok(['package.json','README.md','docs/PROTOCOL.md'].includes(file)||/^build\/src\/[a-z-]+\.(js|d\.ts)$/.test(file),'Unexpected package content');
assert.equal(files.filter(file=>file.endsWith('.js')).length,3);
assert.equal(files.filter(file=>file.endsWith('.d.ts')).length,3);
for(const file of files.filter(file=>file.endsWith('.d.ts'))) assert.doesNotMatch(fs.readFileSync(file,'utf8'),/from ['"][^'"]+\.ts['"]/,'Declaration must reference the compiled module');
assert.ok(!files.some(file=>/fixture|test-support|tools\/|bin\/|AGENTS|\.tmp/.test(file)));
console.log(JSON.stringify({result:'passed',entries:files.length,unpackedBytes:pack.unpackedSize,files,runtimeDependencies:0,productionReaderPackaged:false}));
