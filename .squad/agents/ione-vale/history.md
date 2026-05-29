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

- **iOS `setPointerCapture` + listener cleanup interaction** — On iOS Safari, calling `removeEventListener('pointermove', fn)` on an element that currently holds `setPointerCapture()` releases the pointer capture. This is why any `useEffect` that re-attaches drag listeners during active dragging (e.g., because `drag` state is in the deps array) causes drag to stop tracking after the first state change. Fix: use stable refs (`dragRef`, `handleDragMoveRef`, `handleDragEndRef`) updated each render, so event-listener closures are never recreated during a drag gesture.
- **`_incomingFillerNode` pattern** — Any async flow in Web Audio that creates a source node and then promotes it to a named field after a delay MUST track the intermediate node separately. Clearing the completion timer is not enough — the node itself is still playing.
- **`xfadeCompletionTimer` is shared** — The same `xfadeCompletionTimer` is used for both normal playlist crossfades and filler-entry crossfades. Cancelling it in `exitFillerMode` is safe because filler-related cleanup should always win; there should be no in-flight playlist crossfade when filler is active.
- **Key files:** `src/audio/AudioEngine.ts` (crossfade engine), `src/screens/PlaybackScreen.tsx` (filler mode React state machine at lines 738–779).
- **Build command:** `npm run build` (tsc + vite). Deploy: `node deploy.mjs`.
- **Fill mode React state** (`isFillerMode`) is set to `true` eagerly when `enterFillerMode()` is called; the engine's `_inFillerMode` is set to `true` only after the 6-second crossfade completes. This timing gap is the source of several race conditions.
- **`onCrossfadeStart` does NOT fire for fill entry** — `enterFillerMode` in AudioEngine starts the filler gain ramp silently. React sets `isFillerMode=true` before the engine completes the internal crossfade. For UI fade coordination during fill entry, use the `fillerScheduled`/`isFillerMode` React state, not `onCrossfadeStart`.
- **Bookmark fade pattern** — Three mechanisms coordinate bookmark visibility: (1) `onCrossfadeStart` → fade out (normal and fill-exit crossfades), (2) `onTrackChange` → fade in new track's bookmark, (3) `fillerScheduled` useEffect → fade out when fill is scheduled, fade in if cancelled. State: `bookmarkXfadeOpacity` (0/1) + `bookmarkXfadeDuration` (ms). `prevFillerScheduledRef` distinguishes fill-cancel from fill-start vs. fill-exit transitions.
- **Render condition guards fill visibility** — The bookmark JSX uses `!isFillerMode && !fillerScheduled` so the element is fully unmounted during fill (no pointer events, no layout cost), while the opacity fade-out runs before those conditions change, ensuring no visible jump.
- **Fill mode scrim pattern** — A `position: fixed`, `zIndex: 8`, `rgba(0,0,0,0.5)` scrim div signals modal state during fill. It sits between the background UI (z-index 0-5) and the fill overlay (z-index 10). The WitchDance logo container must be raised to z-index 11 so it stays crisp above the scrim. Render both scrim and overlay with the same `(fillerScheduled || isFillerMode)` condition.
- **Z-index stack in PlaybackScreen:** particles/credits z-1, progress/controls z-2–5, fill scrim z-8, fill overlay z-10, WitchDance logo z-11.

### 2025-05-27 — Fix: Drag-and-drop only moves one position regardless of drag distance

**Bug:** When dragging a track in the playlist, it only moved down by one position no matter how far the user dragged. Console logs confirmed `deltaY` was being calculated correctly, but `toIndex` never exceeded `fromIndex + 1`.

**Root Cause (`src/screens/Playlist.tsx`):**

The `useEffect` that attaches pointer event listeners had `[drag, handleDragMove, handleDragEnd]` in its dependency array. Every time `drag.toIndex` changed (i.e., the first position update), React:
1. Ran the effect cleanup — **removing `pointermove` listener from the button**
2. Re-attached fresh listeners with the updated `drag` in closure

On iOS Safari, removing a `pointermove` listener from an element that holds `setPointerCapture()` releases the pointer capture. With capture gone, all subsequent `pointermove` events stop reaching the drag-handle button entirely. The drag appeared frozen at 1 position after the first position change.

**Fix (`src/screens/Playlist.tsx`):**
- Added `dragRef`, `handleDragMoveRef`, `handleDragEndRef` refs (typed to match the state/handlers)
- Synchronize refs each render (after all handlers are declared): `dragRef.current = drag`, etc.
- Event-listener closures in `useEffect` read from refs instead of capturing closures
- Changed `useEffect` deps to `[tracks, handleDragStart]` — no longer includes `drag`, `handleDragMove`, or `handleDragEnd`
- Listeners are now stable for the entire drag gesture; `setPointerCapture` is never disrupted

**Files:** `src/screens/Playlist.tsx`
**Commit:** `fix: drag-and-drop only moves one position regardless of drag distance`

### 2025-05-26 — Fix: Infinite drag event loop in Playlist

**Bug:** When dragging a track in the playlist, thousands of `[DRAG START]` events flooded the console. The same event fired repeatedly and indefinitely, continuing even after the mouse left the browser window entirely. This made drag-and-drop completely unusable.

**Root Cause (`src/screens/Playlist.tsx` lines 116-144):**

The `useEffect` hook that attaches pointer event listeners had a broken cleanup pattern:
1. Inside the `forEach` loop over drag handles, it used `return ()` to attempt cleanup
2. **`forEach` doesn't use return values** — those cleanup functions were discarded
3. The effect's dependencies included `drag`, `handleDragStart`, `handleDragMove`, `handleDragEnd`
4. When `setDrag()` was called during drag start, it triggered a re-render
5. The useEffect ran again, attaching NEW listeners without removing old ones
6. Each drag movement caused more state changes, more re-renders, exponential listener growth
7. The callbacks themselves were recreated on every render (due to `drag` dependency), compounding the problem

**Fix (`src/screens/Playlist.tsx`):**
- Collected cleanup functions into a `cleanups: (() => void)[]` array during the `forEach` loop
- Returned a proper cleanup function from the useEffect that calls all accumulated cleanups
- This ensures all event listeners are removed before new ones are attached on each effect run

**Files:** `src/screens/Playlist.tsx`
**Commit:** `fix: stop infinite drag event loop in Playlist`
