import type { Track } from '../types/track'

const XFADE_SECS = 6
const STOP_FADE_SECS = 10

export interface PlaybackState {
  currentTrackIndex: number
  elapsed: number
  duration: number
  crossfading: boolean
}

export interface AudioEngineCallbacks {
  onCrossfadeStart?: (incomingIndex: number, durationMs: number) => void
  onTrackChange?: (trackIndex: number) => void
  onLoopEnd?: () => void
  onDebugLog?: (entry: string) => void
}

interface AudioNode2 {
  source: AudioBufferSourceNode
  gain: GainNode
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private bufferCache = new Map<string, AudioBuffer>()

  private _streamDest: MediaStreamAudioDestinationNode | null = null
  private _mediaEl: HTMLAudioElement | null = null

  private currentNode: AudioNode2 | null = null
  private incomingNode: AudioNode2 | null = null

  private tracks: Track[] = []
  private _currentIndex = 0
  private _incomingIndex = -1
  private currentStartCtxTime = 0
  private incomingStartCtxTime = 0
  private currentDuration = 0
  private _crossfading = false

  private xfadeTimer: ReturnType<typeof setTimeout> | null = null
  private xfadeCompletionTimer: ReturnType<typeof setTimeout> | null = null
  private loopEndTimer: ReturnType<typeof setTimeout> | null = null

  private fadeOutMode = false
  private _fadeOutFinalIndex = -1
  private _fadeOutAfterThis = false
  private _intentionallyStopped = false
  private _playGeneration = 0

  // ── Filler mode ──────────────────────────────────────────────
  private _inFillerMode = false
  private _fillerBuffer: AudioBuffer | null = null
  private _fillerSessionOffset = 0    // offset in file when current filler node started
  private _fillerStartCtxTime = 0     // ctx.currentTime when current filler node started
  private _resumeNextIndex = 0
  private _fillerLoopTimer: ReturnType<typeof setTimeout> | null = null
  private _fillerLoopCompletionTimer: ReturnType<typeof setTimeout> | null = null

  callbacks: AudioEngineCallbacks = {}

  // ── Debug log ────────────────────────────────────────────────
  private _log: string[] = []
  private _dlog(msg: string): void {
    const ts = new Date().toISOString().slice(11, 23)
    const entry = `[${ts}] ${msg}`
    console.log('[AE]', entry)
    this._log.push(entry)
    if (this._log.length > 60) this._log.shift()
    this.callbacks.onDebugLog?.(entry)
  }
  getDebugLog(): string[] { return [...this._log] }

  // ── Public API ───────────────────────────────────────────────

  async start(
    tracks: Track[],
    startIndex = 0,
    existingCtx?: AudioContext | null,
    seekOffset = 0,
  ): Promise<void> {
    this._dlog(`start() idx=${startIndex} seek=${seekOffset} existingCtx=${!!existingCtx} gen-before=${this._playGeneration}`)
    this._reset()
    this._dlog(`start() after reset gen=${this._playGeneration} ctx=${this.ctx?.state ?? 'null'}`)
    this.tracks = tracks

    if (existingCtx) {
      this.ctx = existingCtx
    } else if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') {
      this._dlog(`start() resuming suspended ctx`)
      await this.ctx.resume()
    }

    // Route output through HTMLAudioElement so iOS keeps playing on lock screen
    if (!this._streamDest || this._streamDest.context !== this.ctx) {
      this._dlog(`start() creating new streamDest+mediaEl`)
      this._streamDest = this.ctx.createMediaStreamDestination()
      this._mediaEl = new Audio()
      this._mediaEl.srcObject = this._streamDest.stream

      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('pause', () => {
          // Intentionally swallow — WitchDance does not support pause
        })
        navigator.mediaSession.setActionHandler('play', () => {
          this._mediaEl?.play().catch(() => {})
        })
        navigator.mediaSession.setActionHandler('previoustrack', null)
        navigator.mediaSession.setActionHandler('nexttrack', null)
        navigator.mediaSession.setActionHandler('stop', null)
      }

      this._intentionallyStopped = false
      this._mediaEl.play().catch(() => {})
    } else {
      this._dlog(`start() reusing existing streamDest`)
    }

    await this._playTrack(startIndex, 1, seekOffset)
    this._preload(this._next(startIndex))
  }

  stop(): void {
    this._dlog(`stop() called gen=${this._playGeneration}`)
    this._reset()
  }

  triggerFadeOut(): void {
    if (this.fadeOutMode) return
    this.fadeOutMode = true
    this._fadeOutFinalIndex = this._crossfading
      ? this._incomingIndex
      : this._next(this._currentIndex)
  }

  fadeOutNow(): number {
    if (!this.ctx || !this.currentNode) return STOP_FADE_SECS
    const ctx = this.ctx
    const xfadeSecs = STOP_FADE_SECS

    this._clearTimer('all')

    const g = this.currentNode.gain.gain
    g.setValueAtTime(g.value, ctx.currentTime)
    g.linearRampToValueAtTime(0, ctx.currentTime + xfadeSecs)

    if (this.incomingNode) {
      this._teardown(this.incomingNode)
      this.incomingNode = null
    }

    this.loopEndTimer = setTimeout(() => {
      this._teardown(this.currentNode)
      this.currentNode = null
      this.callbacks.onLoopEnd?.()
    }, xfadeSecs * 1000)

    return xfadeSecs
  }

  cancelFadeOut(): void {
    if (!this.ctx || !this.currentNode) return
    const ctx = this.ctx

    // Clear all fade-mode flags
    this._fadeOutAfterThis = false
    this.fadeOutMode = false
    this._fadeOutFinalIndex = -1

    // Cancel loopEnd timer (would have ended playback)
    this._clearTimer('loopEnd')

    // Cancel any in-flight xfade timers
    this._clearTimer('xfade')
    this._clearTimer('xfadeCompletion')

    // Teardown incoming node if mid-crossfade
    if (this.incomingNode) {
      this._teardown(this.incomingNode)
      this.incomingNode = null
      this._crossfading = false
      this._incomingIndex = -1
    }

    // Cancel any scheduled gain automation and ramp back to 1
    const g = this.currentNode.gain.gain
    const currentGain = g.value
    g.cancelScheduledValues(ctx.currentTime)
    g.setValueAtTime(currentGain, ctx.currentTime)

    if (currentGain < 0.99) {
      // Gain was fading — ramp back up, then reschedule xfade after restore
      const restoreTime = XFADE_SECS * 0.5  // restore at half the xfade speed
      g.linearRampToValueAtTime(1, ctx.currentTime + restoreTime)
      setTimeout(() => {
        if (this.ctx && this.currentNode) this._scheduleXfade()
      }, restoreTime * 1000 + 50)
    } else {
      // Gain is fine — reschedule xfade immediately
      // _scheduleXfade uses Math.max(50ms, ...) so if near end it fires almost instantly
      this._scheduleXfade()
    }
  }

  crossfadeTo(trackIndex: number): void {
    if (!this.ctx || !this.currentNode) return
    const ctx = this.ctx

    this._clearTimer('all')

    if (this.incomingNode) {
      this._teardown(this.incomingNode)
      this.incomingNode = null
    }

    this.fadeOutMode = false
    this._fadeOutFinalIndex = -1
    this._fadeOutAfterThis = false

    const xfadeSecs = this._xfadeSecs(this.currentDuration)
    const oldNode = this.currentNode
    this._crossfading = true
    this._incomingIndex = trackIndex

    const g = oldNode.gain.gain
    g.cancelScheduledValues(ctx.currentTime)
    g.setValueAtTime(g.value, ctx.currentTime)
    g.linearRampToValueAtTime(0, ctx.currentTime + xfadeSecs)

    void this._load(this.tracks[trackIndex]).then((buffer) => {
      if (!this.ctx || !this._streamDest) return
      const now = this.ctx.currentTime
      const inNode = this._makeNode(buffer, 0)
      inNode.gain.gain.setValueAtTime(0, now)
      inNode.gain.gain.linearRampToValueAtTime(1, now + xfadeSecs)
      inNode.source.start(0)

      this.incomingNode = inNode
      this.incomingStartCtxTime = now
      this.callbacks.onCrossfadeStart?.(trackIndex, xfadeSecs * 1000)

      this.xfadeCompletionTimer = setTimeout(() => {
        if (!this.ctx) return
        this._teardown(oldNode)
        if (this.currentNode === oldNode) {
          this.currentNode = this.incomingNode
        }
        this.incomingNode = null
        this._currentIndex = trackIndex
        this.currentStartCtxTime = this.incomingStartCtxTime
        this.currentDuration = buffer.duration
        this._crossfading = false
        this._incomingIndex = -1

        this.callbacks.onTrackChange?.(trackIndex)
        this._scheduleXfade()
        this._preload(this._next(trackIndex))
      }, xfadeSecs * 1000)
    })
  }

  fadeOutAfterThisSong(): void {
    if (this._fadeOutAfterThis || this.fadeOutMode) return
    this._fadeOutAfterThis = true
    this.fadeOutMode = true
    this._fadeOutFinalIndex = this._currentIndex
  }

  getPlaybackState(): PlaybackState | null {
    if (!this.ctx) return null
    const elapsed = Math.max(
      0,
      Math.min(
        this.ctx.currentTime - this.currentStartCtxTime,
        this.currentDuration,
      ),
    )
    return {
      currentTrackIndex: this._currentIndex,
      elapsed,
      duration: this.currentDuration,
      crossfading: this._crossfading,
    }
  }

  getCurrentIndex(): number {
    return this._currentIndex
  }

  getFadeOutFinalIndex(): number {
    return this._fadeOutFinalIndex
  }

  seekToNearEnd(secondsFromEnd = 10): void {
    if (!this.ctx || !this.tracks.length) return
    const ctx = this.ctx
    const seekIndex = this._currentIndex
    const seekOffset = Math.max(0, this.currentDuration - secondsFromEnd)

    // Preserve fade-out intent across the reset
    const savedFadeOutAfterThis = this._fadeOutAfterThis
    const savedFadeOutMode = this.fadeOutMode

    // Full teardown — guarantees no ghost nodes
    this._reset()

    // Re-create stream infrastructure synchronously (still within user gesture window)
    this._streamDest = ctx.createMediaStreamDestination()
    this._mediaEl = new Audio()
    this._mediaEl.srcObject = this._streamDest.stream

    this._intentionallyStopped = false
    this._mediaEl.play().catch(() => {})

    // Restore fade intent
    this._fadeOutAfterThis = savedFadeOutAfterThis
    this.fadeOutMode = savedFadeOutMode
    if (savedFadeOutAfterThis) {
      this._fadeOutFinalIndex = seekIndex
    }

    // Load and play with seek offset (async is fine — play() is already banked)
    void this._playTrack(seekIndex, 1, seekOffset).then(() => {
      this._preload(this._next(seekIndex))
    })
  }

  pausePlayback(): void {
    if (!this._mediaEl || this._intentionallyStopped) return
    this._mediaEl.pause()
    if (this.ctx?.state === 'running') void this.ctx.suspend()
  }

  resumePlayback(): void {
    if (!this._mediaEl || this._intentionallyStopped) return
    if (this.ctx?.state === 'suspended') void this.ctx.resume()
    this._mediaEl.play().catch(() => {})
  }

  isPaused(): boolean {
    return !!this._mediaEl?.paused && !this._intentionallyStopped
  }

  seekToTrackStart(): void {
    if (!this.ctx || !this.tracks.length) return
    const ctx = this.ctx
    const seekIndex = this._currentIndex
    const savedFadeOutAfterThis = this._fadeOutAfterThis
    const savedFadeOutMode = this.fadeOutMode

    this._reset()

    this._streamDest = ctx.createMediaStreamDestination()
    this._mediaEl = new Audio()
    this._mediaEl.srcObject = this._streamDest.stream

    this._intentionallyStopped = false
    this._mediaEl.play().catch(() => {})

    this._fadeOutAfterThis = savedFadeOutAfterThis
    this.fadeOutMode = savedFadeOutMode
    if (savedFadeOutAfterThis) this._fadeOutFinalIndex = seekIndex

    void this._playTrack(seekIndex, 1, 0).then(() => {
      this._preload(this._next(seekIndex))
    })
  }

  seekToTrackIndex(index: number, offset = 0): void {
    if (!this.ctx || !this.tracks.length) return
    const ctx = this.ctx
    const clampedIndex = ((index % this.tracks.length) + this.tracks.length) % this.tracks.length
    this._reset()

    this._streamDest = ctx.createMediaStreamDestination()
    this._mediaEl = new Audio()
    this._mediaEl.srcObject = this._streamDest.stream

    this._intentionallyStopped = false
    this._mediaEl.play().catch(() => {})

    void this._playTrack(clampedIndex, 1, offset).then(() => {
      this._preload(this._next(clampedIndex))
    })
  }

  /** Safe slow-poll recovery: call from a ~2s interval; won't cause double audio. */
  ensurePlaying(): void {
    if (this._mediaEl && this._mediaEl.paused && !this._intentionallyStopped) {
      this._mediaEl.play().catch(() => {})
    }
  }

  isInFillerMode(): boolean { return this._inFillerMode }

  getFillerOffset(): number {
    if (!this.ctx) return 0
    return this.ctx.currentTime - this._fillerStartCtxTime + this._fillerSessionOffset
  }

  getFillerState(): { elapsed: number; duration: number; resumeNextIndex: number } | null {
    if (!this._inFillerMode || !this._fillerBuffer) return null
    return {
      elapsed: this.getFillerOffset(),
      duration: this._fillerBuffer.duration,
      resumeNextIndex: this._resumeNextIndex,
    }
  }

  async enterFillerMode(
    fillerTrack: Track,
    fillerOffset: number,
    resumeNextIndex: number,
  ): Promise<void> {
    if (!this.ctx) return
    const gen = this._playGeneration

    // Stop all playlist scheduling synchronously before any await
    this._clearTimer('all')
    if (this.incomingNode) {
      this._teardown(this.incomingNode)
      this.incomingNode = null
    }
    this._crossfading = false
    this._resumeNextIndex = resumeNextIndex
    this._dlog(`enterFillerMode fillerOffset=${fillerOffset.toFixed(2)} resumeNext=${resumeNextIndex}`)

    const buffer = await this._load(fillerTrack)
    if (gen !== this._playGeneration || !this.ctx || !this._streamDest) {
      this._dlog(`enterFillerMode STALE DROP gen-was=${gen} gen-now=${this._playGeneration}`)
      return
    }

    const ctx = this.ctx
    const now = ctx.currentTime
    const xfadeSecs = this._xfadeSecs(buffer.duration)

    const fillerNode = this._makeNode(buffer, 0)
    fillerNode.gain.gain.setValueAtTime(0, now)
    fillerNode.gain.gain.linearRampToValueAtTime(1, now + xfadeSecs)
    fillerNode.source.start(0, fillerOffset)

    if (this.currentNode) {
      const g = this.currentNode.gain.gain
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0, now + xfadeSecs)
    }

    const oldNode = this.currentNode
    this._fillerBuffer = buffer
    this._fillerSessionOffset = fillerOffset
    this._fillerStartCtxTime = now

    this.xfadeCompletionTimer = setTimeout(() => {
      if (!this.ctx) return
      this._teardown(oldNode)
      this.currentNode = fillerNode
      this.currentDuration = buffer.duration
      this._fillerStartCtxTime = now
      this._inFillerMode = true
      this._dlog(`enterFillerMode complete offset=${fillerOffset.toFixed(2)}`)
      this._scheduleFillerLoop()
    }, xfadeSecs * 1000)
  }

  exitFillerMode(): { fillerOffset: number } {
    const fillerOffset = this.getFillerOffset()
    this._dlog(`exitFillerMode at fillerOffset=${fillerOffset.toFixed(2)} resumeNext=${this._resumeNextIndex}`)

    this._clearTimer('fillerLoop')
    this._clearTimer('fillerLoopCompletion')

    if (!this.ctx || !this._streamDest) {
      this._inFillerMode = false
      return { fillerOffset }
    }

    const resumeIdx = this._resumeNextIndex
    const oldFillerNode = this.currentNode
    this._inFillerMode = false

    void this._load(this.tracks[resumeIdx]).then((buffer) => {
      if (!this.ctx || !this._streamDest) return
      const now = this.ctx.currentTime
      const xfadeSecs = this._xfadeSecs(buffer.duration)

      const newNode = this._makeNode(buffer, 0)
      newNode.gain.gain.setValueAtTime(0, now)
      newNode.gain.gain.linearRampToValueAtTime(1, now + xfadeSecs)
      newNode.source.start(0)

      if (oldFillerNode) {
        const g = oldFillerNode.gain.gain
        g.cancelScheduledValues(now)
        g.setValueAtTime(g.value, now)
        g.linearRampToValueAtTime(0, now + xfadeSecs)
      }

      this.incomingNode = newNode
      this.incomingStartCtxTime = now
      this.callbacks.onCrossfadeStart?.(resumeIdx, xfadeSecs * 1000)

      this.xfadeCompletionTimer = setTimeout(() => {
        if (!this.ctx) return
        this._teardown(oldFillerNode)
        if (this.currentNode === oldFillerNode) this.currentNode = newNode
        this.incomingNode = null
        this._currentIndex = resumeIdx
        this.currentStartCtxTime = now
        this.currentDuration = buffer.duration
        this._crossfading = false
        this._fillerBuffer = null

        this.callbacks.onTrackChange?.(resumeIdx)
        this._scheduleXfade()
        this._preload(this._next(resumeIdx))
        this._dlog(`exitFillerMode complete idx=${resumeIdx}`)
      }, xfadeSecs * 1000)
    })

    return { fillerOffset }
  }

  // ── Private ──────────────────────────────────────────────────

  private _scheduleFillerLoop(): void {
    if (!this.ctx || !this._fillerBuffer) return
    const xfadeSecs = this._xfadeSecs(this._fillerBuffer.duration)
    const elapsed = this.ctx.currentTime - this._fillerStartCtxTime
    const effectivePos = elapsed + this._fillerSessionOffset
    const delay = Math.max(50, (this._fillerBuffer.duration - xfadeSecs - effectivePos) * 1000)
    this._fillerLoopTimer = setTimeout(() => void this._beginFillerLoop(), delay)
  }

  private async _beginFillerLoop(): Promise<void> {
    if (!this.ctx || !this._fillerBuffer || !this._inFillerMode) return
    const ctx = this.ctx
    const buffer = this._fillerBuffer
    const xfadeSecs = this._xfadeSecs(buffer.duration)
    const now = ctx.currentTime

    const newFillerNode = this._makeNode(buffer, 0)
    newFillerNode.gain.gain.setValueAtTime(0, now)
    newFillerNode.gain.gain.linearRampToValueAtTime(1, now + xfadeSecs)
    newFillerNode.source.start(0)

    const oldNode = this.currentNode
    if (oldNode) {
      const g = oldNode.gain.gain
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0, now + xfadeSecs)
    }

    this._fillerLoopCompletionTimer = setTimeout(() => {
      if (!this.ctx) return
      this._teardown(oldNode)
      this.currentNode = newFillerNode
      this._fillerSessionOffset = 0
      this._fillerStartCtxTime = now
      this._dlog(`fillerLoop restart from 0`)
      this._scheduleFillerLoop()
    }, xfadeSecs * 1000)
  }

  private async _playTrack(index: number, gainStart = 1, seekOffset = 0): Promise<void> {
    const ctx = this.ctx!
    const gen = this._playGeneration
    this._dlog(`_playTrack() start idx=${index} gain=${gainStart} gen=${gen}`)
    const buffer = await this._load(this.tracks[index])

    // If _reset() was called while we were loading, discard this stale call
    if (gen !== this._playGeneration || !this._streamDest) {
      this._dlog(`_playTrack() STALE DROP idx=${index} gen-was=${gen} gen-now=${this._playGeneration} streamDest=${!!this._streamDest}`)
      return
    }
    this._dlog(`_playTrack() creating node idx=${index} gen=${gen}`)
    const node = this._makeNode(buffer, gainStart)
    node.source.start(0, seekOffset)

    this.currentNode = node
    this._currentIndex = index
    // Offset currentStartCtxTime backwards so elapsed time reflects seeked position
    this.currentStartCtxTime = ctx.currentTime - seekOffset
    this.currentDuration = buffer.duration
    this._crossfading = false

    this.callbacks.onTrackChange?.(index)

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.tracks[index].name,
        artist: 'WitchDance',
        album: '',
      })
      navigator.mediaSession.playbackState = 'playing'
    }

    this._scheduleXfade()
  }

  private _scheduleXfade(): void {
    this._clearTimer('xfade')
    const ctx = this.ctx!
    const elapsed = ctx.currentTime - this.currentStartCtxTime
    const xfadeSecs = this._xfadeSecs(this.currentDuration)
    const delay = Math.max(50, (this.currentDuration - xfadeSecs - elapsed) * 1000)
    this.xfadeTimer = setTimeout(() => void this._beginXfade(), delay)
  }

  private async _beginXfade(): Promise<void> {
    if (!this.ctx) return

    if (this._fadeOutAfterThis) {
      const ctx = this.ctx
      const xfadeSecs = this._xfadeSecs(this.currentDuration)
      if (this.currentNode) {
        const g = this.currentNode.gain.gain
        g.setValueAtTime(g.value, ctx.currentTime)
        g.linearRampToValueAtTime(0, ctx.currentTime + xfadeSecs)
      }
      this.loopEndTimer = setTimeout(() => {
        this._teardown(this.currentNode)
        this.currentNode = null
        this.callbacks.onLoopEnd?.()
      }, xfadeSecs * 1000)
      return
    }

    const ctx = this.ctx
    const nextIdx = this._next(this._currentIndex)
    const nextBuf = await this._load(this.tracks[nextIdx])
    const xfadeSecs = this._xfadeSecs(
      Math.min(this.currentDuration, nextBuf.duration),
    )

    this._crossfading = true
    this._incomingIndex = nextIdx
    this.incomingStartCtxTime = ctx.currentTime

    const inNode = this._makeNode(nextBuf, 0)
    const now = ctx.currentTime
    inNode.gain.gain.setValueAtTime(0, now)
    inNode.gain.gain.linearRampToValueAtTime(1, now + xfadeSecs)

    if (this.currentNode) {
      const g = this.currentNode.gain.gain
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0, now + xfadeSecs)
    }

    inNode.source.start(0)
    this.incomingNode = inNode

    this.callbacks.onCrossfadeStart?.(nextIdx, xfadeSecs * 1000)
    this.xfadeCompletionTimer = setTimeout(
      () => this._completeXfade(nextIdx, nextBuf),
      xfadeSecs * 1000,
    )
  }

  private _completeXfade(trackIndex: number, buffer: AudioBuffer): void {
    this._teardown(this.currentNode)
    this.currentNode = this.incomingNode
    this.incomingNode = null
    this._currentIndex = trackIndex
    this.currentStartCtxTime = this.incomingStartCtxTime
    this.currentDuration = buffer.duration
    this._crossfading = false

    this.callbacks.onTrackChange?.(trackIndex)

    if (this.fadeOutMode && trackIndex === this._fadeOutFinalIndex) {
      // Final track: play to natural end, then fire onLoopEnd
      const elapsed =
        (this.ctx?.currentTime ?? 0) - this.currentStartCtxTime
      const remaining = buffer.duration - elapsed
      this.loopEndTimer = setTimeout(() => {
        this._teardown(this.currentNode)
        this.currentNode = null
        this.callbacks.onLoopEnd?.()
      }, Math.max(200, remaining * 1000))
      return
    }

    this._scheduleXfade()
    this._preload(this._next(trackIndex))
  }

  private _makeNode(buffer: AudioBuffer, gainStart: number): AudioNode2 {
    const ctx = this.ctx!
    const usingFallback = !this._streamDest
    const dest = this._streamDest ?? ctx.destination
    this._dlog(`_makeNode() gainStart=${gainStart} usingFallback=${usingFallback} gen=${this._playGeneration}`)
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    source.buffer = buffer
    source.connect(gain)
    gain.connect(dest)
    gain.gain.setValueAtTime(gainStart, ctx.currentTime)
    return { source, gain }
  }

  private _teardown(node: AudioNode2 | null): void {
    if (!node) return
    try { node.source.stop() } catch { /* already ended */ }
    try { node.source.disconnect() } catch { /* ok */ }
    try { node.gain.disconnect() } catch { /* ok */ }
  }

  // Cap crossfade to 40% of the shorter track to prevent overlap
  private _xfadeSecs(trackDuration: number): number {
    return Math.min(XFADE_SECS, trackDuration * 0.4)
  }

  private async _load(track: Track): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(track.id)
    if (cached) return cached
    const raw = await track.file.arrayBuffer()
    const decoded = await this.ctx!.decodeAudioData(raw)
    this.bufferCache.set(track.id, decoded)
    return decoded
  }

  private _preload(index: number): void {
    if (this.tracks[index]) {
      this._load(this.tracks[index]).catch(() => { /* silent */ })
    }
  }

  private _next(index: number): number {
    return (index + 1) % this.tracks.length
  }

  private _clearTimer(which: 'xfade' | 'xfadeCompletion' | 'loopEnd' | 'fillerLoop' | 'fillerLoopCompletion' | 'all'): void {
    if (which === 'xfade' || which === 'all') {
      if (this.xfadeTimer) { clearTimeout(this.xfadeTimer); this.xfadeTimer = null }
    }
    if (which === 'xfadeCompletion' || which === 'all') {
      if (this.xfadeCompletionTimer) {
        clearTimeout(this.xfadeCompletionTimer)
        this.xfadeCompletionTimer = null
      }
    }
    if (which === 'loopEnd' || which === 'all') {
      if (this.loopEndTimer) { clearTimeout(this.loopEndTimer); this.loopEndTimer = null }
    }
    if (which === 'fillerLoop' || which === 'all') {
      if (this._fillerLoopTimer) { clearTimeout(this._fillerLoopTimer); this._fillerLoopTimer = null }
    }
    if (which === 'fillerLoopCompletion' || which === 'all') {
      if (this._fillerLoopCompletionTimer) { clearTimeout(this._fillerLoopCompletionTimer); this._fillerLoopCompletionTimer = null }
    }
  }

  private _reset(): void {
    this._dlog(`_reset() gen-before=${this._playGeneration} currentNode=${!!this.currentNode} incomingNode=${!!this.incomingNode} mediaEl=${!!this._mediaEl}`)
    this._intentionallyStopped = true
    this._playGeneration++
    this._clearTimer('all')
    this._teardown(this.currentNode)
    this._teardown(this.incomingNode)
    this.currentNode = null
    this.incomingNode = null
    this._crossfading = false
    this.fadeOutMode = false
    this._fadeOutFinalIndex = -1
    this._fadeOutAfterThis = false
    this._inFillerMode = false
    this._fillerBuffer = null
    if (this._mediaEl) {
      this._mediaEl.pause()
      this._mediaEl.srcObject = null
      this._mediaEl = null
    }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none'
    }
    this._streamDest = null
    this._dlog(`_reset() done gen=${this._playGeneration}`)
  }
}
