# Remaining Audit Items

## Overview

This document identifies audit recommendations that were **not implemented** in the P0/P1/1-Month milestones, categorised by priority and effort.

---

## Implemented vs Remaining

| Category | Implemented | Remaining |
|----------|-------------|-----------|
| P0 Critical | 3/3 (100%) | 0 |
| P1 Major | 5/5 (100%) | 0 |
| 1-Month | 5/5 (100%) | 0 |
| P2 Moderate | 0/7 | 7 |
| P3 Polish | 0/5 | 5 |
| IA Restructure | Partial | Ongoing |

---

## P2 Items — Moderate Friction (Not Yet Implemented)

### P2-01: Navigation Grouping by Intent

**Source**: `01_ia_navigation.md` (IA-02)

**Current State**: Flat navigation with 8 top-level items

**Recommended State**:
```
Command
  └─ Dashboard

Catalogue
  ├─ Inventory
  ├─ Listings
  └─ ASIN Tools

Fulfilment
  └─ Orders & Shipping

Insights
  └─ Analytics

Admin
  ├─ Settings
  └─ Audit ✅ (implemented)
```

**Effort**: Medium (2-3 days)
**Impact**: Reduced cognitive load, clearer mental model

**Status**: Partially done (Admin section added with Audit). Full restructure deferred.

---

### P2-02: Terminology Standardisation

**Source**: `01_ia_navigation.md`

**Problem**: Inconsistent status labels, reason codes, and action verbs across the system

**Recommendation**:
- Create `constants/terminology.js` with standardised:
  - Status labels (PICKED, READY_TO_PICK, DISPATCHED, etc.)
  - Reason codes (STOCK_COUNT, DAMAGE, RETURN, etc.)
  - Action verbs (Adjust, Apply, Create, Remove)
  - Safety levels (safe, risky, irreversible)

**Effort**: Medium (2-3 days)
**Impact**: Faster recognition, fewer errors

---

### P2-03: Undo Window for Stock Adjustments

**Source**: `03_critical_flows.md`

**Current State**: Rollback guidance provided, but no actual undo button

**Recommendation**:
- Add 2-minute undo window after stock adjustment
- "Undo" button creates reverse adjustment automatically
- After 2 minutes, require manager approval for reversal

**Effort**: Medium (2-3 days)
**Impact**: Faster error recovery

---

### P2-04: Real-Time Progress for Shipping Batches

**Source**: `03_critical_flows.md`

**Current State**: Preflight modal added; progress tracking improved but not real-time SSE

**Recommendation**:
- Implement Server-Sent Events (SSE) for live progress updates
- Show "Processing 47 of 100 orders..." with actual count
- Add cancellation capability mid-batch

**Effort**: High (3-5 days)
**Impact**: Better operator confidence during long batches

---

### P2-05: BOM Impact Preview

**Source**: `03_critical_flows.md` (Listings section)

**Problem**: BOM changes don't show impact on dependent listings

**Recommendation**:
- Before BOM assignment, show: "This will affect X listings, Y pending orders"
- Show before/after inventory impact
- Warn if BOM change affects in-progress picks

**Effort**: Medium (2-3 days)
**Impact**: Prevents cascading errors

---

### P2-06: Conflicting Override Validation

**Source**: `03_critical_flows.md` (Listings section)

**Problem**: Conflicting listing overrides can be saved

**Recommendation**:
- Validate override precedence before save
- Warn if override conflicts with BOM settings
- Show which setting "wins" in conflict

**Effort**: Low (1-2 days)
**Impact**: Prevents configuration errors

---

### P2-07: ASIN Analyzer Execution Path

**Source**: `03_critical_flows.md` (ASIN Analyzer section)

**Problem**: Recommendations have no execution path; BOM selection looks persistent but isn't

**Recommendation**:
- Add explicit "Simulate" vs "Apply" states
- Add action bar for bulk execution from analysis
- Make BOM selection state explicit (saved vs unsaved)

**Effort**: Medium (2-3 days)
**Impact**: Converts analysis into action

---

## P3 Items — Polish (Not Yet Implemented)

### P3-01: Instrumentation Dashboards

**Source**: `04_prioritised_plan.md`

**Recommendation**:
- Add success metrics tracking:
  - Time-to-task (shipping, adjustments)
  - Error & reversal rate
  - Bulk action adoption
  - Saved view usage
  - Incident recovery time
- Display in Analytics or separate Ops Health page

**Effort**: High (5+ days)
**Impact**: Data-driven improvement

---

### P3-02: Column Reordering via Drag-and-Drop

**Current State**: Column show/hide implemented; reorder requires manual array editing

**Recommendation**:
- Add drag-and-drop column reordering in HubTable
- Use `@dnd-kit` or similar library
- Persist order to saved views

**Effort**: Medium (2-3 days)
**Impact**: Power user efficiency

---

### P3-03: URL-Driven State for All Pages

**Current State**: Implemented for Shipping and Listings (HubTable pages)

**Recommendation**:
- Extend to Inventory, Allocation, Analytics
- Enable shareable links with filter state
- Support browser back/forward

**Effort**: Medium (1-2 days per page)
**Impact**: Collaboration, support debugging

---

### P3-04: Keyboard Shortcuts Help Modal

**Current State**: Shortcuts exist (`g+d` for Dashboard, etc.) but undiscoverable

**Recommendation**:
- Add "?" shortcut to show keyboard shortcuts modal
- List all available shortcuts by category
- Show current page shortcuts prominently

**Effort**: Low (1 day)
**Impact**: Power user discovery

---

### P3-05: Empty State Improvements

**Current State**: Basic "No data" messages

**Recommendation**:
- Add contextual empty states with:
  - Explanation of why empty
  - Suggested actions
  - Links to relevant docs/help

**Effort**: Low (1-2 days)
**Impact**: Better onboarding, reduced support

---

## IA Restructure — Ongoing Decisions Required

### Product Map Drift (IA-01)

**Source**: `01_ia_navigation.md`

**Problem**: Backend API and deprecated UI reference screens users cannot reach (Orders, Picklists, Returns, Review Queues)

**Decision Required**:
1. **Option A**: Surface missing ops flows (add Orders, Picklists, Returns pages)
2. **Option B**: Remove legacy affordances (delete deprecated code, remove unused API routes)

**Recommendation**: Option A (surface flows) — the API routes exist and work; adding UI unlocks value

**Effort**: High (1-2 weeks for full implementation)

---

## Prioritised Backlog

Based on impact vs effort:

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| **Next Sprint** | P2-06: Override validation | Low | Medium |
| **Next Sprint** | P2-03: Undo window | Medium | High |
| **Next Sprint** | P3-04: Shortcuts help | Low | Medium |
| **Following** | P2-01: Nav grouping | Medium | Medium |
| **Following** | P2-02: Terminology | Medium | Medium |
| **Following** | P2-05: BOM impact preview | Medium | High |
| **Backlog** | P2-04: SSE progress | High | Medium |
| **Backlog** | P2-07: Analyzer execution | Medium | Medium |
| **Backlog** | P3-01: Instrumentation | High | High |
| **Backlog** | P3-02: Column drag-drop | Medium | Low |
| **Backlog** | P3-03: URL state all pages | Medium | Medium |
| **Backlog** | P3-05: Empty states | Low | Low |
| **Requires Decision** | IA-01: Product map | High | High |

---

## Success Metrics (from Audit)

Track these to measure improvement:

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Time-to-task (shipping) | Unknown | -30% | Instrumentation |
| Time-to-task (adjustment) | Unknown | -20% | Instrumentation |
| Error & reversal rate | Unknown | -50% | Audit log analysis |
| Bulk action adoption | Low | >70% of eligible | Usage tracking |
| Saved view usage | 0% | >50% of users | Usage tracking |
| Incident recovery time | Unknown | -40% | Support ticket analysis |

---

## Conclusion

**All P0, P1, and 1-Month items are complete.**

The remaining items (P2/P3) represent moderate friction and polish improvements. The highest-impact next steps are:

1. **Undo window for stock adjustments** (P2-03) — direct error recovery
2. **Override validation** (P2-06) — prevents configuration errors
3. **BOM impact preview** (P2-05) — prevents cascading errors

The **IA restructure** (product map drift) requires a product decision before implementation.
