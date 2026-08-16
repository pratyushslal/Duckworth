# Duckworth recovery ledger

This file records the recovery boundary created before restoring the application.

## Source snapshots

| Source | State | Recovery artifact |
|---|---|---|
| `main` at `207c858` | Older running checkout; one incidental Angular working-tree edit | `.recovery/main-working-tree.patch` |
| `codex/task-1-versioned-contracts` at `78f6df6` | Advanced committed implementation plus dirty semantic/cloud slice | `.recovery/advanced-commits.bundle`, `.recovery/advanced-working-tree.patch`, `.recovery/advanced-untracked/` |
| Detached brain worktree at `74a7729` | Conversational-brain implementation history | `.recovery/brain-commits.bundle` |

The advanced committed tree was restored into the workspace without deleting the source worktrees. The dirty semantic/cloud changes were copied from the recovery archive and then verified through package tests. Generated caches and Playwright/Python cache files remain archived but are not part of the application source.

## Data boundary

Live and sandbox SQLite files remain separate under `%LOCALAPPDATA%\Duckworth\data\live` and `%LOCALAPPDATA%\Duckworth\data\sandbox`. No automatic row merge is performed. Any migration must use the existing backup/restore-drill tooling and produce a dry-run report first.

## Operating rule

The repository source, coordinator registry, release manifest, and test evidence are authoritative. A Codex chat transcript or an uncommitted worktree is never itself a release approval.
