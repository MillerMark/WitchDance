# Filler Mode Progress Bar State Sync Fix

## Problem
The progress bar wasn't updating when entering filler mode. User would enter filler mode at offset 136.51s (2:16), but the UI continued showing the playlist position (211.62s / 3:31).

## Root Cause
The RAF loop was checking **React state** `isFillerMode` instead of polling the engine directly:

```typescript
// Old buggy code:
if (isFillerMode) {  // React state lags behind engine!
  const fs = engine.getFillerState()
  // update UI...
}
```

The issue was timing:
1. User clicks "Enter Filler Mode" button
2. Engine calls `enterFillerMode()` and starts crossfade
3. After 6-second crossfade, engine sets `this._inFillerMode = true`
4. Engine fires `onFillerModeStarted` callback → sets React state `isFillerMode = true`
5. **BUT** React state updates are asynchronous and batched
6. RAF loop continues reading stale React state, so it keeps showing playlist position

## Solution
Changed RAF loop to **poll engine state directly** instead of relying on React state:

```typescript
// Fixed code:
const engineInFillerMode = engine.isInFillerMode()

// Sync React state if out of sync
if (engineInFillerMode !== isFillerMode) {
  console.log(`[RAF] Syncing isFillerMode: React=${isFillerMode} -> Engine=${engineInFillerMode}`)
  setIsFillerMode(engineInFillerMode)
}

if (engineInFillerMode) {  // Poll engine directly!
  const fs = engine.getFillerState()
  // update UI with filler state
}
```

## Changes Made

### PlaybackScreen.tsx (RAF loop)
**Lines 357-380:** Changed from checking `isFillerMode` (React state) to `engineInFillerMode` (polled from engine)
- Added state sync check to log when React state lags
- Now immediately reflects engine state in UI

**Lines 476-494:** Same fix for particle canvas rendering
- Uses `engineInFillerMode` variable instead of React state

### AudioEngine.ts (debug logging)
**Line 587:** Added debug log when setting `_inFillerMode` and firing callback
```typescript
console.log(`[AE] _inFillerMode=${this._inFillerMode}, calling onFillerModeStarted callback`)
```

## Testing
When user enters filler mode, watch console for:
```
[AE] [timestamp] enterFillerMode fillerOffset=136.51 resumeNext=1
[AE] [timestamp] _makeNode() gainStart=0 usingFallback=false gen=2
[AE] [timestamp+6s] enterFillerMode complete offset=136.51
[AE] _inFillerMode=true, calling onFillerModeStarted callback
[RAF] Syncing isFillerMode: React=false -> Engine=true
```

Progress bar should now:
1. **Immediately** jump to filler position (2:16) when crossfade completes
2. Count up from filler offset (not playlist elapsed time)
3. Show remaining filler duration

## Verification Checklist
- [ ] Progress bar updates immediately when entering filler mode
- [ ] Elapsed time shows filler offset, not playlist time
- [ ] Duration shows filler remaining time (negative countdown)
- [ ] No lag between engine state change and UI update
- [ ] Console shows state sync log when entering filler mode

## Deployed
Version: 1.0.198
Deployed: 2025-01-XX
URL: https://millermark.github.io/WitchDance/
