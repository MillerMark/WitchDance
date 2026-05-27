# Deployment Workflow

**Status:** Active  
**Date:** 2026-05-27  
**Decision Makers:** User

## Context

Need a consistent workflow for deploying changes to ensure all updates reach production quickly and reliably.

## Decision

After every code change, the following steps must be executed:

1. **Commit** - Commit all changes with a descriptive message
2. **Push** - Push to GitHub repository
3. **Deploy** - Run `npm run deploy` to build and deploy to GitHub Pages

This ensures that all changes are immediately visible on the live site at https://millermark.github.io/WitchDance/

## Command Sequence

```bash
git add -A && \
git commit -m "descriptive message" && \
git push && \
npm run deploy
```

## Rationale

- Immediate feedback on changes
- No accumulated technical debt from undeployed changes
- Users always have access to the latest version
- Simpler workflow - no separate staging/production cycles needed for this project

## Consequences

- Every change goes live immediately
- Need to ensure changes are tested before committing
- Version number should be updated for significant changes
