---
name: "webaudio-node-lifecycle"
description: "How to safely manage AudioBufferSourceNode ownership so nodes are never orphaned"
domain: "audio-engine"
confidence: "high"
source: "earned"
---

## Context

`AudioBufferSourceNode` starts playing the moment `.start()` is called. If the reference to the node is lost (e.g., a completion timer gets cancelled before promoting the node to a named field), the node becomes **orphaned**: still playing, no way to stop it. This surfaces as overlapping audio that the user cannot see or dismiss.

Applies to any Web Audio pattern where a node is started before it is "officially" owned — crossfade entry, filler loops, any two-phase play/promote flow.

## Patterns

### Own every node immediately

When you call `node.source.start()`, assign the node to a named field on the class **before** the async gap:

```typescript
// GOOD — node is owned before the gap
this._incomingFillerNode = fillerNode
fillerNode.source.start(0, offset)

this.xfadeCompletionTimer = setTimeout(() => {
  this.currentNode = fillerNode
  this._incomingFillerNode = null  // clear once promoted
}, xfadeSecs * 1000)
```

### Cancel timers AND handle the nodes they would have cleaned up

Cancelling a completion timer does NOT stop the node it was going to promote:

```typescript
// Clear the timer that would have promoted the node
this._clearTimer('fillerLoopCompletion')

// Also handle the node — fade it out or tear it down
if (this._incomingFillerNode) {
  const g = this._incomingFillerNode.gain.gain
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(0, now + xfadeSecs)
}
```

### Cancel upstream timers when exiting a mode

If mode-exit logic must cancel a downstream completion timer, also cancel the upstream trigger. In filler mode: `exitFillerMode` must cancel the `xfadeCompletionTimer` set by `enterFillerMode`, or it will fire late and re-enter the mode.

```typescript
exitFillerMode() {
  this._clearTimer('fillerLoop')
  this._clearTimer('fillerLoopCompletion')
  this._clearTimer('xfadeCompletion')  // cancel enterFillerMode's late-fire too
  // ...
}
```

### `_teardown` in `_reset`

Always include every tracked node field in `_reset()`:

```typescript
_reset() {
  this._teardown(this.currentNode)
  this._teardown(this.incomingNode)
  this._teardown(this._incomingFillerNode)  // don't forget phase-1 nodes
  this.currentNode = null
  this.incomingNode = null
  this._incomingFillerNode = null
}
```

## Anti-Patterns

- ❌ Starting a node as a local variable inside an async function, then only referencing it inside a `setTimeout` callback — the callback can be cancelled, the node lives on.
- ❌ Guarding `currentNode` assignment with `if (this.currentNode === oldNode)` — if anything changed `currentNode` during an async window, the guard silently fails and the new node is never promoted.
- ❌ Relying solely on gain ramp to silence an orphaned node — gain 0 does not stop the node; it still holds memory and can be un-silenced by future `cancelScheduledValues`.
