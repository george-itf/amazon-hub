# Critical Flow Deep Dives

## Shipping — Create Labels (P0-heavy)

### Problems
- “Ready to ship” includes READY_TO_PICK orders.
- Batch execution starts without strong confirmation.
- Fake progress indicator (static 50%).
- Server batch limit (100) not surfaced in UI.

### Severity
Multiple **P0** risks due to cost and fulfilment impact.

### Fixes
- Status gating: only ship-eligible orders allowed.
- Preflight confirmation with scope, service, cost.
- Async batch job model with resumable history.
- Enforce batch limits client-side.

---

## Inventory — Stock Adjustments (P0)

### Problems
- UI implies absolute stock count; API applies delta.
- Missing idempotency key.
- Role gating missing (ADMIN-only endpoint).
- No threshold warnings or undo.

### Fixes
- Split modes: **Set stock to** vs **Change by**.
- Show before/after preview.
- Require reason codes and typed confirmation for large changes.
- Always attach idempotency key.
- Surface audit entry post-change.

---

## Allocation — Preview → Apply

### Problems
- Preview lacks explainability (“why these numbers?”).
- Apply lacks rollback story.
- No staleness detection between preview and apply.

### Fixes
- Explain panel with constraints and reason codes.
- Typed confirmation with scope summary.
- Block apply if data drift detected.

---

## Listings — BOM & Overrides

### Problems
- BOM changes lack impact preview.
- Conflicting override inputs allowed.
- Selection without bulk actions.

### Fixes
- Before/after BOM impact preview.
- Validation of override precedence.
- Bulk assign/edit with guardrails.

---

## ASIN Analyzer

### Problems
- BOM selection looks persistent but isn’t.
- Recommendations have no execution path.

### Fixes
- Explicit “simulate” vs “apply” states.
- Action bar for bulk execution from analysis.
