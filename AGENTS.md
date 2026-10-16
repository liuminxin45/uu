# uu engineering boundaries

- Current milestone is M1: portable Memory protocol, provider lifecycle and isolated synthetic fixtures. Production readers, storage writers, migrations and PHD installation are outside this milestone.
- Core exports must not import PHD, Electron, React, database libraries, test-support or filesystem/network access. Identity and authorization come from a trusted Host grant; a request cannot expand that grant.
- Use Node 24.19.0. Compile TypeScript to JavaScript for consumers; do not publish TypeScript source that requires runtime type stripping in node_modules.
- No production data path defaults, private data-root environment variables, legacy protocol aliases, automatic fallback or hidden writers. Synthetic fixture loading stays outside the core package and rejects paths outside the explicitly isolated fixture roots.
- Diagnostics contain only stable operation names, generated request/session IDs, status, counts, size, duration and bounded error codes. Never log query/content, source excerpts, credentials, scope identities or content hashes. Diagnostic failures must not block requests.
- Cancellation/timeout must not imply provider completion. Keep the provider busy until its work settles; shutdown must drain or explicitly fail. Never retry unknown outcomes automatically.
- A successful write receipt must mean durable, verified persistence. The M1 read-only fixture provider cannot return successful write receipts.
- Tests use synthetic fixtures and owned temporary roots; wait for child exit before cleaning them. No production scans or PHD imports in tests. Changes require typecheck, protocol/behavior tests and package boundary verification.
