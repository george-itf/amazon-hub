# Deprecated Files - Quarantine Zone

This folder contains files that have been identified as redundant during the system audit on 2026-01-15.

## Quarantine Protocol

These files are NOT deleted immediately. Instead:
1. Files are moved here first
2. Server startup checks for unexpected imports
3. If no issues after 2 weeks, files can be safely deleted

## Quarantined Files

### picklists.js (moved 2026-01-15)
**Reason**: Route file was never mounted in `/server/index.js`
**Evidence**: `grep -r "import.*picklists" server/` returned 0 results
**Safe to delete after**: 2026-01-29

### validation.js (moved 2026-01-15)
**Reason**: Utility file was never imported anywhere in the codebase
**Evidence**: `grep -r "from.*validation" server/` returned 0 results (excluding types/validation.js which is different)
**Safe to delete after**: 2026-01-29

## How to Restore

If any of these files are needed:
```bash
mv server/_deprecated/filename.js server/routes/  # or utils/
```

Then ensure proper imports are added.
