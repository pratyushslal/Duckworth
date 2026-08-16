# Phase 2: Concurrent Conversation Contexts

**Status:** Approved design; foundation implemented, release gate still open
**Audience:** Product reviewer, implementer, and future adapter developers
**Scope:** Multiple devices and speakers using one shared household shopping list

## 1. What this phase solves

Phase 1 has one household conversation. Phase 2 allows several devices or
speakers to work at the same time without mixing their conversation state.

Example:

- A kitchen tablet adds “Amul butter”.
- A phone adds “Britannia biscuits”.
- Both items appear in the same household list.
- A follow-up or clarification from the tablet cannot accidentally use the
  phone’s draft or session.

The shared shopping list remains shared. Only conversation context, sessions,
drafts, follow-up references, and access tokens are isolated.

## 2. Source-agnostic boundary

Every input adapter—typed text, voice transcript, API, or digital assistant—
passes the same brain command. The adapter supplies transport metadata; it does
not interpret the shopping language.

```ts
interface ConversationContextRef {
  contextId: string;
  deviceId: string;
  speakerId: string | null;
}

interface ContextualConversationCaptureCommand {
  householdId: string;
  context: ConversationContextRef;
  sessionId?: string;
  text: string;
  locale: string;
  countryCode: string;
  source: 'text' | 'voice' | 'api' | 'assistant';
  occurredAt: string;
  idempotencyKey: string;
}
```

The brain continues to own interpretation, quantity/unit extraction, brand
recognition, duplicate handling, follow-up resolution, and clarification
creation. Angular only forwards opaque context metadata and renders server
decisions.

## 3. Context identity and security

- The server creates the opaque `contextId`.
- A context represents `(household, device, speaker)`.
- A missing speaker is `null`; the system never invents one.
- Access tokens are returned only during registration or handoff claim.
- The server stores token hashes, not raw tokens.
- A token for context A cannot authorize context B, another household, a draft,
  or a session.
- Device/speaker identifiers never become shopping item text.

Each context has at most one active conversation session. Existing Phase 1
callers without context metadata continue through a deterministic legacy
context until those adapters migrate.

## 4. Required invariants

1. **Context isolation:** sessions, drafts, and follow-up references are scoped
   to the authorized context.
2. **Shared inventory:** clear items from all authorized contexts reach the same
   household list.
3. **Determinism:** equivalent text with equivalent locale, country, and
   candidates produces the same brain decision regardless of source or device.
4. **Replay safety:** `(contextId, idempotencyKey)` returns the original result
   and creates no second item event.
5. **Additive concurrency:** two quantity additions are both retained and each
   has its own undo event.
6. **Stale-write safety:** an obsolete item version never overwrites a newer
   value; the current item is returned as recoverable conflict state.
7. **Safe handoff:** handoff tokens are target-bound, short-lived, and single-use.
8. **No side effects outside scope:** no retailer routing, pricing, ordering,
   payment, cloud interpretation, medical advice, or vendor SDK integration.

## 5. Current implementation status

### Implemented foundation

- Source-neutral context contract.
- Server context registration, listing, close, token authorization, and handoff.
- Durable list/session/context ownership.
- Scoped session restoration and pending-close state.
- Capture idempotency receipts.
- Migration support for existing Phase 1 data.

### Still required before Phase 2 release

- Dedicated two-browser acceptance tests.
- Explicit context-isolated draft/follow-up tests.
- Concurrent additive merge and stale-correction conflict tests at the context
  boundary.
- Adapter-equivalence tests for text, voice, API, and assistant sources.
- Final context/handoff presentation in the web adapter and its accessibility
  checks.

The detailed checklist is in the [acceptance gate](2026-08-11-concurrent-contexts-acceptance.md).

## 6. Review decision requested

Please confirm these two decisions before the remaining implementation starts:

1. Multiple contexts share one household shopping list, while conversation
   drafts and references remain isolated.
2. The Phase 2 release is blocked until every acceptance-gate scenario is
   proven by API, migration, and browser tests.
