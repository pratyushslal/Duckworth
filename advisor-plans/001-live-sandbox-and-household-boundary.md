# Plan 001: Live/Sandbox and Household Boundary

## Problem

Separate ports and SQLite paths are necessary but insufficient. The current frontend chooses `householdId` from editable local storage, many API routes trust that path value, all frontend modes proxy to API 3000, and mutating E2E checks target port 4200. A visual lane label can therefore disagree with the database actually being changed.

## Intended outcome

- Family URL: `http://<LAN-IP>:4200`, bound only to the live API and live database.
- Sandbox URL: `http://<LAN-IP>:4300`, bound only to the sandbox API and sandbox database.
- Tests use an ephemeral sandbox instance, never either persistent lane by default.
- Household membership and lane come from a server-validated session, not browser-selected tenant text.
- Every mutation is denied by default without valid scope.
- Live data has consistent backups and a tested restore path.

## Inputs, processing, outputs

| Stage | Input | Processing | Output |
|---|---|---|---|
| API boot | typed lane manifest | resolve absolute paths; check port, lane marker, DB path, permissions and schema | immutable `RuntimeIdentity` |
| UI boot | expected lane/instance | fetch same-origin runtime handshake | render only if identities match |
| enrollment | short-lived pairing invitation | validate, consume once, create device/member session | HttpOnly same-origin session |
| request | session + resource path | centralized authentication and household authorization | authorized household scope or 401/403 |
| test boot | ephemeral manifest | assert sandbox lane and unique instance | mutation-enabled disposable server |
| backup | live SQLite connection | consistent snapshot, integrity check, checksum, retention | restorable versioned artifact |

## Implementation tasks

### Task 1 — Characterize and close existing accidental-live test paths

**Files:** `duckworth-api/test/health.test.ts`, `duckworth-web/e2e/*.py`, new test-harness configuration.

1. RED: tests prove `buildApp()` in test mode without an explicit memory/temp DB throws.
2. RED: E2E harness refuses a server reporting `live`, missing identity, or wrong instance ID before its first mutation.
3. GREEN: remove hardcoded 4200/`household-demo`; allocate sandbox URL and unique household from harness configuration.
4. Verify existing E2E behavior against an ephemeral database.

### Task 2 — Typed, fail-closed runtime manifest

**Files:** `duckworth-api/src/config.ts`, `duckworth-api/src/server.ts`, `duckworth-api/src/app.ts`, new config tests.

Add required production fields: `lane`, `instanceId`, absolute `databasePath`, `host`, `port`, `publicOrigin`, `cookieSecret`, and capability flags. Validate:

- live cannot use `:memory:`, temp, sandbox, or test paths;
- sandbox cannot use a database marked live;
- the database stores an immutable lane/instance marker;
- a missing/relative/contradictory production setting aborts startup;
- tests must explicitly provide `:memory:` or a temp path.

Expose a non-secret same-origin runtime handshake with lane, instance ID, API/schema versions, and database fingerprint. Do not expose the filesystem path.

### Task 3 — Immutable frontend-to-backend binding

**Files:** separate live/sandbox proxy configs, Angular runtime identity service, start scripts.

1. RED: a sandbox frontend connected to a live API refuses to render/mutate.
2. GREEN: dedicate proxy/API configuration to each origin; derive the lane badge, title, favicon, and mutation policy from the verified handshake.
3. Keep no runtime lane switcher in the family UI. Sandbox is reached through its explicit origin and has a persistent, non-colour-only banner.

### Task 4 — Central household authorization and enrollment

**Files:** new Fastify identity plugin, split route modules, Angular session/enrollment client.

1. Inventory every household route, including items, SSE, archives, settings, suggestions, audit captures, brain runtime settings, and conversation routes.
2. RED: cross-household and unauthenticated requests are rejected for every route family.
3. Add a centralized pre-handler that resolves a session to `{lane, householdId, memberId?, deviceId}` and rejects path mismatch.
4. Replace unconditional context registration with one-time pairing invitations. Store only hashed invitation material server-side.
5. Move bearer material out of query strings and local storage. Use Secure/HttpOnly/SameSite cookies when HTTPS is available; for an HTTP-only trusted-LAN pilot, document the residual sniffing risk and do not claim hostile-network security.
6. Make re-enrollment an authenticated recovery flow; do not rotate another device token merely by repeating its ID.

### Task 5 — Versioned migrations and safe data split

1. Add an ordered migration ledger and compatibility preflight; repository construction must not independently mutate schema.
2. Snapshot the existing mixed database to quarantine. Do not auto-classify its rows as family or test data.
3. Start a clean live database. Keep the existing mixed database as sandbox/migration source until the user explicitly imports selected family rows.
4. Generate dry-run reports for schema change, row count, identity collision, and import mapping.
5. Migrate sandbox first; only migrate live after backup, verification, and rollback rehearsal.

### Task 6 — Backup, restore, and destructive-operation guardrails

1. Implement SQLite-consistent snapshots rather than copying an active file blindly.
2. Verify `integrity_check`, checksum, schema version, lane marker, and expected minimum table counts after backup.
3. Keep timestamped generations outside the active DB directory with documented retention.
4. Restore only into a disposable path during drills. Restoring over live requires a second recovery snapshot and explicit operator confirmation.
5. Reset/seed tooling is sandbox-only, CLI-only, and refuses the live marker even if called with a misleading filename.

## Release-blocking tests

- Bidirectional read/write isolation across two physical DB files and processes.
- Frontend handshake mismatch refusal.
- Test-runner live refusal before mutation.
- Cross-household authorization denial for every route and SSE.
- One-time enrollment, expiry, replay, revocation, and recovery.
- No auth token in URLs, logs, or error bodies.
- Restart persistence and distinct lane markers.
- Backup integrity and successful disposable restore.
- Sandbox reset leaves live row counts/checksums unchanged.

## Rollback

Retain the pre-migration snapshot and old application binary. New application startup must reject unsupported old/new schemas rather than attempting a partial downgrade. Rollback restores the matching binary plus snapshot into a new path, verifies integrity, then atomically changes the service configuration.

