# Information Architecture & Navigation Audit

## Current State
The application exposes an 8-page IA:
- Dashboard
- Inventory
- Listings
- ASIN Analyzer
- Allocation
- Shipping
- Analytics
- Settings

However, the backend API surface and deprecated UI reveal a **larger ops suite**
(Orders, Picklists, Returns, Audit, Review Queues).

This mismatch creates **mental-model instability**.

## Key Issues

### IA-01 — Product map drift
- **Symptom:** Docs, shortcuts, and APIs reference screens users cannot reach.
- **Severity:** P1
- **Fix:** Decide canonical IA. Either surface missing ops flows or fully remove legacy affordances.

### IA-02 — Flat navigation hides intent
- “Shipping” actually means fulfilment execution.
- “Analyzer” is a tool, not a job.

**Recommendation:**
Group navigation by ops intent:

**Command**
- Dashboard

**Catalogue**
- Inventory
- Listings
- ASIN Tools

**Fulfilment**
- Orders & Shipping

**Insights**
- Analytics

**Admin**
- Settings / Audit

## Terminology Standardisation
Standardise and centralise:
- Status labels
- Reason codes
- Action verbs
- Safety levels (safe / risky / irreversible)

Outcome: faster recognition, fewer errors.
