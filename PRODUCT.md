# Product

## Register

product

## Users

Duckworth serves families and other households in which several people capture, clarify, and purchase shared needs. People often use it in brief, distracted moments—while noticing an empty package, coordinating from another room, or actively shopping—and must be able to record intent without becoming the household's list administrator.

## Product Purpose

Duckworth is a calm coordination layer between noticing a household need and buying the right thing. It turns shorthand into actionable shopping intent, keeps one shared list current across household members, remembers confirmed routine choices, and asks for attention only when human judgment materially improves the outcome.

Success means needs are captured promptly, incomplete entries become usable with little effort, accidental duplicates and quantity/unit mistakes decline, and the list remains trustworthy even when the network or another household tab is changing state.

## Brand Personality

Calm, capable, and considerate. Duckworth should feel quietly intelligent rather than performative: direct language, obvious state, restrained confidence, and small moments of reassurance when the system has interpreted or remembered something.

## Anti-references

- Dense enterprise inventory software that turns capture into a multi-field form.
- Assistant interfaces that hide assumptions, silently overwrite intent, or demand confirmation for routine work.
- Generic card-heavy SaaS dashboards with ornamental metrics and weak information hierarchy.
- Low-contrast themes, ambiguous icon-only actions, and color-only warnings that disappear under dark-mode overrides.
- Interfaces that freeze the whole list for one request or feel unreliable on slow networks.

## Design Principles

1. **Capture first, clarify later.** Saving a rough need is better than losing a perfect one.
2. **Make assumptions conspicuous and reversible.** Inferred values explain their source and are easy to accept or replace.
3. **One shared truth without global friction.** Authoritative state reconciles clearly while unrelated work stays interactive.
4. **Reserve attention for decisions.** Missing or suspicious intent is visible; routine state stays quiet.
5. **Fast is part of trust.** Typing, interpretation, and local interactions remain immediate under poor networking.

## Current Local Assistance

- Latest-added ordering is the default; four deterministic sort modes persist per household/device profile.
- At most five suggestions combine private choices, household history, and reviewed active/fallback locale packs without a keystroke request.
- Suggestions remain advisory, preserve quantities, and always pass accepted text through the shared capture parser.
- Reviewed `en-IN` and `hi-Latn-IN` UI/dictionary bundles activate atomically and remain usable from the last valid browser cache.
- Likely spelling variants require an explicit, non-blocking decision. Raw observations and redirect keys remain private to the local device profile.
- Unsupported scripts and wording remain valid free text; missing dictionary coverage reduces assistance but never blocks capture.

## Explicit Deferrals

Price safety remains deferred. It must not introduce placeholder price fields, manual price entry, or warning UI until Duckworth has authoritative order history, store or restaurant identity, automatically discovered line/unit prices, currency metadata, and enough confirmed store/item samples for meaningful comparisons. Retailer routing, ordering, payments, cloud publication, and online Git remote configuration are also outside the current local-first slice.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Text, placeholders, controls, focus states, and status treatments must meet contrast requirements in light and dark environments. Meaning must never depend on color alone. All capture, detail, acceptance, edit, purchase, and retry flows must be keyboard-operable with clear labels and live-region feedback. Motion must respect reduced-motion preferences, and narrow/mobile layouts must preserve readable hierarchy without overflow.
