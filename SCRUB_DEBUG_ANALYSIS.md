# Scrubbing Snap-Back Bug Analysis

## Summary
Added comprehensive diagnostic logging to track down intermittent bug where scrubbing to end of track causes playhead to snap back to beginning after finger release.

## Root Cause Analysis

### Critical Race Condition Identified: _completeXfade()

**The Bug:**
When \_completeXfade()\ fires, it sets:
\\\	ypescript
this.currentStartCtxTime = this.incomingStartCtxTime
\\\

This **resets the elapsed position to 0** because \incomingStartCtxTime\ is set to \ctx.currentTime\ when the crossfade begins.

**The Race Condition Timeline:**
1. User scrubs near end of track (e.g., 3:55 of 4:00 track)
2. Scrubbing triggers \_scheduleXfade()\ with very short delay (~50ms due to proximity to fadeStartTime)
3. User releases finger → \esumePlayback()\ called
4. **Crossfade timer fires immediately** → \_beginXfade()\ starts
   - Sets \incomingStartCtxTime = ctx.currentTime\ (NOW, e.g., 100.5)
   - Starts 6-second crossfade to next track
5. 6 seconds later → \_completeXfade()\ fires
   - Sets \currentStartCtxTime = incomingStartCtxTime\ (100.5)
   - Current position now = \ctx.currentTime - currentStartCtxTime\
   - If \ctx.currentTime\ is 106.5, position = 106.5 - 100.5 = **6 seconds** (should be 0 for new track, but track index changed!)
   - **Actually resets to beginning of NEXT track** when it completes

**Why it explains the symptoms:**
- ✅ Intermittent: timing-dependent (must scrub close enough to end to trigger immediate crossfade)
- ✅ More common on touch: touch event timing less precise than mouse
- ✅ Happens when scrubbing right/near end: closer to fadeStartTime = shorter delay

**Current Mitigation:**
The code already has \FIX #2\ in \_scheduleXfade()\:
\\\	ypescript
if (elapsed >= fadeStartTime - 0.05) {
  // Don't schedule if already past fade-start time
  return
}
\\\

This should prevent scheduling crossfades when scrubbing near the end. However, there may be a race where:
- Scrubbing moves position to 3:55
- Timer gets scheduled (3:55 < fadeStart 3:54)
- User scrubs to 3:56 (past fadeStart)
- User releases → timer still pending and fires

**Potential Fix:**
When scrubbing ends with \esumePlayback()\, we should cancel any very-short-delay crossfade timers to prevent them from firing after the user has moved away from the fade zone.

## Diagnostic Logging Added

All logs use \[SCRUB-DEBUG]\ prefix for easy filtering.

### PlaybackScreen.tsx

**1. handleProgressBarTouchEnd (line ~700):**
- Logs state before/after \esumePlayback()\
- Shows: elapsed, duration, crossfading status, trainingPaused

**2. handleMouseUp (line ~738):**
- Same logging as touch end
- Shows state before/after \esumePlayback()\

**3. RAF Loop (line ~298):**
- Detects unexpected position jumps
- Logs if position jumps backward > 0.1s or forward > 1.0s
- Only when NOT scrubbing and NOT paused
- Shows: lastElapsed, currentElapsed, deltaElapsed, duration, crossfading

### AudioEngine.ts

**1. seek() (line ~349):**
- Logs requested vs clamped position
- Shows: fadeStartTime, maxSeekTime, crossfading status
- Logs new currentStartCtxTime after seek
- Logs state before/after seek

**2. resumePlayback() (line ~339):**
- Logs elapsed before/after resume
- Shows: ctx state, media paused status

**3. _scheduleXfade() (line ~679):**
- Logs when crossfade is scheduled
- Shows: delay, elapsed, fadeStartTime, currentIndex
- **Logs when scheduling is SKIPPED** (already past fade start)

**4. _beginXfade() (line ~699):**
- **Logs when crossfade timer FIRES** (critical event)
- Shows: currentIndex, fadeOutAfterThis, currentTime, elapsed
- Logs when starting crossfade with incomingStartCtxTime

**5. _completeXfade() (line ~788):**
- **Logs when crossfade completion timer FIRES** (critical event)
- Shows: currentStartCtxTime before/after update
- Shows: new elapsed position after completion
- **This is where position resets happen**

## How to Diagnose with Logs

When the bug occurs, look for this sequence:

1. \[SCRUB-DEBUG] seek()\ - user scrubbing near end
2. \[SCRUB-DEBUG] _scheduleXfade() scheduled\ - very short delay (< 1 second)
3. \[SCRUB-DEBUG] TouchEnd: resuming playback\ - user releases finger
4. \[SCRUB-DEBUG] _beginXfade() FIRED\ - crossfade starts (BAD - should have been cancelled)
5. 6 seconds later: \[SCRUB-DEBUG] _completeXfade() FIRED\ - position resets
6. \[SCRUB-DEBUG] RAF: UNEXPECTED POSITION JUMP!\ - detected in next frame

## Expected Normal Behavior

**Scrubbing NOT near end:**
1. seek() → position updated
2. _scheduleXfade() → scheduled with long delay (> 10 seconds)
3. TouchEnd → resumePlayback()
4. No crossfade fires until natural track end

**Scrubbing past fade start:**
1. seek() → position clamped to fadeStartTime - 0.1
2. _scheduleXfade() → **SKIPPED** (already past fade start)
3. TouchEnd → resumePlayback()
4. No crossfade scheduled

## Next Steps

1. **Test and capture logs** when bug occurs
2. **Verify hypothesis:** Check if \_beginXfade()\ fires shortly after \esumePlayback()\
3. **If confirmed:** Add fix to cancel very-short-delay crossfade timers in \esumePlayback()\
   - Clear xfadeTimer if scheduled delay was < 1 second
   - Or: Add "no-crossfade" guard period after seek
