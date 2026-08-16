# Plan 005: Integrated Verification and Family-Live Rollout

## Goal

Prove that the combined system is correct, isolated, recoverable, accessible, and usable before family-live becomes the default testing/usage lane.

## Release gates

### 1. Static and contract gates

- Typecheck API, web, item capture, local assistance, and shopping intelligence.
- Validate OpenAPI and generated client types.
- Validate every catalog schema, foreign key, alias rule, hierarchy, identity recipe, and checksum.
- Architecture checks prevent product/language knowledge in application code and prevent routes that bypass centralized authorization.

### 2. Unit and property gates

- Parser span coverage and quantity/package preservation.
- Descriptor-role positive/negative/metamorphic cases.
- Entity graph, capitalization, and identity recipes.
- Suggestion global ranking, ambiguity, IME, Unicode, and no-silent-rewrite properties.
- Learning evidence lifecycle and reversibility.
- Config fail-closed rules and semantic snapshot upcasters.

Property invariants include: normalization idempotence, no numeric-token loss after suggestion acceptance, deterministic ranking, identity stability under whitespace/case aliases, no exact merge with unresolved required participants, and replay-equivalent upcasting.

### 3. API/integration gates

- All route families deny unauthenticated/cross-household access.
- Client candidate references are revalidated and stale/tampered candidates draft safely.
- Merge/correct/undo preserves full product and descriptor semantics.
- Two simultaneous physical lanes remain isolated through writes, reads, SSE, restart, reset, backup, and restore.
- Migration dry run reports zero unexplained data loss and all identity collisions.

### 4. Browser/E2E gates

Run only against a harness-created sandbox proven by handshake. Verify:

- spelling suggestion and range-preserving acceptance;
- Maggi-style brand/product capitalization from fixture catalog;
- low-fat/ordinary/packaging adjective distinctions;
- default quantity/unit behavior remains correct;
- family learning accept/clear/restore;
- two-device shared-list updates and separate device preferences;
- keyboard, touch, screen reader semantics, IME, narrow/mobile layout;
- offline free-text fallback and stale-candidate recovery;
- no request per keystroke.

### 5. Performance and resilience gates

- Measured p50/p95 assistance latency and memory at target catalog sizes on mobile-class hardware.
- API latency and concurrent SSE behavior with family-sized data.
- Crash/restart during migration and backup.
- Full-disk/quota/persistence failures produce visible, non-destructive outcomes.
- Corrupt local assistance records do not affect shopping-item truth.

### 6. Security/privacy gates

- Enrollment expiry/replay/revocation/recovery.
- No credentials in URLs, logs, screenshots, or error bodies.
- LAN threat model documented; HTTPS required before exposure to an untrusted network.
- Capture-audit endpoints are household-authorized and raw text has retention/export/delete policy.
- Reset/seed/test commands refuse live even under misleading environment variables.

## Rollout sequence

1. Freeze and snapshot the current mixed database; retain it as sandbox/quarantine.
2. Run all gates against ephemeral sandbox.
3. Deploy the same built commit to persistent sandbox; soak with automated and manual scenarios.
4. Create a clean live database and one-time family enrollment flow.
5. Rehearse backup and restore; record checksums and recovery time.
6. Enable family-live on 4200 only after E2E scripts no longer target it and handshake enforcement is active.
7. Monitor proposal/conflict/draft/error counts locally without collecting external telemetry.
8. Import selected existing family rows only through reviewed export/import, never by guessing from mixed data.
9. Keep a rollback-compatible binary and snapshot until the new snapshot/identity version has completed the observation window.

## User acceptance scenarios

The final handoff should give exact URLs and expected observations for:

1. Family enrollment and shared list update from two devices.
2. `maggie noo 2 packs of 70 g`: suggestion corrects only item text, preserves quantities, stores canonical identity/capitalization.
3. `low-fat milk`: important descriptor retained and not merged with a conflicting variant.
4. `1 big pack of 8 pieces`: qualifier retained as packaging evidence, correct count/package interpretation.
5. A deliberate typo: it does not spread; explicit correction can be accepted, then cleared/restored.
6. Same-label ambiguous products: choices remain distinct.
7. Sandbox mutation: it never appears in family-live, including local suggestions.
8. Backup restore into disposable verification lane reproduces live row counts and integrity checks.

## Definition of done

The phase is complete only when all automated gates pass from a clean checkout/configuration, the sandbox soak passes, migration/backup/restore artifacts are verified, family-live cannot be reached by test commands, and the manual acceptance evidence is recorded. Passing unit tests alone is not sufficient.

