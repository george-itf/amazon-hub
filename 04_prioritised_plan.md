# Prioritised Plan & Metrics

## Top P0 / P1 Fixes
1. Inventory stock adjustment contract + mode split (P0)
2. Shipping bulk guardrails & status gating (P0)
3. Error handling standard with correlation IDs (P1)
4. Allocation apply confirmation + rollback (P1)
5. HubTable adoption for Shipping & Listings (P1)

## Delivery Plan

### 1 Day
- Fix stock API mismatch + idempotency
- Replace accidental logout nav item
- Standard ErrorBanner
- Fix nav contrast & keyboard semantics

### 1 Week
- Inventory adjustment redesign
- Shipping preflight + batch history
- Remove browser `confirm()` usage
- Accessibility pass on interactive surfaces

### 1 Month
- HubTable rollout
- Saved views everywhere
- Audit trail UI
- Instrumentation dashboards

## Success Metrics
- Time-to-task (shipping, adjustments)
- Error & reversal rate
- Bulk action adoption
- Saved view usage
- Incident recovery time

## Outcome
The recommended changes prioritise **ops confidence**:
users can move faster **because the system protects them from expensive mistakes**.
