# Decision 003: Product Flow & Feature Scope (v1)

**Date:** 2026-05-23
**Author:** Coordinator (captured from product owner)

## Confirmed Feature Set

### Two-step music selection flow
The app separates **importing** from **playlist building**:
1. **Library** — user imports audio files from their device. All imported files are held in a library for the session. Users can import more at any time.
2. **Playlist** — from the library, user selects which songs to add to the active playlist and arranges them into a play order.

This means Screen 1 is a Library view (import + select), not a pure one-shot file picker.

### Playlist ordering
- User drags tracks up or down to reorder using finger touch
- Must work with iOS touch events (HTML5 drag API does not fire on iOS — must use pointer/touch events)

### Playback: two stop modes

**Fade Out (graceful stop):**
- User taps "Fade Out" during playback
- Current song fades out to silence at its natural end
- The next song starts from silence and fades in... then stops
- i.e., the loop ends cleanly after one final full fade — it does not continue

**Stop with restart selector:**
- User can stop and choose which song to restart from
- When restarting, playback begins from the start of the selected song and fades in from silence

### Deferred (not in v1)
- Pause / Resume
- Scrubbing / seeking within a track
- Persistent library across sessions (library resets on page reload is acceptable for v1)

## Revised Screen Map

| Screen | Name | Purpose |
|--------|------|---------|
| 1 | Library | Import audio files; view all imported songs; select songs to add to playlist |
| 2 | Playlist | View and reorder selected songs; set play order via touch drag; launch playback |
| 3 | Playback | Loop playback with crossfade; Fade Out button; Stop with restart-from selector |

## Key Behavioral Rules

- Crossfade duration: ~3 seconds (gain ramp using Web Audio API `linearRampToValueAtTime` or `exponentialRampToValueAtTime`)
- Normal loop: last song fades into first song seamlessly
- Fade Out mode: current song completes, fades to silence; next song fades in from silence; loop stops after that song ends (or after the fade-in completes — TBD with Ione Vale)
- Restart: always starts from the beginning of the selected track, fading in from silence
- The loop runs indefinitely until Fade Out or Stop is triggered

## Open Questions
- **Fade Out exact behavior**: Does the loop stop after the current song fades out, or does it play one more full song (the next one) and then stop? → Leaning toward: current song finishes its fade-out, next song fades in and plays to completion, then stops.
- **Library persistence**: v1 accepts that the library clears on page reload. Confirm before adding localStorage persistence.
