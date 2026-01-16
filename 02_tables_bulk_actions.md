# Tables, Filters, Saved Views & Bulk Actions

## Reality
Tables are the primary interface.
Current implementation mixes Polaris DataTable, IndexTable, and custom patterns.

Result: inconsistent selection, filtering, and bulk behaviour.

## Core Problems

### TB-01 — No standard bulk-action guardrails
- Selection exists without meaningful actions (e.g. Listings).
- High-risk actions lack scope summaries and previews.

**Severity:** P1–P0 depending on action.

### TB-02 — Saved views exist but are regressed
- `SavedViewsBar.jsx` exists but is unused in core screens.
- Power users must re-create filters daily.

### TB-03 — Column management missing
- Dense tables force horizontal scanning and scrolling.

## Table UX Standard (Proposed)

**HubTable** (single pattern):
- Search + filter chips
- Saved views (personal + shared)
- Column show/hide & reorder
- Selection rail with scope summary
- Bulk actions with preview & confirm
- URL-driven state (shareable views)

## Bulk Action Guardrail Pattern
Every bulk action must include:
1. Explicit scope summary
2. Preview / dry run
3. Confirmation (typed for irreversible)
4. Result report
5. Undo / rollback or clear recovery guidance

This pattern is mandatory for:
- Shipping labels
- Allocation apply
- Stock adjustments
- Listing configuration changes
