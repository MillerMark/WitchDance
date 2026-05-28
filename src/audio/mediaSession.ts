// Registers the current track with the iOS/browser Media Session API
// so lock screen controls and "Now Playing" info are shown.

export function updateMediaSession(
  trackName: string,
  onPlay?: () => void,
  onPause?: () => void,
  onNextTrack?: () => void,
  onPreviousTrack?: () => void,
): void {
  if (!('mediaSession' in navigator)) return

  navigator.mediaSession.metadata = new MediaMetadata({
    title: trackName,
    artist: 'WitchDance',
    album: '',
  })

  if (onPlay) navigator.mediaSession.setActionHandler('play', onPlay)
  if (onPause) navigator.mediaSession.setActionHandler('pause', onPause)
  
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

export function clearMediaSession(): void {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = null
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
