if (process.versions.node !== '24.19.0') {
  process.stderr.write('UU_NODE_VERSION_REQUIRED: use the configured Node 24.19.0 runtime.\n');
  process.exitCode = 1;
}
