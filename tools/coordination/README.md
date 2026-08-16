# Duckworth coordination control plane

The coordinator is the authority for work that spans Codex tasks. Chat text is not a completion signal.

Register a task from an isolated worktree:

```powershell
node tools/coordination/duckworth-coordinator.mjs register `
  --task capture-default-piece --thread codex-thread-id `
  --scope duckworth-web/src/app --branch codex/capture-default-piece `
  --worktree C:\path\to\worktree
```

Publish readiness only after the worker has committed its changes:

```powershell
node tools/coordination/duckworth-coordinator.mjs ready `
  --task capture-default-piece --commit <sha> --baseCommit <sha> `
  --features capture-default-piece --tests web-capture,api-shopping-items
```

Verify independently before integration:

```powershell
node tools/coordination/duckworth-coordinator.mjs verify `
  --task capture-default-piece --run-tests
```

State and events are stored under `%LOCALAPPDATA%\Duckworth\coordination` by default. The coordinator refuses dirty worktrees, unknown feature/test IDs, non-descendant commits, expired ownership, and artifact-mismatched approvals.
