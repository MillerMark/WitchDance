# Ione Vale — History

## Hire

- **Date:** 2026-05-23
- **Universe:** SquadDash Universe
- **Role:** Frontend / Audio Engineer
- **Project:** WitchDance

Hired as the primary builder for the WitchDance crossfade music player PWA. Responsible for the Web Audio API crossfade engine, playlist sequencing UI, and the mobile-first PWA shell targeting iPhone Safari.

## Activity Log

### 2025-06-01 — Fix: Orphaned filler audio nodes on exitFillerMode

**Bug:** After pressing "Resume Performance", both the fill track and the regular playlist track played simultaneously.

**Root Cause (three race conditions in `AudioEngine.ts`):**

1. **`_beginFillerLoop` orphan** — `_beginFillerLoop()` creates `newFillerNode` as a local variable and starts it. When `exitFillerMode()` cancelled `_fillerLoopCompletionTimer`, the node was still playing but unreachable. It would bleed through behind the playlist track.

2. **`enterFillerMode` `xfadeCompletionTimer` race** — `exitFillerMode()` did not cancel the `xfadeCompletionTimer` that `enterFillerMode()` sets. If the user exited filler mode within 6 seconds of entering it, that timer would fire late, re-promote the filler node to `currentNode`, and set `_inFillerMode = true` *after* we had already started the playlist node.

3. **Broken `currentNode` guard** — The guard `if (this.currentNode === oldFillerNode)` in `exitFillerMode`'s own completion timer failed if `currentNode` had been swapped by any of the above race conditions, preventing the playlist node from ever being promoted to `currentNode`.

**Fix (`src/audio/AudioEngine.ts`):**
- Added `_incomingFillerNode: AudioNode2 | null` field to track nodes started-but-not-yet-promoted in both `enterFillerMode` and `_beginFillerLoop`.
- `exitFillerMode()` now calls `_clearTimer('xfadeCompletion')` to cancel any in-flight `enterFillerMode` completion.
- Captured `orphanedFillerNode` from `_incomingFillerNode` and explicitly fades it out + tears it down alongside `oldFillerNode`.
- Made `this.currentNode = newNode` unconditional (removed the broken stale-reference guard).
- `_reset()` also tears down `_incomingFillerNode`.

**Files:** `src/audio/AudioEngine.ts`
**Commit:** `fix: stop orphaned filler audio nodes on exitFillerMode`

## Learnings

- **`_incomingFillerNode` pattern** — Any async flow in Web Audio that creates a source node and then promotes it to a named field after a delay MUST track the intermediate node separately. Clearing the completion timer is not enough — the node itself is still playing.
- **`xfadeCompletionTimer` is shared** — The same `xfadeCompletionTimer` is used for both normal playlist crossfades and filler-entry crossfades. Cancelling it in `exitFillerMode` is safe because filler-related cleanup should always win; there should be no in-flight playlist crossfade when filler is active.
- **Key files:** `src/audio/AudioEngine.ts` (crossfade engine), `src/screens/PlaybackScreen.tsx` (filler mode React state machine at lines 738–779).
- **Build command:** `npm run build` (tsc + vite). Deploy: `node deploy.mjs`.
- **Fill mode React state** (`isFillerMode`) is set to `true` eagerly when `enterFillerMode()` is called; the engine's `_inFillerMode` is set to `true` only after the 6-second crossfade completes. This timing gap is the source of several race conditions.
- **`onCrossfadeStart` does NOT fire for fill entry** — `enterFillerMode` in AudioEngine starts the filler gain ramp silently. React sets `isFillerMode=true` before the engine completes the internal crossfade. For UI fade coordination during fill entry, use the `fillerScheduled`/`isFillerMode` React state, not `onCrossfadeStart`.
- **Bookmark fade pattern** — Three mechanisms coordinate bookmark visibility: (1) `onCrossfadeStart` → fade out (normal and fill-exit crossfades), (2) `onTrackChange` → fade in new track's bookmark, (3) `fillerScheduled` useEffect → fade out when fill is scheduled, fade in if cancelled. State: `bookmarkXfadeOpacity` (0/1) + `bookmarkXfadeDuration` (ms). `prevFillerScheduledRef` distinguishes fill-cancel from fill-start vs. fill-exit transitions.
- **Render condition guards fill visibility** — The bookmark JSX uses `!isFillerMode && !fillerScheduled` so the element is fully unmounted during fill (no pointer events, no layout cost), while the opacity fade-out runs before those conditions change, ensuring no visible jump.
