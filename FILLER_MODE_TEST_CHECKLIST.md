# Filler Mode Persistence - Test Checklist

## Manual Testing Steps

### Test 1: Resume Filler After Refresh ✅
1. Start the app and begin playback
2. Wait for filler mode to trigger (auto-fill) or manually trigger it
3. Wait for filler to start playing (watch the progress bar)
4. Note the current filler offset (e.g., "45s")
5. **Refresh the page (F5 or Ctrl+R)**
6. ✅ **Expected:** Filler resumes playing from saved offset (~45s)
7. ✅ **Expected:** Progress bar shows correct position
8. ✅ **Expected:** "Next Up" shows correct playlist track to resume to

### Test 2: Normal Playlist Resume Still Works ✅
1. Start playback on a playlist track (NOT in filler mode)
2. Let it play for ~30 seconds
3. **Refresh the page**
4. ✅ **Expected:** Playlist track resumes from saved position
5. ✅ **Expected:** NOT in filler mode
6. ✅ **Expected:** Normal playback continues

### Test 3: Exit Filler Then Refresh ✅
1. Enter filler mode (auto or manual)
2. Wait for filler to start playing
3. Click "Exit Fill" button
4. ✅ **Expected:** Returns to playlist playback
5. **Refresh the page**
6. ✅ **Expected:** Does NOT resume filler
7. ✅ **Expected:** Resumes normal playlist playback

### Test 4: Stop Performance While in Filler ✅
1. Enter filler mode
2. Wait for filler to be actively playing
3. Click "Stop Performance" button
4. ✅ **Expected:** Returns to playlist screen
5. **Refresh the page**
6. ✅ **Expected:** Does NOT auto-resume anything
7. ✅ **Expected:** Shows playlist screen

### Test 5: Filler Offset Continuity ✅
1. Enter filler mode
2. Note the filler offset when it starts (e.g., 45s)
3. Wait for 30+ seconds (offset should be ~75s now)
4. **Refresh immediately**
5. ✅ **Expected:** Resumes near 75s (saved every 2 seconds)
6. ✅ **Expected:** NO audible skip or jump
7. ✅ **Expected:** Seamless continuation

### Test 6: Auto-Fill Disabled ✅
1. Disable auto-fill in settings
2. Enter filler mode manually (if available)
3. Refresh page
4. ✅ **Expected:** Filler still resumes (persistence independent of auto-fill setting)

### Test 7: No Filler Track Set ✅
1. Remove/unset the filler track
2. Enter any playback state
3. Refresh page
4. ✅ **Expected:** Normal playback resume (no crash)
5. ✅ **Expected:** No attempt to enter filler mode

### Test 8: Filler Completes Naturally ✅
1. Enter filler mode near the end of the filler track
2. Wait for filler to complete
3. ✅ **Expected:** Automatically exits to correct playlist track
4. **Refresh page**
5. ✅ **Expected:** Resumes from playlist (not filler)

## Browser Console Checks

Look for these log messages:

### On Page Load (when restoring filler):
```
[PlaybackScreen] Restoring filler mode: { savedFillerOffset: 45.2, savedResumeIndex: 3 }
[AE] enterFillerMode fillerOffset=45.20 resumeNext=3
[AE] enterFillerMode complete offset=45.20
[AE] _inFillerMode=true, calling onFillerModeStarted callback
```

### When entering filler mode:
```
[AE] enterFillerMode fillerOffset=0.00 resumeNext=5
[AE] _inFillerMode=true, calling onFillerModeStarted callback
```

### When exiting filler mode:
```
[AE] exitFillerMode at fillerOffset=120.45 resumeNext=5
[AE] exitFillerMode complete idx=5
```

## localStorage Verification

Open DevTools → Application → Local Storage → Check these keys:

### When in filler mode:
- `wd_filler_mode_active` = `"1"`
- `wd_filler_resume_index` = (number, e.g., `"3"`)
- `wd_filler_offset` = (number, e.g., `"45.2"`)

### When NOT in filler mode:
- `wd_filler_mode_active` = `"0"` or absent

## Edge Cases

### Edge Case 1: Rapid Refresh
1. Enter filler mode
2. Immediately refresh (< 2 seconds)
3. ✅ **Expected:** Resumes from last saved offset (may be 0 or previous)

### Edge Case 2: Multiple Tabs
1. Open app in two tabs
2. Enter filler in Tab 1
3. Refresh Tab 2
4. ⚠️ **Note:** Both tabs share localStorage - behavior may vary

### Edge Case 3: Very Long Filler
1. Use a 30+ minute filler track
2. Enter filler mode at offset 15:00
3. Refresh at 20:00
4. ✅ **Expected:** Resumes at ~20:00

## Performance Checks

- ✅ No memory leaks (check DevTools Memory tab)
- ✅ Smooth playback after refresh (no stuttering)
- ✅ RAF loop continues normally
- ✅ Progress bar updates smoothly

## Regression Tests

- ✅ Auto-fill still works correctly
- ✅ Manual filler trigger still works
- ✅ Exit fill button still works
- ✅ Scrubbing still works in filler mode
- ✅ Training mode still works
- ✅ Playlist navigation still works

## Success Criteria

All tests pass with:
- No console errors
- No TypeScript errors
- No runtime exceptions
- Smooth user experience
- Correct state restoration
