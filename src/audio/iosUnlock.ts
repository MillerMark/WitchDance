// Minimal silent MP3: claims the iOS "media" audio session so Web Audio
// output is not silenced by the hardware mute/silent switch.
const SILENT_AUDIO =
  'data:audio/mpeg;base64,/+MYxAAAAANIAAAAAExBTUUzLjk4LjIAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

let _unlockEl: HTMLAudioElement | null = null

export function iosAudioUnlock(): void {
  if (!_unlockEl) {
    _unlockEl = new Audio()
    _unlockEl.src = SILENT_AUDIO
    _unlockEl.loop = true
    _unlockEl.volume = 0.001
  }
  _unlockEl.play().catch(() => {
    // iOS may reject calls made outside a user gesture — that's fine
  })
}

export function iosAudioStop(): void {
  if (_unlockEl) {
    _unlockEl.pause()
    _unlockEl.currentTime = 0
  }
}
