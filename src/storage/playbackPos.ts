const KEY = 'witchdance-playback-pos'

export interface PlaybackPos {
  trackIndex: number
  elapsed: number   // seconds into the track
  savedAt: number   // Date.now() — so we can discard stale state
}

export function savePlaybackPos(pos: PlaybackPos): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(pos)) } catch { /* ok */ }
}

export function loadPlaybackPos(): PlaybackPos | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const pos = JSON.parse(raw) as PlaybackPos
    // Discard if saved more than 2 hours ago (stale session)
    if (Date.now() - pos.savedAt > 2 * 60 * 60 * 1000) {
      clearPlaybackPos()
      return null
    }
    return pos
  } catch { return null }
}

export function clearPlaybackPos(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* ok */ }
}
