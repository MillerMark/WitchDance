# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Frontend / Audio Engineering | Ione Vale | Web Audio API engine, crossfade logic, playlist UI, PWA shell, file picker, playback controls, React/TypeScript implementation |
| UI / UX Design | Lyra Morn | Screen design, interaction architecture, design system, component specs, visual polish |
| QA / Testing | *(role not yet filled)* | Crossfade timing edge cases, loop correctness, device testing |
| Code review | *(role not yet filled)* | Review PRs, check quality, suggest improvements |
| Session logging | Scribe | Automatic — never needs routing |

> **Note:** UI/UX, QA, and code review roles are unfilled. Until those members are hired, the Coordinator should triage those needs and assign to Ione Vale only when the work falls within her Frontend / Audio charter. Scope and priority decisions are handled by the Coordinator.

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Coordinator |
| `squad:ione-vale` | Pick up issue and complete the work | Ione Vale |
| `squad:lyra-morn` | Pick up issue and complete the work | Lyra Morn |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Coordinator** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Coordinator review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously — once a QA member is hired.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Coordinator handles all `squad` (base label) triage.

