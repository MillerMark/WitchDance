# WitchDance Tasks

## 🔴 High Priority

- [ ] Fix progress bar scrubbing reliability (~5% success rate)
  Progress bar scrubbing only works ~1/20 attempts. Touches show control buttons
  instead of scrubbing. Once it works, it's 100% reliable until song changes.
  Suggests state initialization issue or touch event capture problem.
  File: src/screens/PlaybackScreen.tsx, handleScreenTouchStart (line 774)

- [ ] Fix pause/play button requiring multiple clicks to resume
  Pause button works on first click, but resume requires avg 1.7-2.5 clicks.
  Suggests touch event not reaching button handler consistently.
  File: src/screens/PlaybackScreen.tsx, pause/play button handlers

## 🟡 Mid Priority

- [ ] Clamp scrub position to fade-out time
  User can scrub beyond the fade-out time. Should clamp to max valid position.
  File: src/screens/PlaybackScreen.tsx, handleProgressBarInteraction (line 617)

- [ ] Fix silent audio after scrubbing to end and crossfading
  When scrubbing far right and triggering crossfade, next song has no audio.
  Suggests audio state not being updated during scrubbing seek operations.
  Files: src/screens/PlaybackScreen.tsx, src/audio/AudioEngine.ts

## 🟢 Low Priority

- [ ] Update pause/play button state during scrubbing
  Button should show "pause" state when scrubbing starts (since audio resumes)

- [ ] Extend progress bar touch area to far left edge
  Touch target doesn't extend to visual left edge of progress bar

- [ ] Allow particles to render above title without cropping
  Particle canvas height needs extension without affecting layout
