---
name: "ios-pointer-capture-stable-listeners"
description: "How to keep pointermove listeners stable during drag on iOS Safari so setPointerCapture is never lost"
domain: "drag-and-drop / touch-input"
confidence: "high"
source: "earned"
---

## Context

On iOS Safari, removing a `pointermove` event listener from an element that currently holds `setPointerCapture()` releases the pointer capture. This is a platform-specific behavior that causes drag gestures to silently stop tracking after any state update that triggers listener cleanup and re-attachment.

**Symptom:** drag starts, moves one position, then freezes — regardless of how far the pointer continues to move.

## The Pattern

Use **stable refs** for drag state and handler functions so the event-listener closures never need to be recreated during an active drag.

### Step 1 — Declare refs alongside state

```typescript
const [drag, setDrag] = useState<DragState | null>(null)

// Stable refs so listener closures never need re-attachment during drag
const dragRef = useRef<DragState | null>(null)
const handleDragMoveRef = useRef<(e: PointerEvent) => void>(() => {})
const handleDragEndRef = useRef<(e: PointerEvent) => void>(() => {})
```

### Step 2 — Sync refs each render (AFTER handler declarations)

```typescript
// These handlers must be declared before this block
const handleDragMove = useCallback((e: PointerEvent) => { ... }, [drag])
const handleDragEnd  = useCallback((e: PointerEvent) => { ... }, [drag])

// Sync refs — runs synchronously each render before effects fire
dragRef.current           = drag
handleDragMoveRef.current = handleDragMove
handleDragEndRef.current  = handleDragEnd
```

### Step 3 — Event listeners read from refs; deps exclude drag

```typescript
useEffect(() => {
  const cleanups: (() => void)[] = []

  elements.forEach((element, id) => {
    const onPointerDown = (e: PointerEvent) => handleDragStart(e, id)

    // Read dragRef / handler refs — not captured state
    const onPointerMove = (e: PointerEvent) => {
      if (dragRef.current?.id === id) handleDragMoveRef.current(e)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (dragRef.current?.id === id) handleDragEndRef.current(e)
    }
    const onPointerCancel = onPointerUp

    element.addEventListener('pointerdown',   onPointerDown,   { passive: false })
    element.addEventListener('pointermove',   onPointerMove,   { passive: false })
    element.addEventListener('pointerup',     onPointerUp,     { passive: false })
    element.addEventListener('pointercancel', onPointerCancel, { passive: false })

    cleanups.push(() => {
      element.removeEventListener('pointerdown',   onPointerDown)
      element.removeEventListener('pointermove',   onPointerMove)
      element.removeEventListener('pointerup',     onPointerUp)
      element.removeEventListener('pointercancel', onPointerCancel)
    })
  })

  return () => cleanups.forEach((c) => c())
}, [elements, handleDragStart])
// NO drag / handleDragMove / handleDragEnd in deps
```

## Why refs are safe here

React updates refs synchronously during the render phase, before any effects run. This guarantees that by the time any queued `pointermove` event fires and reads `dragRef.current`, the ref already reflects the latest drag state from the most recent render.

## Watch-outs

- **Place ref sync AFTER handler declarations** — TypeScript will error if you reference `handleDragMove` before it is declared with `const`.
- **`elements` in deps** — if the element set changes (e.g., tracks added/removed), the effect must re-run to attach listeners to new elements. Include the element collection in deps.
- **`handleDragStart` in deps** — only `pointerdown` needs the current handler; it is fine to recreate this listener on collection change. Keep `handleDragStart` (or its dependency, the element list) in deps.
- This pattern does NOT apply to `pointerdown` — capture hasn't started yet so re-attachment there is harmless.

## Known usage

- `src/screens/Playlist.tsx` — drag reorder handles, `dragRef` / `handleDragMoveRef` / `handleDragEndRef`
