// Registers the current track with the iOS/browser Media Session API
// so lock screen controls and "Now Playing" info are shown.

export function updateMediaSession(
  trackName: string,
  onPlay?: (() => void) | null,
  onPause?: (() => void) | null,
  onNextTrack?: (() => void) | null,
  onPreviousTrack?: (() => void) | null,
): void {
  if (!('mediaSession' in navigator)) return

  navigator.mediaSession.metadata = new MediaMetadata({
    title: trackName,
    artist: 'WitchDance',
    album: '',
  })

  // CRITICAL: Always set handlers (null to disable in performance mode)
  // If we don't explicitly set to null, old handlers remain active!
  navigator.mediaSession.setActionHandler('play', onPlay || null)
  navigator.mediaSession.setActionHandler('pause', onPause || null)
  
  // Enable/disable skip actions based on whether handlers are provided
  // In training mode: handlers provided (allow changing songs)
  // In performance mode: handlers not provided (disable skip to prevent accidents)
  try { 
    navigator.mediaSession.setActionHandler('nexttrack', onNextTrack || null) 
  } catch { /* ok */ }
  try { 
    navigator.mediaSession.setActionHandler('previoustrack', onPreviousTrack || null) 
  } catch { /* ok */ }
}

export function setMediaSessionPlaybackState(state: 'playing' | 'paused'): void {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.playbackState = state
}

export function clearMediaSession(): void {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = null
  // Clear all handlers and set playback state to none
  navigator.mediaSession.setActionHandler('play', null)
  navigator.mediaSession.setActionHandler('pause', null)
  try { navigator.mediaSession.setActionHandler('nexttrack', null) } catch { /* ok */ }
  try { navigator.mediaSession.setActionHandler('previoustrack', null) } catch { /* ok */ }
  navigator.mediaSession.playbackState = 'none'
}

let _wakeLock: WakeLockSentinel | null = null

export async function requestWakeLock(): Promise<void> {
  if (!('wakeLock' in navigator)) return
  try {
    _wakeLock = await (navigator as Navigator & { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request('screen')
  } catch {
    // Wake lock not available (e.g., low battery)
  }
}

export async function releaseWakeLock(): Promise<void> {
  if (_wakeLock) {
    await _wakeLock.release().catch(() => {})
    _wakeLock = null
  }
}
