# Duckworth future work

## Planned input channel: camera and gallery photos

Status: planned, not implemented.

Add another way to add shopping-list items by ingesting a photo captured from the device camera or selected from the device gallery.

When this work is designed, cover the complete path:

- Frontend: camera permission, camera capture, gallery selection, preview, retake/remove, multi-photo handling, progress, offline/error states, and accessible controls.
- API: an authenticated/source-scoped image-capture contract that can carry the original asset reference, content type, dimensions, checksum, capture time, locale, and household/list context without changing the existing text/voice capture contract.
- Brain input: route image captures through the same source-neutral interpretation boundary; keep OCR/vision behind a provider-neutral adapter so the UI and API do not depend on one vendor.
- Understanding: extract candidate item names, quantities, units, pack sizes, brands, adjectives, and labels from packaging or handwritten lists; preserve uncertainty as evidence and clarification drafts rather than guessing.
- Provenance: retain the original user input and interpretation/audit record, including image checksum, extractor/provider version, source spans or regions, confidence, corrections, and runtime versions.
- Privacy and safety: explicit user consent, least-privilege access, safe image retention/deletion policy, metadata handling, upload-size/type limits, malware/content checks, and no accidental exposure of household images.
- User correction: allow the user to edit extracted fields before committing, while preserving the original image interpretation and the final correction as separate provenance.
- Verification: tests for camera/gallery adapters, duplicate/replayed images, multiple items per image, blurry/empty/unsupported images, handwriting and packaging text, ambiguous quantities, multi-device context isolation, accessibility, and real-browser/device flows.

Dynamic product, brand, category, language, and adjective knowledge must remain in validated runtime/catalog data. Do not add product-specific image rules to application code.

## Future product area: household membership and group access

Status: parked until the core shopping experience is stable and accepted.

Duckworth will eventually need a simple, familiar household-group model similar to Telegram or WhatsApp groups:

- One user account may belong to more than one household.
- Each household has its own private shopping lists and settings.
- A household owner can allow users to join by approving a join request or invitation.
- Any invite code, link, or QR code must be random, short-lived, single-use, and revocable; it must never become a permanent shared password.
- Owners can view members, pending requests, active invitations, and enough activity/device information to recognize unfamiliar access.
- Owners can remove a member and immediately revoke that member's active sessions.
- Household switching must be explicit so a user does not accidentally add items to the wrong household.
- Membership, invitation, removal, leave, rejoin, lost-device, and account-recovery flows must be designed together before implementation.

Do not expand the current development pairing flow into this feature prematurely. Revisit it after the core list, capture, clarification, and correction workflows are satisfactorily validated.
