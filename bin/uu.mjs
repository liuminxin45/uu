#!/usr/bin/env node
if (process.versions.node !== '24.19.0') {
  process.stderr.write('UU_NODE_VERSION_REQUIRED\n');
  process.exitCode = 1;
} else {
  try { await import('../build/tools/uu.js'); }
  catch { process.stderr.write('UU_CLI_START_FAILED: run npm ci and npm run build in the uu checkout.\n'); process.exitCode = 1; }
}
