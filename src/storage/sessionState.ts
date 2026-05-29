const KEY_PLAYLIST = 'wd_playlist'
const KEY_SCREEN = 'wd_screen'
const KEY_FILLER_TRACK_ID = 'wd_filler_track_id'
const KEY_FILLER_OFFSET = 'wd_filler_offset'
const KEY_AUTO_FILL = 'wd_auto_fill'
const KEY_FILL_VOLUME = 'wd_fill_volume'

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

export function saveAutoFillEnabled(on: boolean): void {
  try { localStorage.setItem(KEY_AUTO_FILL, on ? '1' : '0') } catch { /* silent */ }
}

export function loadAutoFillEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY_AUTO_FILL)
    return raw === null ? true : raw === '1'
  } catch { return true }
}

export function saveFillVolume(volume: number): void {
  try { localStorage.setItem(KEY_FILL_VOLUME, String(volume)) } catch { /* silent */ }
}

export function loadFillVolume(): number {
  try {
    const raw = localStorage.getItem(KEY_FILL_VOLUME)
    if (!raw) return 1.0
    const n = parseFloat(raw)
    return isFinite(n) ? Math.max(0.1, Math.min(1.0, n)) : 1.0
  } catch { return 1.0 }
}

export function saveDebugMode(on: boolean): void {
  try { sessionStorage.setItem('debug-mode', on ? '1' : '0') } catch { /* silent */ }
}

export function loadDebugMode(): boolean {
  try { return sessionStorage.getItem('debug-mode') === '1' } catch { return false }
}
