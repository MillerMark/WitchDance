# Decision 002: Interaction Design Specification

**Date:** 2026-05-23
**Author:** Lyra Morn

---

## Overview

WitchDance has three screens, navigated linearly during a session:

1. **Library** — User imports local audio files from their device. The library accumulates all imported tracks for the session; importing again adds more without replacing. User selects which tracks to add to the playlist.
2. **Playlist** — User arranges the selected tracks into a play order via touch drag, then launches playback.
3. **Playback** — The running loop. Shows what is playing, what is next, and a crossfade indicator. Two stop modes: **Fade Out** (graceful — current song fades out, next song fades in and plays to completion, then the loop ends) and **Stop** (immediate, with an in-screen restart-from selector).

Navigation moves forward through these screens. Stop on Screen 3 shows an inline restart selector; the user can restart from any track or navigate back to Screen 2 (Playlist, with their order preserved). Fade Out ends the loop automatically after the final song completes, then returns the user to Screen 2. There is no account, no settings screen, no onboarding flow.

The three-tap path to music: **tap "＋ Import" → (select files in OS sheet) → tap tracks to select → tap "Add to Playlist →" → tap "▶ Play Loop"**. Each step is one intentional gesture. Pause and seek are deferred to v2.

---

## Design Language

### Color Palette

Defined as CSS custom properties on `:root`. All colors are chosen for WCAG AA contrast against their expected backgrounds.

| Variable         | Value     | Usage                                                                 |
|------------------|-----------|-----------------------------------------------------------------------|
| `--bg`           | `#0b0f1a` | Page/app background. Deep navy-black.                                 |
| `--surface`      | `#161d2e` | Card and list item backgrounds. Slightly lighter than `--bg`.         |
| `--surface-hi`   | `#1f2840` | Elevated surfaces: active list items, focused states, modals.         |
| `--accent`       | `#8b5cf6` | Primary interactive elements: CTAs, progress fill, the crossfade glow. Violet, fitting the WitchDance name. |
| `--accent-dim`   | `rgba(139, 92, 246, 0.18)` | Accent wash for backgrounds, selected state rows, the crossfade badge fill. |
| `--text`         | `#e8eaed` | Primary text. Near-white.                                             |
| `--text-muted`   | `#6b7a99` | Secondary text, labels, track numbers, "next up" label.               |
| `--destructive`  | `#ef4444` | Remove/delete actions only.                                           |
| `--border`       | `#1e2842` | Subtle dividers, card outlines.                                       |

> **Note to Ione Vale:** `--surface-hi` and `--accent-dim` are additions beyond the brief's five variables. They are needed for the crossfade state and selected-row treatments. Define them alongside the others in `index.css`.

### Typography

System font stack only — no web fonts. Matches iOS San Francisco automatically on Safari.

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

| Scale token    | Size | Weight | Line-height | Usage                                          |
|----------------|------|--------|-------------|------------------------------------------------|
| `--text-display` | 24px | 700    | 1.2         | Current track title on Playback screen         |
| `--text-title`   | 18px | 600    | 1.3         | Screen headings, track names in Builder        |
| `--text-body`    | 16px | 400    | 1.5         | File names in Picker, body copy                |
| `--text-label`   | 13px | 500    | 1.4         | "NEXT UP", "∞ LOOPING", "CROSSFADE" badges — always uppercase, tracked +0.06em |
| `--text-micro`   | 11px | 400    | 1.4         | File count, duration, helper footnotes         |

All text is `--text` by default. Secondary text explicitly uses `--text-muted`.

Filename-to-title display rule (apply in JS before rendering, not in CSS): strip file extension, replace `_` and `-` with spaces, apply title-case. Example: `witch_dance_loop_01.mp3` → `Witch Dance Loop 01`.

### Spacing System

Base unit: `4px`. All spacing is a multiple of this unit.

| Token   | Value | Common use                               |
|---------|-------|------------------------------------------|
| `--s1`  | 4px   | Icon-to-label gap, micro padding         |
| `--s2`  | 8px   | Compact row padding, badge padding       |
| `--s3`  | 12px  | List item inner padding                  |
| `--s4`  | 16px  | Standard horizontal page margin          |
| `--s5`  | 20px  | Section gap                              |
| `--s6`  | 24px  | Card padding, major section spacing      |
| `--s8`  | 32px  | Between major layout blocks              |
| `--s12` | 48px  | Bottom safe-area pad, large spacers      |

Horizontal page margin: `--s4` (16px) on both sides, giving a 358px content column on a 390px viewport.

### Corner Radius

| Element              | Radius  |
|----------------------|---------|
| Cards / list items   | 12px    |
| Buttons (full-width) | 14px    |
| Pill badges          | 999px   |
| Progress bar track   | 999px   |
| Input touch areas    | 8px     |

### Elevation

No drop shadows. Elevation is communicated through background color steps: `--bg` → `--surface` → `--surface-hi`. This keeps the aesthetic flat and legible in dark conditions.

### Motion Principles

- **Standard transition:** `200ms ease-out` — state changes, hover, focus
- **Screen navigation:** `300ms ease-in-out` horizontal slide. Screen 1→2: slide left. Screen 3→2 (stop): slide right.
- **Crossfade indicator:** `opacity` and `transform` at `600ms ease-in-out`, matching the visual ramp to the audio fade
- **Progress bar fill:** `transition: none` — update every animation frame via `requestAnimationFrame`, no CSS transition on the width/value to avoid lag artifacts
- **No decorative animations.** Every motion serves a state-change purpose.
- **Respect `prefers-reduced-motion`.** All transitions fall back to instant (`transition: none`) when the OS setting is enabled.

---

## Screen 1: Library

### Purpose

The user imports audio files into a persistent library and selects which ones to add to the active playlist. This screen has two distinct jobs:

1. **Import** — trigger the OS file picker to add audio files; the library accumulates across multiple import sessions within the same page session.
2. **Select** — tap tracks to mark them for the playlist; selected tracks are included when navigating to Screen 2.

The Library is not a one-shot picker — it persists for the duration of the session. Users can return here (via back navigation from Screen 2) and import more files or change their selection at any time.

### Layout

```
┌────────────────────────────────────────┐
│  [safe area top]                       │
│                                        │
│  WitchDance              ＋ Import     │
│  (--text-display, --accent)  (btn)     │
│                                        │
│  ─────────────────────────────────     │  <- 1px --border divider
│                                        │
│  [EMPTY STATE: centered vertically]    │
│  ┌──────────────────────────────────┐  │
│  │                                  │  │
│  │   ♪  (48px icon, --text-muted)   │  │
│  │                                  │  │
│  │  No audio files yet              │  │
│  │  (--text, --text-title)          │  │
│  │                                  │  │
│  │  Tap Import to add files         │  │
│  │  (--text-muted, --text-body)     │  │
│  └──────────────────────────────────┘  │
│                                        │
│  OR [LIBRARY LIST — scrollable]        │
│  ┌──────────────────────────────────┐  │
│  │ ☑  Witch Dance Loop 01           │  │  <- selected (accent highlight)
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │ ☐  Midnight Ritual               │  │  <- not selected
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │ ☑  Dark Forest Ambience          │  │  <- selected
│  └──────────────────────────────────┘  │
│                                        │
│  [sticky bottom]                       │
│  ┌──────────────────────────────────┐  │
│  │   Add to Playlist (2) →          │  │  <- enabled when ≥1 selected
│  └──────────────────────────────────┘  │
│  [safe area bottom]                    │
└────────────────────────────────────────┘
```

The header zone (wordmark + Import button + divider) is fixed at the top. The library list or empty state fills the scrollable middle. The CTA is sticky at the bottom, above the safe area inset.

### Components

#### App Wordmark
- Text: "WitchDance" in `--text-display` (24px / 700), color `--accent`
- Position: left-aligned in header row, 20px below safe area top inset
- Not a button. No tap behavior.

#### Import Button
- Position: right side of the header row, vertically centered with the wordmark
- Label: "＋ Import" — `--text-label` (13px / 500), `--text`
- Appearance: pill-shaped button, `--surface` background, `1px solid --border` border, 8px radius, 10px vertical × 16px horizontal padding
- Touch target: minimum 44×44pt — expand hit area vertically above and below the visible button
- On tap: opens the OS file picker with `accept="audio/*"` and `multiple` attribute
- **Can be tapped at any time**, even when the library already contains files. Each import appends new files to the library list; exact duplicates (same filename) are silently deduplicated.
- During file loading: button label changes to "Loading…", shows a spinner, and is disabled (`pointer-events: none`, `opacity: 0.6`)

#### Empty State Block
- Visible only when the library has zero imported tracks
- Music note icon (Unicode ♪ or SVG): 48×48px, `--text-muted`
- Heading: "No audio files yet" — `--text-title`, `--text`
- Subtext: "Tap Import to add files" — `--text-body`, `--text-muted`
- No border, no card background — sits directly on `--bg`
- Vertically centered between header and the bottom safe area

#### Library Track Row
- One row per imported track, in import order (most recent appended at the bottom)
- Row height: 60px, 12px radius, `--s4` (16px) horizontal padding, 8px vertical gap between rows
- **Unselected:** `--surface` background
- **Selected:** `--surface-hi` background plus a 3px left-edge accent bar (`--accent` color, 60% of row height, 6px radius) to signal "in playlist"

From left to right:
1. **Selection circle**: 24×24px. Unselected: empty circle, `--border` stroke. Selected: filled `--accent` circle with a white checkmark inside.
2. **Track title**: filename-derived (strip extension, replace `_` and `-` with spaces, title-case), `--text-body`, `--text`. Single line, truncated with ellipsis. 12px gap from the selection circle.
3. **Format badge** (optional, right-aligned): pill, `--text-micro`, `--text-muted` — shows "MP3", "AAC", etc. when detectable. 8px from right edge.

**Tap behavior:** Tap anywhere on the row toggles selection. Selected = track will be included in the playlist when navigating to Screen 2. Unselected = track remains in the library but is excluded from the current playlist.

Tracks cannot be individually removed from the library in v1 — the library clears on page reload. No × or delete affordance on these rows.

#### "Add to Playlist →" CTA Button
- Sticky at the bottom, 16px above the safe area bottom inset
- Full-width, 56px tall, 14px radius
- **Enabled (≥1 track selected):** Background `--accent`, text `--bg`, label: "Add to Playlist (N) →" where N = selected count. `--text-title` weight.
- **Disabled (0 tracks selected):** Background `--surface`, text `--text-muted`, label: "Select tracks above", `opacity: 0.6`, `pointer-events: none`
- Touch target: 56px height exceeds the 44pt minimum

### States

#### Empty state (no tracks imported)
- Empty state block centered in screen
- Import button in header: enabled
- CTA: disabled "Select tracks above" state

#### Library populated, none selected
- Track list shown; all rows unselected style
- CTA: disabled "Select tracks above"
- Import button remains active to add more files

#### Library populated, some selected
- Track list shows mixed selected/unselected rows
- CTA: enabled "Add to Playlist (N) →" with count of selected tracks
- Import button remains active

#### Library populated, all selected
- All rows in selected style
- CTA: "Add to Playlist (N) →" with full track count
- Import button remains active

#### Loading / processing state
- After dismissing the OS file picker, before the list updates: Import button shows spinner + "Loading…" label, disabled
- Should be brief (< 500ms for typical files) but must block double-taps
- If a file fails to load: inline toast slides up above the CTA area — "⚠ [Title] couldn't be loaded — try another file." Auto-dismisses after 4 seconds. Background `--surface-hi`, text `--text`, icon `--destructive`.

### Copy Guidance

| Location | Copy |
|---|---|
| Empty state heading | "No audio files yet" |
| Empty state subtext | "Tap Import to add files" |
| Import button | "＋ Import" |
| Import button (loading) | "Loading…" |
| CTA (none selected) | "Select tracks above" |
| CTA (tracks selected) | "Add to Playlist (N) →" |
| File load error toast | "⚠ [Title] couldn't be loaded — try another file." |
| Unsupported format toast | "⚠ [Filename] doesn't look like an audio file." |

**Do not** use copy like "Upload" or "Stream" — these imply network transfer. "Import" is the correct verb for bringing local files into the app.

### Transition to Screen 2

**Trigger:** Tap "Add to Playlist (N) →" (≥1 track selected, not in loading state).

**Data passed:** The ordered array of selected tracks in the order they appear in the library list (not selection order). Screen 2 (Playlist) will allow reordering.

**Animation:** Horizontal slide-left. Screen 1 slides out to the left while Screen 2 slides in from the right. Duration: 300ms ease-in-out.

**Selection state is preserved** if the user navigates back from Screen 2 to Screen 1 — previous selections remain highlighted, and they can modify the selection before tapping the CTA again.

---

## Screen 2: Playlist

### Purpose

The user has selected tracks from the Library and needs to set their play order before starting the loop. This screen is a lightweight drag-to-reorder list. It should not feel like a heavy "playlist editor" — it is a quick arrangement step. The primary action (Play Loop) should be the most prominent element on the screen.

### Layout

```
┌────────────────────────────────────────┐
│  [safe area top]                       │
│                                        │
│  ← Library     Your Playlist          │
│  (back)        (center heading)        │
│                                        │
│  ─────────────────────────────────     │
│                                        │
│  [Track list — scrollable]             │
│  ┌──────────────────────────────────┐  │
│  │ ≡  1  Witch Dance Loop 01    🗑  │  │  <- drag handle, number, title, delete
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │ ≡  2  Midnight Ritual         🗑  │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │ ≡  3  Dark Forest Ambience    🗑  │  │
│  └──────────────────────────────────┘  │
│                                        │
│  [Loop note, appears below list]       │
│  After track 3, loops back to track 1  │
│                                        │
│  [sticky bottom]                       │
│  ┌──────────────────────────────────┐  │
│  │     ▶  Play Loop                 │  │
│  └──────────────────────────────────┘  │
│  [safe area bottom]                    │
└────────────────────────────────────────┘
```

### Components

#### Navigation Header
- Back button: "← Library" — left-aligned, `--text-label`, `--text-muted`, 44×44pt touch target
  - On tap: navigate back to Screen 1 (slide right). The library and all selections are preserved on Screen 1 — no data loss on back navigation.
- Screen title: "Your Playlist" — centered, `--text-title` (18px / 600), `--text`
- No right-side element in the header

#### Track List Item
Each track is a card: 64px tall, `--surface` background, 12px radius, 16px horizontal padding, 8px vertical gap between cards.

From left to right:
1. **Drag handle** (≡ three-line icon): 20×20px icon, `--text-muted`. Tap-and-hold (300ms) activates drag mode. The entire row lifts to `--surface-hi` background with a subtle `scale(1.02)` transform during drag.
2. **Track number**: "1", "2", etc. — `--text-label`, `--text-muted` — 24px wide, right-aligned within its column
3. **Track title**: filename-derived title, `--text-body`, `--text`, truncated to one line with ellipsis, fills remaining width
4. **Delete button**: trash icon 20×20px, `--text-muted` default. Touch target is 44×44pt expanded inward from the right edge. On tap: immediate removal with a `200ms` `opacity` + `height` collapse animation. No confirmation dialog — the user can re-add from Screen 1 if needed.

**Drag-to-reorder:**
- Platform: use the HTML5 Drag and Drop API as a base; supplement with pointer events for iOS touch support (iOS Safari does not support HTML5 drag events on touch). Implementation note for Ione Vale: this needs pointer-event-based drag. See Open Questions.
- While dragging: the dragged card has `box-shadow: 0 8px 24px rgba(0,0,0,0.5)` and `scale(1.02)`. Other cards animate to make room (`transform: translateY` over 150ms).
- Drop: card snaps into new position, track numbers update, loop-wrap note updates.

#### Loop-wrap Note
- Appears below the track list, above the sticky CTA area
- Text: "After track N, loops back to track 1" — `--text-micro`, `--text-muted`, centered
- Updates live as tracks are added, removed, or reordered
- Special case for 1 track: "This track will loop on its own"
- The "∞" symbol may be used here but keep the text — icon alone is insufficient for clarity

#### Play Loop CTA
- Full-width, 56px tall, 14px radius, `--accent` background, `--bg` text
- Label: "▶  Play Loop" — `--text-title` weight
- Enabled whenever there is ≥1 track in the list
- On tap: navigate to Screen 3 (slide left), audio engine begins immediately (see Open Questions re: iOS AudioContext)

### States

#### Empty (0 tracks — edge case)
Should not occur in normal flow (user must have ≥1 track selected in Library to reach this screen). However, if a user removes all tracks from the list on this screen, show:
- Empty track area with a centered message: "No tracks yet" (`--text-muted`)
- "← Library" text link below the message, navigating back to Screen 1
- "Play Loop" button: disabled, `opacity: 0.4`, `pointer-events: none`

#### 1 track (valid, single-track loop)
- Normal list display with one card
- Loop-wrap note: "This track will loop on its own"
- Play Loop button: enabled — single-track looping is supported and intentional

#### 2–5 tracks (recommended / normal case)
- Normal list display
- Loop-wrap note: "After track N, loops back to track 1"
- All interactions (drag, remove) enabled

#### 6 or more tracks
- All tracks are shown and are playable — no hard cap
- A warning note appears above the Play Loop button (below the loop-wrap note): "⚠ Best with 5 or fewer tracks for smooth crossfades" — `--text-micro`, `--text-muted`, centered
- The user is not blocked from proceeding — this is informational only

### Copy Guidance

| Location | Copy |
|---|---|
| Screen title | "Your Playlist" |
| Back button | "← Library" |
| Loop-wrap note (≥2 tracks) | "After track N, loops back to track 1" |
| Loop-wrap note (1 track) | "This track will loop on its own" |
| Play Loop CTA | "▶  Play Loop" |
| Empty state message | "No tracks yet" |
| Empty state link | "← Library" |
| Too-many-tracks warning | "⚠ Best with 5 or fewer tracks for smooth crossfades" |

### Transition to Screen 3

**Trigger:** Tap "▶ Play Loop" (≥1 track in list, button enabled).

**Animation:** Horizontal slide-left. Screen 2 slides out to the left, Screen 3 slides in from the right. 300ms ease-in-out.

**Audio start:** The audio engine should begin playback within this transition — the first track's `AudioContext.resume()` and buffer play are triggered by the same tap event that fires the navigation. By the time Screen 3 is fully visible, audio should be audible. See Open Questions.

---

## Screen 3: Playback

### Purpose

The user is listening to their loop. This is the primary "in use" state of the app. The screen has one job: tell the user what is happening and stay out of the way. It must communicate:

- What is playing right now (track name, large)
- What is coming next (track name, smaller)
- Progress through the current track
- That the sequence is looping
- When a crossfade is actively in progress

Two stop controls are always available:
- **Fade Out** — graceful exit: current song fades out, next song fades in and plays to completion, then the loop ends automatically.
- **Stop** — immediate exit: audio halts instantly; screen enters a restart-from selector state.

### Layout

```
┌────────────────────────────────────────┐
│  [safe area top — no navigation bar]   │
│                                        │
│                                        │
│                                        │
│  [upper third — current track zone]    │
│                                        │
│      NOW PLAYING                       │  <- --text-label, --text-muted, uppercase
│                                        │
│      Witch Dance Loop 01               │  <- --text-display (24px/700), --text
│                                        │
│      [progress bar]                    │  <- 4px tall, full content width
│      ████████████░░░░░░░░░░░░░         │     --accent fill, --surface track
│                                        │
│      0:47  ────────────  2:15          │  <- elapsed / duration, --text-micro, muted
│                                        │
│  ─────────────────────────────────     │  <- --border divider
│                                        │
│  [middle — next up zone]               │
│                                        │
│      NEXT UP                           │  <- --text-label, --text-muted
│                                        │
│      Midnight Ritual                   │  <- --text-title (18px/600), --text-muted
│                                        │
│  ─────────────────────────────────     │
│                                        │
│  [lower middle — status zone]          │
│                                        │
│         ∞  LOOPING                     │  <- always-visible loop badge
│                                        │
│  [crossfade indicator — hidden         │
│   normally, appears during crossfade]  │
│                                        │
│         ↝  CROSSFADE                   │  <- crossfade badge
│                                        │
│                                        │
│  [sticky bottom]                       │
│  ┌──────────────────────────────────┐  │
│  │      ↓  Fade Out                 │  │  <- graceful stop (accent)
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │         ◼  Stop                  │  │  <- immediate stop (surface)
│  └──────────────────────────────────┘  │
│  [safe area bottom]                    │
└────────────────────────────────────────┘
```

No navigation header on this screen. The full vertical space is given to the playback display. The screen background is `--bg`. No cards — all text floats directly on the dark background.

All text blocks are horizontally centered. The layout is three zones: current track (upper), next up (middle), status/loop (lower), with two stop controls anchored at the bottom — Fade Out on top, Stop below.

### Components

#### "NOW PLAYING" Label
- Text: "NOW PLAYING" — `--text-label` (13px / 500 / tracked), `--text-muted`
- Position: centered, approximately 30% from the top of the safe content area
- During crossfade: this label fades out (opacity 0) over the first 300ms of the crossfade, then fades back in (opacity 1) over the last 300ms, while the track title below it transitions

#### Current Track Title
- The most prominent element on the screen
- `--text-display` (24px / 700), `--text`
- Centered, max 2 lines — wraps if long, ellipsis on overflow of 2 lines
- During crossfade: this title transitions (see "The crossfade moment" section)
- Horizontal padding: `--s6` (24px) each side to prevent very long names touching the edge

#### Progress Bar
- Position: below the track title, 20px gap
- Track (background): full content width (358px), 4px height, `--surface`, `border-radius: 999px`
- Fill: `--accent`, same height and radius, width updated each animation frame via `requestAnimationFrame`
- No scrubbing interaction — this is display only. Tapping the bar does nothing. (The complexity of seek + audio resync is not worth it for this use case.)
- During crossfade: the bar transitions — see "The crossfade moment"

#### Elapsed / Duration Display
- Two small values flanking the progress bar: elapsed time left-aligned, total duration right-aligned
- `--text-micro` (11px), `--text-muted`
- Format: `M:SS` — e.g., `0:47` and `2:15`
- During crossfade: these values crossfade in sync with the track title (new track's values fade in)

#### "NEXT UP" Label
- Text: "NEXT UP" — `--text-label`, `--text-muted`
- Appears below the progress bar zone, separated by the `--border` divider

#### Next Track Name
- `--text-title` (18px / 600), `--text-muted` (deliberately de-emphasized — this is future, not present)
- Centered, single line with ellipsis
- When the last track in the sequence is playing: next track name shows track 1 (the loop wraps), and a small "↩ loops to first" annotation appears below in `--text-micro`, `--text-muted`
- During crossfade: this name transitions — see "The crossfade moment"

#### Loop Indicator Badge
- Always visible on this screen
- A pill badge: `--accent-dim` background, `--accent` text and icon, `--text-label` size
- Content: "∞  LOOPING"
- Padding: 6px vertical, 12px horizontal
- This badge never disappears. Its constant presence is the primary communication that the loop runs indefinitely.

#### Crossfade Indicator Badge
- Normally hidden (`display: none` or `opacity: 0`)
- Becomes visible only during the ~3-second crossfade window
- Pill badge: same size as loop badge, but animated
- Content: "↝  CROSSFADE" — or use "⇌" symbol
- Background: `--accent-dim` with a slow pulse (`opacity` oscillating between 0.7 and 1.0 on a 1200ms `ease-in-out` loop while visible)
- Appears adjacent to the loop badge (below it, or to the right of it if horizontal space allows — below is safer for one-handed thumb zone)
- See "The crossfade moment" for full timing specification

#### Fade Out Button
- Sticky at the bottom, above the Stop button, 8px gap between them
- Full-width, 56px tall, 14px radius
- Background: `--accent`, text: `--bg` — this is the preferred graceful exit, given primary visual weight
- Label: "↓  Fade Out" — `--text-title` weight
- On tap: notifies the audio engine to begin fade-out mode; the button immediately enters its **active** state:
  - Label changes to "Ending after next song…" — `--text-title`, `--bg`
  - Button background dims slightly (`opacity: 0.75`) and becomes disabled (`pointer-events: none`)
  - A small animated ellipsis or pulsing dot appended to the label communicates ongoing process
- The Loop badge transitions: "∞  LOOPING" → "↓  ENDING SOON" — same pill style, same `--accent-dim` / `--accent` colors, updated label
- "NEXT UP" zone label changes to "FINAL SONG" (`--text-label`, `--text-muted`) to communicate which track is the last one
- When the final song finishes: audio engine ends the loop; UI navigates to Screen 2 (Playlist, slide right, 300ms) automatically. No user action required.

#### Stop Button
- Sticky at the bottom, 16px above the safe area bottom inset (below Fade Out button)
- Full-width, 56px tall, 14px radius
- Background: `--surface`, border: `1px solid --border` — secondary visual weight; not the preferred action
- Label: "◼  Stop" — `--text-title`, `--text`
- On tap: audio stops immediately; Screen 3 enters the **Stopped** state (see States below)
- Touch target: 56px height exceeds the 44pt minimum

#### Pause / Resume — *Deferred to v2*
- Pause is not included in the v1 primary layout.
- If implemented in a future version: a secondary icon button (not full-width) placed above the Fade Out button — 56×56pt circle, ⏸ icon, `--accent` color, centered. Resume uses ▶ icon. Pause does not navigate away from Screen 3.
- Do not design or reserve space for this control in v1.

### The Crossfade Moment

The crossfade is approximately 3 seconds. It begins when the audio engine starts ramping the gain of the outgoing track down and the incoming track up. The UI should reflect this transition without being alarming or distracting — it is ambient feedback.

**Timeline (t=0 is when crossfade begins, t≈3000ms is when it completes):**

```
t=0ms      Crossfade begins
           • Crossfade badge appears: fade in from opacity:0 to opacity:1 over 300ms
           • Crossfade badge pulse animation begins
           • Progress bar fill: smoothly resets to 0% (matching the incoming track's playback position)
           • Elapsed time: begins showing the new track's elapsed time

t=0→1500ms (first half — outgoing track fading out)
           • Current track title: opacity transitions from 1.0 to 0.2 (--text-muted feel)
           • "NOW PLAYING" label: opacity 1.0 → 0.0 over first 600ms, then 0.0 → 1.0 over last 600ms
           • Elapsed/duration: crossfade from old track values to new track values

t=1500ms   (midpoint)
           • Current track title has been outgoing, is now fully dim (opacity: 0.2)
           • Incoming track title fades in from below: the new title starts at opacity:0,
             translateY(+12px) and animates to opacity:1, translateY(0)
           • The old title simultaneously fades out and moves up: opacity:0.2→0, translateY(0→-8px)
           • These two title transitions overlap for about 400ms around the midpoint

t=1500→3000ms (second half — incoming track fading in)
           • New track title fully visible at opacity:1
           • Next-up zone: updates to show the new "next" track (the track after the incoming one)
           • This next-up update happens at t=1500ms with a simple opacity crossfade (200ms)

t≈3000ms   Crossfade complete
           • Crossfade badge: fade out from opacity:1 to opacity:0 over 300ms, then hidden
           • Pulse animation stops
           • All values settled on the new track
```

**What does NOT change during crossfade:**
- The Fade Out and Stop buttons — always available, no change
- The Loop indicator badge — always visible, no change (unless Fade Out has been triggered, in which case the badge is already in its "ENDING SOON" state)
- The overall screen layout — no position shifts, only the content within zones changes

**If the user taps Stop during a crossfade:** Stop works immediately. The audio engine should handle this cleanly. The UI enters the Stopped state without completing the animation.

**Implementation note for Ione Vale:** The UI crossfade animation needs to be triggered by a callback from the audio engine — specifically, the engine needs to emit an event (e.g., `onCrossfadeStart(incomingTrackIndex)`) at the moment `linearRampToValueAtTime` begins. See Open Questions.

### States

#### Playing Normally
- All components as described in layout
- Progress bar updates every animation frame
- Crossfade badge hidden
- Track title, next-up, and elapsed time are stable
- Fade Out button: enabled, "↓  Fade Out" label
- Stop button: enabled, "◼  Stop" label

#### Crossfade Active (transitioning)
- Full crossfade animation as described in "The crossfade moment" section
- Crossfade badge visible and pulsing
- Track title transitions between outgoing and incoming
- Progress bar resets to the incoming track's position (likely near 0%)
- Next-up updates at the midpoint of the crossfade
- Both stop buttons remain available

#### Fade Out Triggered
- Audio engine is in fade-out mode; playback continues normally until the loop ends
- Fade Out button: disabled, label "Ending after next song…" with pulsing dot, `opacity: 0.75`
- Loop badge: "↓  ENDING SOON"
- "NEXT UP" label: "FINAL SONG"
- Stop button remains available — tapping Stop cancels the fade-out and enters Stopped state immediately
- When the final track finishes: auto-navigate to Screen 2 (slide right, 300ms)

#### Stopped (immediate stop)
- Audio has halted; the screen does not navigate away automatically
- The NOW PLAYING zone remains visible but dims slightly (`opacity: 0.6`)
- A **Restart Selector** panel slides up from the bottom, overlaying the stop buttons area:
  - Panel background: `--surface`, 16px top radius, full screen width, 300ms slide-up
  - Header text: "RESTART FROM" — `--text-label`, `--text-muted`, centered, 16px top padding
  - Track list: compact rows (48px tall), one per playlist track, `--text-body`, `--text`
    - The track that was playing when Stop was tapped is highlighted: `--surface-hi` background, `--accent` text, "● playing" micro-label to the right
    - Other tracks: `--surface` background, normal text
    - Tap any row: audio restarts from the beginning of that track (fades in from silence), panel dismisses, screen returns to Playing Normally state
  - Below the track list: "← Back to Playlist" text link — `--text-label`, `--text-muted`, centered, navigates to Screen 2 (slide right, 300ms) without restarting

#### Paused — *v2, not implemented*
- Deferred. No UI reserved for this state in v1.

### Copy Guidance

| Location | Copy |
|---|---|
| Now playing label | "NOW PLAYING" |
| Next up label | "NEXT UP" |
| Next up label (fade-out triggered) | "FINAL SONG" |
| Loop badge | "∞  LOOPING" |
| Loop badge (fade-out triggered) | "↓  ENDING SOON" |
| Crossfade badge | "↝  CROSSFADE" |
| Fade Out button | "↓  Fade Out" |
| Fade Out button (active) | "Ending after next song…" |
| Stop button | "◼  Stop" |
| Last-track annotation | "↩  loops to first" |
| Restart selector header | "RESTART FROM" |
| Restart selector back link | "← Back to Playlist" |
| Stopped track micro-label | "● playing" |

### Transition Back to Screen 2

**Via Fade Out (automatic):** When the final song completes after fade-out mode is triggered, the audio engine ends the loop. The UI automatically navigates to Screen 2 (Playlist) with a horizontal slide-right (300ms). No user action is required; the transition is entirely automatic.

**Via Stop → Restart Selector → Back to Playlist:** Tap "← Back to Playlist" in the restart selector panel. Audio remains stopped. Slide-right to Screen 2 (300ms). Track order is preserved. No data is lost.

**Via Stop → Restart from track:** Tap a track row in the restart selector. Audio begins immediately from the start of that track (fades in from silence). Restart selector panel slides down and dismisses. Screen returns to Playing Normally state — no navigation to Screen 2.

---

## Interaction Flow Diagram (text)

```
Open app
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ SCREEN 1: Library                                   │
│                                                     │
│  [empty state]                                      │
│       │                                             │
│       ▼ tap "＋ Import"                             │
│  [OS file picker sheet opens — system UI]           │
│       │                                             │
│       ▼ user selects files, dismisses sheet         │
│  [library list populates; tracks unselected]        │
│       │                                             │
│       ├─ tap "＋ Import" again ──► [OS picker opens, appends more files]
│       ├─ tap a track row      ──► [toggles selection on/off]
│       │                                             │
│       ▼ tap "Add to Playlist (N) →"  (≥1 selected)  │
└─────────────────────────────────────────────────────┘
  │  [slide left, 300ms]
  ▼
┌─────────────────────────────────────────────────────┐
│ SCREEN 2: Playlist                                  │
│                                                     │
│  [track list — initial order = library order]       │
│       │                                             │
│       ├─ drag to reorder  ──► [live order update]   │
│       ├─ tap 🗑 delete    ──► [track removed]       │
│       ├─ tap "← Library" ──► [slide right → Screen 1, selections preserved]
│       │                                             │
│       ▼ tap "▶ Play Loop"                           │
└─────────────────────────────────────────────────────┘
  │  [slide left, 300ms — audio begins]
  ▼
┌─────────────────────────────────────────────────────┐
│ SCREEN 3: Playback                                  │
│                                                     │
│  [track plays, progress bar advances]               │
│       │                                             │
│       ├─ track ends ──► [crossfade ──► next track, repeats forever]
│       │                                             │
│       ├─ tap "↓ Fade Out"                           │
│       │     └─ [button → "Ending after next song…"] │
│       │     └─ [next song plays to completion]      │
│       │     └─ [auto-navigate → Screen 2, slide right]
│       │                                             │
│       ▼ tap "◼ Stop"                               │
│  [audio stops; Restart Selector panel slides up]    │
│       │                                             │
│       ├─ tap a track in selector ──► [restart from that track, resume playing]
│       │                                             │
│       └─ tap "← Back to Playlist" ──► [slide right → Screen 2, order preserved]
└─────────────────────────────────────────────────────┘
```

---

## Open Questions for Ione Vale

These design decisions cannot be finalized until the audio engine behavior is confirmed. Each item is blocking a specific piece of the Playback screen spec.

---

**OQ-1: Crossfade start event**

> Can the audio engine emit a callback or event at the exact moment a crossfade begins (i.e., when `linearRampToValueAtTime` is called for the gain ramp)?

The Playback screen's crossfade animation is timed from `t=0` of the actual audio fade. If the engine can fire `onCrossfadeStart(incomingTrackIndex, durationMs)`, the UI can use `incomingTrackIndex` to know which track title to animate in, and `durationMs` to know how long to run the animation. Without this event, the UI can only approximate using a timer seeded from an earlier scheduling event — which will drift.

**Preferred API shape:** `engine.on('crossfadeStart', ({ incoming: TrackIndex, duration: number }) => void)`

---

**OQ-2: Fade Out exact behavior**

> When the user taps "Fade Out", does the loop stop after the *current* song fades out, or does it play the *next* song through to completion and then stop?

The current spec implements the product owner's stated preference: current song finishes and fades out to silence → next song fades in from silence and plays to its natural end → loop stops. The UI reflects this ("Ending after next song…", "FINAL SONG" label on the next-up zone).

If the engine behavior differs — e.g., it stops immediately after the current song's fade — the UI labels and the automatic navigation timing must be adjusted. **This needs explicit confirmation from Ione Vale before the Fade Out state is implemented.**

---

**OQ-3: Current track index for restart selector**

> Can the audio engine report which track index was active at the moment Stop was tapped?

The Stopped state's restart selector highlights the last-playing track. This requires the UI to know the track index at stop time. Proposed: `engine.stop()` returns (or synchronously exposes) `{ stoppedAtTrackIndex: number }`, or the engine fires an `onStop({ trackIndex })` event.

Without this, the UI can fall back to tracking the last known track index from the most recent `crossfadeStart` event (OQ-1), but that may be stale if a crossfade was not in progress at stop time.

---

**OQ-4: Crossfade duration — fixed or variable?**

> Is the crossfade always exactly 3 seconds, or does it vary (e.g., shorter for tracks under 6 seconds)?

The spec currently assumes a fixed ~3-second crossfade for animation timing. If duration varies, the animation system needs to be parameterized on `durationMs`. If it can vary, what is the minimum duration (e.g., a 4-second track cannot support a 3-second fade without overlap)?

---

**OQ-5: Progress information available from the engine**

> Does the audio engine expose `currentTime` and `duration` per track in real-time?

The progress bar and elapsed/duration display require continuous per-track position data. Proposed: `engine.getPlaybackState()` returns `{ currentTrackIndex, elapsed: number, duration: number, crossfading: boolean }`, callable at 60fps from a `requestAnimationFrame` loop. Does this match Ione's planned API?

---

**OQ-6: AudioContext and navigation timing**

> On iOS Safari, `AudioContext.resume()` must be called within a user gesture handler. The Play Loop button tap is that gesture. Is it reliable to both (a) resume AudioContext and (b) trigger React navigation in the same tap event handler?

The design assumes audio begins during the slide-left navigation transition, so by the time Screen 3 is visible, sound is audible. If the gesture handler constraint means navigation must complete first and then a second gesture is needed to start audio, the Screen 3 design needs a "Tap to Start" interstitial state. Prefer the single-gesture path if at all possible.

---

**OQ-7: Handling unequal track durations and the "last few seconds" edge case**

> If a track is shorter than the crossfade duration (e.g., a 2-second clip with a 3-second crossfade), how does the engine handle this?

The UI crossfade animation assumes there is always a full ~3-second fade to animate. If the engine truncates the fade or handles very short tracks differently, the UI needs to know so the animation duration can be clamped or adapted. The "⚠ Best with 5 or fewer tracks" warning on Screen 2 could be extended to warn about very short tracks if this edge case is problematic.

---

*End of Decision 002*
