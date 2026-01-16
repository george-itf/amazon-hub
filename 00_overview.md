# Amazon Hub – UX Audit Overview

## Purpose
This document set contains a comprehensive UX audit of the internal **Amazon Seller Central alternative** (“Amazon Hub”).
It is written for product, engineering, and operations leadership.

This is **not a security audit**.  
The focus is **operational UX**: speed, clarity, error prevention, bulk actions, and recovery.

## Scope
- Code-derived audit (React + Node/Express)
- Table-heavy, ops-grade workflows
- Power-user efficiency and guardrails
- Inventory, listings, allocation, shipping, analytics

## Method
The audit was performed in structured passes:
- Repo orientation & product map
- Users & jobs-to-be-done
- IA & navigation
- Tables & bulk UX
- Critical flows (deep dives)
- Feedback, trust, recovery
- Forms & data integrity
- Accessibility & consistency
- Prioritised plan & metrics

## Severity Scale
- **P0** – Blocks critical task or causes expensive/data-integrity errors
- **P1** – Major friction in frequent flows
- **P2** – Moderate friction; slows power users
- **P3** – Polish / minor improvements
