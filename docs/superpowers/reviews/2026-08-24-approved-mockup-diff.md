# Approved mockup parity review

Reference: `C:\Users\praty\.codex\visualizations\2026\08\16\01a0096e-b8cc-7bc1-a9ec-b16f71e03d19\duckworth-ui-wireframe.html`

## Differences found before correction

### Shared shell and header

- The implementation added a green `D` tile; the approved mockup uses the plain serif `Duckworth` wordmark.
- The implementation showed a large yellow sandbox banner in the page flow; the mockup keeps runtime context as a small connection status.
- The implementation used a larger outer shell (`68rem`) and a heavy shadow; the mockup uses a calmer paper window with a `62rem` content measure.
- The implementation's page intro spacing and connected status treatment were different from the mockup.
- The implementation used SVG mobile icons while the approved preview used compact home/settings controls; the corrected version keeps accessible drawn icons but matches their size, position, and quiet treatment.

### Main list

- The implementation omitted the mockup's second `Shopping list` heading above the sort control.
- Sort and item count were placed in a separate right-aligned toolbar instead of the same heading row.
- The implementation's lead copy said “helps clarify”; the approved copy says “will help clarify”.
- The implementation exposed “Find optional details” as a large third capture button; the mockup keeps the primary capture row to input plus Add. The correction makes optional lookup contextual and quiet rather than visually competing with Add.
- Item rows used filled beige action buttons; the mockup uses quiet text actions with the green brand color.
- The implementation used a lighter row divider and a different action layout; the correction uses the mockup's full-width list rule and row rhythm.
- The live list includes additional working states (remove, attention, optional details, capture result, archive). These remain available, but are styled as secondary states so the baseline list keeps the mockup's calm hierarchy.

### Settings

- The implementation rendered language and conversation controls as collapsed native disclosure blocks; the mockup presents settings as visible divider-separated sections.
- The implementation did not include a visible “Household connection” section.
- The implementation used separate “Spelling help” and “Capture history” titles with implementation-oriented eyebrow copy; the mockup uses “Personal spelling help” and “Privacy and capture history”.
- The implementation used “Duckworth learned”; the mockup uses “Learned preferences”.
- The implementation placed settings controls below their headings in a narrow single-column flow; the mockup uses a two-column heading/content layout on desktop and a single-column layout on mobile.
- The implementation's settings description and section spacing did not match the mockup's concise right-aligned page description and generous divider rhythm.

### Household access

- The implementation showed only a Phase 2 note and a short member list.
- The approved mockup includes the invite section, expiring code, copy/regenerate actions, QR preview, join request review, and a member table with role, join date, and access action.
- The corrected screen keeps those visual surfaces as an explicitly labelled non-functional preview until the Phase 2 backend exists; it does not create fake invitations or mutate membership.

### Responsive behavior

- The implementation removed the mockup's paper-window edge treatment on mobile and hid more context than the mockup.
- The implementation's mobile list rows retained large filled action pills and a prominent optional-details button, making the page materially denser.
- The corrected mobile layout follows the mockup's 360px composition: compact wordmark, icon navigation, two-column capture row, stacked settings sections, quiet row actions, and no horizontal overflow.

## Correction rule

The approved wireframe is the visual source of truth. Existing application behavior remains available, but behavior-specific states are rendered with the same typography, spacing, borders, colors, and action hierarchy as the wireframe.
