const KEY_PLAYLIST = 'wd_playlist'
const KEY_SCREEN = 'wd_screen'
const KEY_FILLER_TRACK_ID = 'wd_filler_track_id'
const KEY_FILLER_OFFSET = 'wd_filler_offset'

export function savePlaylist(trackIds: string[]): void {
  try {
    localStorage.setItem(KEY_PLAYLIST, JSON.stringify(trackIds))
  } catch { /* storage full — silent */ }
}

export function loadPlaylist(): string[] {
  try {
    const raw = localStorage.getItem(KEY_PLAYLIST)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function saveScreen(screen: string): void {
  try {
    localStorage.setItem(KEY_SCREEN, screen)
  } catch { /* silent */ }
}

export function loadScreen(): string {
  return localStorage.getItem(KEY_SCREEN) ?? 'library'
}

export function clearSession(): void {
  localStorage.removeItem(KEY_PLAYLIST)
  localStorage.removeItem(KEY_SCREEN)
}

export function saveFillerTrackId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(KEY_FILLER_TRACK_ID)
    else localStorage.setItem(KEY_FILLER_TRACK_ID, id)
  } catch { /* silent */ }
}

export function loadFillerTrackId(): string | null {
  try { return localStorage.getItem(KEY_FILLER_TRACK_ID) } catch { return null }
}

export function saveFillerOffset(offset: number): void {
  try { localStorage.setItem(KEY_FILLER_OFFSET, String(offset)) } catch { /* silent */ }
}

export function loadFillerOffset(): number {
  try {
    const raw = localStorage.getItem(KEY_FILLER_OFFSET)
    const n = raw ? parseFloat(raw) : 0
    return isFinite(n) ? n : 0
  } catch { return 0 }
}

export function saveDebugMode(on: boolean): void {
  try { sessionStorage.setItem('debug-mode', on ? '1' : '0') } catch { /* silent */ }
}

export function loadDebugMode(): boolean {
  try { return sessionStorage.getItem('debug-mode') === '1' } catch { return false }
}
