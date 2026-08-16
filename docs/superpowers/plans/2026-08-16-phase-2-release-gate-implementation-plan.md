# Phase 2 Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that the latest committed Duckworth build is safe to promote by running the required isolated-browser, sandbox, migration, and release-identity checks.

**Architecture:** Use the repository’s lane factory so the API, web server, household, lease, database, and cleanup are created as one disposable test instance. Exercise the browser through the existing Playwright checks and the Phase 2 acceptance matrix; do not point mutation tests at family-live or reuse an older build.

**Tech Stack:** Node.js 25, pnpm 11, Fastify, Angular 22, SQLite, Python Playwright, Duckworth lane supervisor/release tooling.

## Global Constraints

- The exact tested commit must be identified by `git rev-parse HEAD` and the runtime `/health` handshake.
- Browser mutations may target only a proven `sandbox` or `api-test` lane.
- Family-live data, credentials, backups, and processes must not be used by automated tests.
- Required Phase 2 scenarios must pass before release promotion.
- Camera/gallery ingestion remains deferred until this release gate is green.

---

### Task 1: Freeze the release candidate

**Files:**
- Read: `docs/superpowers/specs/2026-08-11-concurrent-contexts-acceptance.md`
- Read: `docs/runbooks/duckworth-lanes-and-lan-testing.md`
- Read: `git` working tree and current commit

**Interfaces:**
- Consumes: local `main` branch and `origin/main`.
- Produces: a clean, identified release candidate suitable for disposable testing.

- [ ] **Step 1: Verify the candidate identity and clean tree**

Run:

```powershell
git status --short
git rev-parse HEAD
git log -1 --oneline --decorate
```

Expected: no status output; `HEAD` is the current pushed `main` commit.

### Task 2: Run the disposable browser acceptance gate

**Files:**
- Read: `duckworth-web/e2e/runtime_guard.py`
- Read: `duckworth-web/e2e/concurrency_check.py`
- Read: `duckworth-web/e2e/full_lifecycle_check.py`
- Read: `duckworth-web/e2e/local_assistance_check.py`
- Read: `duckworth-web/e2e/sse_check.py`

**Interfaces:**
- Consumes: the lane factory command `node tools/lanes/duckworth-profiles.mjs api-test run --with-web --`.
- Produces: browser evidence that the web UI talks to the disposable runtime and that two pages share list state while stale writes cannot overwrite newer state.

- [ ] **Step 1: Run the foundation and lifecycle checks in the disposable lane**

Run:

```powershell
node tools/lanes/duckworth-profiles.mjs api-test run --with-web -- python duckworth-web/e2e/foundation_check.py
node tools/lanes/duckworth-profiles.mjs api-test run --with-web -- python duckworth-web/e2e/full_lifecycle_check.py
node tools/lanes/duckworth-profiles.mjs api-test run --with-web -- python duckworth-web/e2e/concurrency_check.py
node tools/lanes/duckworth-profiles.mjs api-test run --with-web -- python duckworth-web/e2e/local_assistance_check.py
node tools/lanes/duckworth-profiles.mjs api-test run --with-web -- python duckworth-web/e2e/sse_check.py
```

Expected: every command exits zero, reports an `api-test` handshake, and removes its disposable database and server afterward.

- [ ] **Step 2: Record any release blocker**

If a command fails, preserve its output and stop promotion. Classify the failure as application behavior, lane isolation, runtime identity, browser rendering, or environment permissions before changing code.

### Task 3: Promote only after the gate is green

**Files:**
- Read: `tools/lanes/release-manager.mjs`
- Read: `docs/runbooks/duckworth-lanes-and-lan-testing.md`

**Interfaces:**
- Consumes: the clean tested commit and green disposable browser evidence.
- Produces: an immutable family-live release with build identity verification and rollback metadata.

- [ ] **Step 1: Promote the exact tested build**

Run:

```powershell
node tools/lanes/duckworth-profiles.mjs release promote
```

Expected: the release manager builds API/web artifacts, verifies the backup and staged release, activates the release marker atomically, restarts only family-live, and confirms the live build identity.

- [ ] **Step 2: Perform the read-only family-live smoke check**

Open the live origin from the runtime output on a second device and verify `API connected`, the expected instance/build identity, the existing list, and distinct active totals. Do not create, edit, remove, purchase, or clear learning during this check.
