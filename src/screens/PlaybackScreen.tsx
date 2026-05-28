import { useEffect, useRef, useState, useCallback } from 'react'
import { AudioEngine } from '../audio/AudioEngine'
import type { Track } from '../types/track'
import { iosAudioUnlock } from '../audio/iosUnlock'
import { updateMediaSession, clearMediaSession, requestWakeLock, releaseWakeLock } from '../audio/mediaSession'
import { savePlaybackPos, clearPlaybackPos } from '../storage/playbackPos'
import { saveFillerOffset, loadFillerOffset } from '../storage/sessionState'

declare const __COMMIT_HASH__: string

interface Props {
  tracks: Track[]
  audioCtx: AudioContext | null
  onStop: () => void
  resumePos?: { trackIndex: number; elapsed: number } | null
  onResumeConsumed?: () => void
  fillerTrack: Track | null
  trainingMode: boolean
  onToggleTraining: () => void
  onEngineReady?: (engine: AudioEngine) => void
}

function formatTime(secs: number): string {
  if (!isFinite(secs) || secs < 0) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function displayName(track: Track | undefined): string {
  if (!track) return ''
  return track.name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── Particle canvas helpers ─────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}

interface ColorFamily { inner: string; mid: string; outer: string }

const COLOR_FAMILIES: ColorFamily[] = [
  { inner: '#ffe7c2', mid: '#ff5071', outer: '#7b1c5e' }, // red/pink
  { inner: '#c8d8ff', mid: '#7cb2fc', outer: '#5066d5' }, // blue
  { inner: '#f5c0ff', mid: '#e16ffb', outer: '#522a9c' }, // purple
]

interface Particle {
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  family: ColorFamily
  size: number
}

type TitlePhase = 'stable' | 'dim' | 'swap'

export function PlaybackScreen({
  tracks,
  audioCtx,
  onStop,
  resumePos,
  onResumeConsumed,
  fillerTrack,
  trainingMode,
  onToggleTraining,
  onEngineReady,
}: Props) {
  const engineRef = useRef(new AudioEngine())
  const onStopRef = useRef(onStop)
  useEffect(() => { onStopRef.current = onStop })
  useEffect(() => { onEngineReady?.(engineRef.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  type ConfirmAction =
    | { type: 'restart'; index: number; name: string }
    | { type: 'backToPlaylist' }

  // ── Playback state ──────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(resumePos ? resumePos.trackIndex : 0)
  const [nextUpIndex, setNextUpIndex] = useState(
    resumePos
      ? (resumePos.trackIndex + 1) % tracks.length
      : tracks.length > 1 ? 1 : 0,
  )
  const [showResume, setShowResume] = useState(!!resumePos)
  const [, setIsCrossfading] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [isChangeSongMode, setIsChangeSongMode] = useState(false)

  const [stoppedAtIndex, setStoppedAtIndex] = useState(0)
  const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null)
  const [isFadeOut, setIsFadeOut] = useState(false)
  const [fadeAfterThis, setFadeAfterThis] = useState(false)
  const [fadeOutFinalIndex, setFadeOutFinalIndex] = useState(-1)
  const [showFadePicker, setShowFadePicker] = useState(false)
  const [isFillerMode, setIsFillerMode] = useState(false)
  const [fillerElapsed, setFillerElapsed] = useState(0)
  const fillerStartTimeRef = useRef(0)
  const fillerOffsetRef = useRef(loadFillerOffset())
  const lastFillerSaveRef = useRef(0)
  const fillerResumeIndexRef = useRef(0)
  const fillerTrackRef = useRef(fillerTrack)
  useEffect(() => { fillerTrackRef.current = fillerTrack }, [fillerTrack])

  // ── Title crossfade animation ───────────────────────────────────────────
  const [, setDisplayTitle] = useState(
    resumePos ? displayName(tracks[resumePos.trackIndex]) : displayName(tracks[0])
  )
  const [, setIncomingTitle] = useState('')
  const [, setTitlePhase] = useState<TitlePhase>('stable')
  const [, setNowPlayingDim] = useState(false)

  // ── Splash track names (driven by RAF, filler-aware) ───────────────────
  const [currentTrackName, setCurrentTrackName] = useState(
    resumePos ? displayName(tracks[resumePos.trackIndex]) : displayName(tracks[0])
  )
  const [nextTrackName, setNextTrackName] = useState(
    displayName(tracks[resumePos ? (resumePos.trackIndex + 1) % tracks.length : (tracks.length > 1 ? 1 : 0)])
  )
  const lastTrackIdxRef = useRef(-1)

  const [trainingPaused, setTrainingPaused] = useState(false)
  const trainingPausedRef = useRef(false)  // Sync ref for RAF loop access
  
  // Debug logging for particle emission state
  const lastEmissionStateRef = useRef<string>('')

  // ── Tap-reveal controls state ───────────────────────────────────────────
  const [controlsVisible, setControlsVisible] = useState(false)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controlsJustShownRef = useRef(false)

  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => {
      setControlsVisible(false)
    }, 4000)
  }, [])

  const hideControlsNow = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    setControlsVisible(false)
  }, [])

  // Resume playback if training mode is turned off while paused; lock scrubbing
  useEffect(() => {
    if (!trainingMode && trainingPaused) {
      engineRef.current.resumePlayback()
      setTrainingPaused(false)
    }
    if (!trainingMode) {
      scrubStateRef.current = 'locked'
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current)
        cooldownTimerRef.current = null
      }
    }
  }, [trainingMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update filler elapsed time every second
  useEffect(() => {
    if (!isFillerMode) return
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - fillerStartTimeRef.current) / 1000)
      setFillerElapsed(elapsed)
    }, 1000)
    return () => clearInterval(interval)
  }, [isFillerMode])

  // ── Direct-DOM refs for RAF (no re-renders at 60fps) ───────────────────
  const progressFillRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const durationRef = useRef<HTMLSpanElement>(null)
  const fillerBtnRef = useRef<HTMLButtonElement>(null)
  const rafRef = useRef(0)
  const xfadeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const lastPosSaveRef = useRef(0)
  const lastEnsureRef = useRef(0)
  const xfadeStartWallRef = useRef(0)
  const xfadeDurationMsRef = useRef(0)
  const isScrubbingRef = useRef(false)
  const scrubStateRef = useRef<'locked' | 'unlocked' | 'cooldown'>('locked')
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Particle canvas refs ────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const lastEmitRef = useRef(0)

  // ── Double-tap on PNG for training mode ────────────────────────────────
  const lastTapRef = useRef(0)

  function startTitleAnimation(incomingIdx: number, durationMs: number) {
    xfadeTimersRef.current.forEach(clearTimeout)
    xfadeTimersRef.current = []
    const inName = displayName(tracks[incomingIdx])
    const half = durationMs / 2
    setIncomingTitle(inName)
    setTitlePhase('dim')
    setNowPlayingDim(true)
    xfadeTimersRef.current.push(
      setTimeout(() => {
        setTitlePhase('swap')
        setNextUpIndex((incomingIdx + 1) % tracks.length)
      }, half),
    )
    xfadeTimersRef.current.push(
      setTimeout(() => {
        setDisplayTitle(inName)
        setIncomingTitle('')
        setTitlePhase('stable')
        setNowPlayingDim(false)
        setIsCrossfading(false)
      }, durationMs),
    )
  }

  // ── Mount: wire engine, start playback, unified RAF loop ───────────────
  useEffect(() => {
    const engine = engineRef.current

    engine.callbacks = {
      onTrackChange: (idx) => {
        setCurrentIndex(idx)
        setNextUpIndex((idx + 1) % tracks.length)
        updateMediaSession(
          tracks[idx]?.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') ?? 'WitchDance',
        )
        // Song change → lock scrubbing
        scrubStateRef.current = 'locked'
        if (cooldownTimerRef.current) {
          clearTimeout(cooldownTimerRef.current)
          cooldownTimerRef.current = null
        }
      },
      onCrossfadeStart: (incomingIdx, durationMs) => {
        setIsCrossfading(true)
        xfadeStartWallRef.current = Date.now()
        xfadeDurationMsRef.current = durationMs
        startTitleAnimation(incomingIdx, durationMs)
      },
      onLoopEnd: () => onStopRef.current(),
    }

    if (!resumePos) {
      engine.start(tracks, 0, audioCtx).catch(console.error)
    }
    void requestWakeLock()

    // Init splash track names
    const initState = engine.getPlaybackState()
    if (initState) {
      lastTrackIdxRef.current = initState.currentTrackIndex
      setCurrentTrackName(displayName(tracks[initState.currentTrackIndex]))
      setNextTrackName(displayName(tracks[(initState.currentTrackIndex + 1) % tracks.length]))
    }

    // ── Unified RAF: engine polling + particle canvas ──────────────────
    const tick = () => {
      // ── Engine polling (from Playback.tsx) ──
      // Use React state instead of engine.isInFillerMode() for consistency
      if (isFillerMode) {
        // Filler mode: update splash names
        const fs = engine.getFillerState()
        if (fs) {
          if (lastTrackIdxRef.current !== -999) {
            lastTrackIdxRef.current = -999
            setCurrentTrackName(fillerTrackRef.current ? displayName(fillerTrackRef.current) : '')
            setNextTrackName(displayName(tracks[fs.resumeNextIndex]))
          }
          // Update progress bar for filler
          const pct = fs.duration > 0 ? (fs.elapsed / fs.duration) * 100 : 0
          if (progressFillRef.current) {
            progressFillRef.current.style.width = `${pct}%`
          }
          if (elapsedRef.current) elapsedRef.current.textContent = formatTime(fs.elapsed)
          if (durationRef.current) {
            const remaining = fs.duration > 0 ? Math.max(0, fs.duration - fs.elapsed) : 0
            durationRef.current.textContent = `-${formatTime(remaining)}`
          }
        }
        // Save filler offset periodically
        const off = engine.getFillerOffset()
        fillerOffsetRef.current = off
        const now2 = Date.now()
        if (now2 - lastFillerSaveRef.current > 2000) {
          lastFillerSaveRef.current = now2
          saveFillerOffset(off)
        }
      } else {
        const state = engine.getPlaybackState()
        if (state) {
          // Update splash track names
          if (state.currentTrackIndex !== lastTrackIdxRef.current) {
            lastTrackIdxRef.current = state.currentTrackIndex
            setCurrentTrackName(displayName(tracks[state.currentTrackIndex]))
            setNextTrackName(displayName(tracks[(state.currentTrackIndex + 1) % tracks.length]))
          }

          const pct = state.duration > 0 ? (state.elapsed / state.duration) * 100 : 0
          if (progressFillRef.current) {
            progressFillRef.current.style.width = `${pct}%`
          }
          if (elapsedRef.current)
            elapsedRef.current.textContent = formatTime(state.elapsed)
          if (durationRef.current) {
            const remaining = state.duration > 0 ? Math.max(0, state.duration - state.elapsed) : 0
            durationRef.current.textContent = `-${formatTime(remaining)}`

            // Filler button visibility
            if (fillerBtnRef.current) {
              const SHOW_WINDOW = 15
              let opacity = 0
              if (state.crossfading) {
                const xfadeElapsedMs = Date.now() - xfadeStartWallRef.current
                const halfwayMs = xfadeDurationMsRef.current / 2
                opacity = Math.max(0, 1 - xfadeElapsedMs / halfwayMs)
              } else if (remaining <= SHOW_WINDOW) {
                // Button is available - show at full opacity
                opacity = 1
              }
              fillerBtnRef.current.style.opacity = String(opacity)
              fillerBtnRef.current.style.pointerEvents = opacity < 0.05 ? 'none' : 'auto'
            }
          }

          const now = Date.now()
          if (now - lastPosSaveRef.current > 1000) {
            lastPosSaveRef.current = now
            savePlaybackPos({
              trackIndex: state.currentTrackIndex,
              elapsed: state.elapsed,
              savedAt: now,
            })
          }
          if (now - lastEnsureRef.current > 2000) {
            lastEnsureRef.current = now
            engine.ensurePlaying()
          }
        }
      }

      // ── Particle canvas drawing (from AboutOverlay.tsx) ──
      const canvas = canvasRef.current
      if (canvas) {
        const W = canvas.offsetWidth
        const H = canvas.offsetHeight
        if (W > 0 && H > 0) {
          if (canvas.width !== W || canvas.height !== H) {
            canvas.width = W
            canvas.height = H
            console.log('[CANVAS] Resized canvas - W:', W, 'H:', H)
          }
          const ctx = canvas.getContext('2d')
          if (ctx) {
            // Determine fill pct for canvas
            let pct = 0
            let elapsedSecs = 0
            // Use React state instead of engine.isInFillerMode() for consistency
            if (isFillerMode) {
              const fs = engine.getFillerState()
              if (fs) {
                pct = fs.duration > 0 ? (fs.elapsed / fs.duration) * 100 : 0
                elapsedSecs = fs.elapsed
              }
            } else {
              const state = engine.getPlaybackState()
              if (state) {
                pct = state.duration > 0 ? (state.elapsed / state.duration) * 100 : 0
                elapsedSecs = state.elapsed
              }
            }

            // Draw progress bar at bottom of canvas (canvas is 60vh tall, bar offset to align with original position)
            const barY = H - 51
            const filledW = W * pct / 100
            
            ctx.clearRect(0, 0, W, H)

            // Track (unfilled) — gray rectangle
            ctx.fillStyle = 'rgba(160,160,160,0.5)'
            ctx.fillRect(filledW > 0 ? filledW : 0, barY - 1.5, W - (filledW > 0 ? filledW : 0), 3)

            // Filled portion — gradient
            if (filledW > 0) {
              const grad = ctx.createLinearGradient(0, 0, filledW, 0)
              grad.addColorStop(0, 'rgba(100,60,200,0.6)')
              grad.addColorStop(0.6, 'rgba(210,90,255,0.9)')
              grad.addColorStop(0.88, 'rgba(255,160,255,1.0)')
              grad.addColorStop(1, 'rgba(255,240,255,1.0)')
              ctx.fillStyle = grad
              ctx.fillRect(0, barY - 1.5, filledW, 3)
            }

            // Emit particles at right edge of fill
            const isScrubbing = isScrubbingRef.current
            // Use ref instead of state to avoid stale closure values in RAF loop
            const isPausedNow = trainingPausedRef.current
            
            // Track state changes for particle emission adjustments
            const currentState = isScrubbing ? 'scrubbing' : (isPausedNow ? 'paused' : 'playing')
            if (currentState !== lastEmissionStateRef.current) {
              const emitInterval = isScrubbing ? 9 : isPausedNow ? 180 : 45
              console.log(`[PARTICLE] Emission state changed: ${lastEmissionStateRef.current} → ${currentState}, interval: ${emitInterval}ms`)
              lastEmissionStateRef.current = currentState
            }
            
            // 5× rate while scrubbing (9 ms), 1/4 rate while paused (180 ms), normal 45 ms
            const emitInterval = isScrubbing ? 9 : isPausedNow ? 180 : 45
            const now = Date.now()
            
            if (filledW > 2 && now - lastEmitRef.current > emitInterval) {
              lastEmitRef.current = now
              // Emit more particles when scrubbing (6), fewer when paused (1), normal (4)
              const particleCount = isScrubbing ? 6 : (isPausedNow && !isScrubbing ? 1 : 4)
              for (let i = 0; i < particleCount; i++) {
                const family = COLOR_FAMILIES[Math.floor(Math.random() * COLOR_FAMILIES.length)]
                let vx: number, vy: number
                if (isScrubbing && Math.random() < 2 / 3) {
                  // 2/3 of scrubbing particles shoot upward in 25° arc (±12.5° from vertical)
                  const baseSpeed = 0.4 + Math.random() * 1.8
                  const speed = baseSpeed * 1.5  // 50% faster when scrubbing
                  // ±12.5° = ±0.218 radians from straight up (-π/2)
                  const angleOffset = (Math.random() - 0.5) * 0.436  // ±12.5° in radians
                  const angle = -Math.PI / 2 + angleOffset
                  vx = Math.cos(angle) * speed * 0.5
                  vy = Math.sin(angle) * speed
                } else {
                  const goDown = Math.random() < 0.28
                  const speed = 0.4 + Math.random() * 1.8
                  const angle = goDown
                    ? (Math.PI * 0.3 + Math.random() * Math.PI * 0.6)
                    : (-Math.PI * 0.1 - Math.random() * Math.PI * 0.9)
                  // 50% velocity while paused (and not scrubbing)
                  const velMult = (isPausedNow && !isScrubbing) ? 0.5 : 1
                  vx = Math.cos(angle) * speed * 0.5 * velMult
                  vy = Math.sin(angle) * speed * velMult
                }
                particlesRef.current.push({
                  x: filledW + (Math.random() - 0.5) * 4,
                  y: barY + (Math.random() - 0.5) * 3,
                  vx,
                  vy,
                  life: 1.0,
                  maxLife: 0.5 + Math.random() * 1.2,
                  family,
                  size: 2 + Math.random() * 5,
                })
              }
            }

            // Update + draw particles
            const DT = 1 / 60
            // Allow particles to fall below canvas (removed p.y < H check)
            particlesRef.current = particlesRef.current.filter(
              p => p.life > 0 && p.y > -H * 0.5
            )
            for (const p of particlesRef.current) {
              p.life -= DT / p.maxLife
              p.vy += 0.06
              p.vx *= 0.97
              p.x += p.vx
              p.y += p.vy
              p.size *= 0.994
              if (p.life <= 0) continue
              const alpha = Math.max(0, p.life)
              const rGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size)
              rGrad.addColorStop(0,    `rgba(${hexToRgb(p.family.inner)},${alpha})`)
              rGrad.addColorStop(0.45, `rgba(${hexToRgb(p.family.mid)},${alpha * 0.65})`)
              rGrad.addColorStop(1,    `rgba(${hexToRgb(p.family.outer)},0)`)
              ctx.save()
              ctx.globalCompositeOperation = 'screen'
              ctx.fillStyle = rGrad
              ctx.beginPath()
              ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
              ctx.fill()
              ctx.restore()
            }

            // Draw scrub-position time label well above the title (above finger)
            if (isScrubbing) {
              const m = Math.floor(elapsedSecs / 60)
              const sRem = elapsedSecs % 60
              const sInt = Math.floor(sRem)
              const tenths = Math.floor((sRem - sInt) * 10)
              const timeStr = `${m}:${sInt.toString().padStart(2, '0')}.${tenths}`
              const labelX = Math.min(Math.max(filledW, 22), W - 22)
              ctx.save()
              ctx.font = 'bold 13px sans-serif'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'bottom'
              ctx.shadowColor = 'rgba(0,0,0,0.85)'
              ctx.shadowBlur = 5
              ctx.fillStyle = 'rgba(255,255,255,0.95)'
              // Position 74px above progress bar (18% closer: 90 × 0.82 = 73.8)
              ctx.fillText(timeStr, labelX, barY - 74)
              ctx.restore()
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      xfadeTimersRef.current.forEach(clearTimeout)
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
      clearMediaSession()
      void releaseWakeLock()
      engine.stop()
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers (from Playback.tsx, unchanged) ───────────────────────────

  function handleChangeSong() {
    // Use React state instead of engine.getCurrentIndex() for consistency
    setStoppedAtIndex(currentIndex)
    setIsChangeSongMode(true)
    setIsPanelOpen(true)
  }

  function handleStopButton() {
    setShowFadePicker(true)
  }



  function handleFadeNow() {
    setShowFadePicker(false)
    engineRef.current.fadeOutNow()
    setIsFadeOut(true)
    setFadeOutFinalIndex(engineRef.current.getCurrentIndex())
  }

  function handleFadeAfterThis() {
    setShowFadePicker(false)
    const engine = engineRef.current
    engine.fadeOutAfterThisSong()
    setIsFadeOut(true)
    setFadeAfterThis(true)
    setFadeOutFinalIndex(engine.getFadeOutFinalIndex())
  }

  function handleCancelFadeOut() {
    engineRef.current.cancelFadeOut()
    setIsFadeOut(false)
    setFadeAfterThis(false)
    setFadeOutFinalIndex(-1)
  }

  function handleRestartFrom(index: number) {
    setPendingAction({ type: 'restart', index, name: displayName(tracks[index]) })
  }

  function handleSkipToEnd() {
    const engine = engineRef.current
    const state = engine.getPlaybackState()
    const elapsed = state?.elapsed ?? 0
    const duration = state?.duration ?? 0
    if (duration > 0 && duration - elapsed <= 10) {
      // Already near end — jump to beginning of next track
      // Use React state instead of engine.getCurrentIndex() for consistency
      const nextIdx = (currentIndex + 1) % tracks.length
      engine.seekToTrackIndex(nextIdx, 0)
      setCurrentIndex(nextIdx)
      setNextUpIndex((nextIdx + 1) % tracks.length)
    } else {
      engine.seekToNearEnd(10)
    }
    setTrainingPaused(false)
  }

  function handleTrainingPause() {
    console.log('[PAUSE] handleTrainingPause called, trainingPaused:', trainingPaused)
    const engine = engineRef.current
    if (trainingPaused) {
      console.log('[PAUSE] Resuming playback')
      engine.resumePlayback()
      setTrainingPaused(false)
      trainingPausedRef.current = false  // Sync ref for RAF loop
      // Manual resume → lock scrubbing and cancel cooldown
      scrubStateRef.current = 'locked'
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current)
        cooldownTimerRef.current = null
      }
    } else {
      console.log('[PAUSE] Pausing playback')
      engine.pausePlayback()
      setTrainingPaused(true)
      trainingPausedRef.current = true  // Sync ref for RAF loop
    }
  }

  function handleTrainingRewind() {
    const engine = engineRef.current
    const state = engine.getPlaybackState()
    const elapsed = state?.elapsed ?? 0
    // Use React state instead of engine.isPaused() to avoid race condition
    const wasPaused = trainingPaused
    
    if (elapsed < 3) {
      // Near start — go to previous track
      // Use React state instead of engine.getCurrentIndex() for consistency
      const prevIdx = (currentIndex - 1 + tracks.length) % tracks.length
      engine.seekToTrackIndex(prevIdx, 0)
      setCurrentIndex(prevIdx)
      setNextUpIndex((prevIdx + 1) % tracks.length)
    } else {
      engine.seekToTrackStart()
    }
    
    // Resume playback after seek if it was paused
    if (wasPaused) {
      engine.resumePlayback()
      setTrainingPaused(false)
    }
  }

  function handleEnterFiller() {
    if (!fillerTrack) return
    const engine = engineRef.current
    // Use React state instead of engine.getCurrentIndex() for consistency
    const resumeNextIndex = (currentIndex + 1) % tracks.length
    fillerResumeIndexRef.current = resumeNextIndex
    fillerStartTimeRef.current = Date.now()
    setFillerElapsed(0)
    setIsFillerMode(true)
    void engine.enterFillerMode(fillerTrack, fillerOffsetRef.current, resumeNextIndex)
  }

  function handleExitFiller() {
    const engine = engineRef.current
    const { fillerOffset } = engine.exitFillerMode()
    fillerOffsetRef.current = fillerOffset
    saveFillerOffset(fillerOffset)
    setIsFillerMode(false)
    setFillerElapsed(0)
  }

  // ── Scrubbing (training mode state machine) ──────────────────────────────
  function handleProgressBarInteraction(clientX: number) {
    if (!trainingMode || scrubStateRef.current === 'locked') return
    if (!progressBarRef.current) return

    const engine = engineRef.current
    const state = engine.getPlaybackState()
    if (!state || state.duration === 0) return

    const rect = progressBarRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const pct = Math.max(0, Math.min(1, x / rect.width))
    const seekTime = pct * state.duration

    // Pass isActiveScrubbing=true so audio plays during drag
    engine.seek(seekTime, isScrubbingRef.current)
  }

  function handleProgressBarTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (!trainingMode) return
    if (scrubStateRef.current === 'locked') {
      // LOCKED → UNLOCKED: only when paused (prevents accidental swipes while playing)
      // Use React state instead of engine.isPaused() to avoid race condition
      if (!trainingPaused) return
      scrubStateRef.current = 'unlocked'
    } else if (scrubStateRef.current === 'cooldown') {
      // COOLDOWN → COOLDOWN: reset the 20s timer (allows scrubbing while playing within 20s window)
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
      cooldownTimerRef.current = null
    }
    e.stopPropagation()
    e.preventDefault()
    isScrubbingRef.current = true
    handleProgressBarInteraction(e.touches[0].clientX)
  }

  function handleProgressBarTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!isScrubbingRef.current) return
    e.stopPropagation() // Don't let screen handler see this
    e.preventDefault()
    handleProgressBarInteraction(e.touches[0].clientX)
  }

  function handleProgressBarTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    e.stopPropagation()
    e.preventDefault()
    isScrubbingRef.current = false
    if (!trainingMode || scrubStateRef.current === 'locked') return
    // Release: resume playback, transition to COOLDOWN with 20s timer
    const engine = engineRef.current
    // Use React state instead of engine.isPaused() to avoid race condition
    if (trainingPaused) {
      engine.resumePlayback()
      setTrainingPaused(false)
      trainingPausedRef.current = false  // Sync ref for RAF loop
    }
    scrubStateRef.current = 'cooldown'
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
    cooldownTimerRef.current = setTimeout(() => {
      scrubStateRef.current = 'locked'
      cooldownTimerRef.current = null
    }, 20000)
  }

  function handleProgressBarMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    console.log('[SCRUB-MOUSE] MouseDown - trainingMode:', trainingMode, 'scrubState:', scrubStateRef.current, 'paused:', trainingPaused)
    if (!trainingMode) return
    if (scrubStateRef.current === 'locked') {
      // LOCKED → UNLOCKED: only when paused
      if (!trainingPaused) {
        console.log('[SCRUB-MOUSE] Blocked: not paused')
        return
      }
      console.log('[SCRUB-MOUSE] Unlocking scrubbing')
      scrubStateRef.current = 'unlocked'
    } else if (scrubStateRef.current === 'cooldown') {
      // COOLDOWN → COOLDOWN: reset the 20s timer
      console.log('[SCRUB-MOUSE] Resetting cooldown timer')
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
      cooldownTimerRef.current = null
    }
    isScrubbingRef.current = true
    handleProgressBarInteraction(e.clientX)
    
    const handleMouseMove = (me: MouseEvent) => {
      if (isScrubbingRef.current) handleProgressBarInteraction(me.clientX)
    }
    const handleMouseUp = () => {
      console.log('[SCRUB-MOUSE] MouseUp')
      isScrubbingRef.current = false
      if (trainingMode && scrubStateRef.current !== 'locked') {
        const eng = engineRef.current
        if (trainingPaused) {
          console.log('[SCRUB-MOUSE] Resuming playback after scrub')
          eng.resumePlayback()
          setTrainingPaused(false)
          trainingPausedRef.current = false  // Sync ref for RAF loop
        }
        scrubStateRef.current = 'cooldown'
        if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
        cooldownTimerRef.current = setTimeout(() => {
          scrubStateRef.current = 'locked'
          cooldownTimerRef.current = null
        }, 20000)
      }
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  function handleBackToPlaylist() {
    setPendingAction({ type: 'backToPlaylist' })
  }

  function handleConfirm() {
    if (!pendingAction) return
    const action = pendingAction
    setPendingAction(null)
    setIsPanelOpen(false)
    setIsChangeSongMode(false)
    clearPlaybackPos()
    if (action.type === 'restart') {
      const engine = engineRef.current
      setIsFadeOut(false)
      setFadeAfterThis(false)
      setFadeOutFinalIndex(-1)
      engine.crossfadeTo(action.index)
    } else {
      engineRef.current.stop()
      onStopRef.current()
    }
  }

  function handleCancelConfirm() {
    setPendingAction(null)
  }

  async function handleResume() {
    if (!resumePos) return
    iosAudioUnlock()
    const engine = engineRef.current
    const idx = resumePos.trackIndex
    const elapsed = resumePos.elapsed
    setShowResume(false)
    onResumeConsumed?.()
    setCurrentIndex(idx)
    setNextUpIndex((idx + 1) % tracks.length)
    setDisplayTitle(displayName(tracks[idx]))
    await engine.start(tracks, idx, null, elapsed)
  }

  function handleTitleTouchEnd(e: React.TouchEvent) {
    e.stopPropagation()
    e.preventDefault()
    const now = Date.now()
    if (now - lastTapRef.current < 450) {
      onToggleTraining()
    }
    lastTapRef.current = now
  }

  function handleTitleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation()
    onToggleTraining()
  }

  function handleScreenTouchStart(e: React.TouchEvent) {
    // If scrubbing is enabled (training mode + unlocked/cooldown, or about to unlock when paused) and touch is on progress bar, let it through
    if (trainingMode && (scrubStateRef.current !== 'locked' || engineRef.current.isPaused()) && progressBarRef.current) {
      const touch = e.touches[0]
      const rect = progressBarRef.current.getBoundingClientRect()
      
      console.log('[SCRUB] handleScreenTouchStart - checking bounds', {
        touchX: touch.clientX,
        touchY: touch.clientY,
        rectLeft: rect.left,
        rectRight: rect.right,
        rectTop: rect.top,
        rectBottom: rect.bottom
      })
      
      // Check if touch is within the progress bar area
      if (
        touch.clientX >= rect.left &&
        touch.clientX <= rect.right &&
        touch.clientY >= rect.top &&
        touch.clientY <= rect.bottom
      ) {
        // Touch is on progress bar - don't toggle controls, let scrubbing handle it
        console.log('[SCRUB] Touch on progress bar - bypassing controls toggle')
        e.stopPropagation() // Prevent event from bubbling up
        return
      }
    }
    
    if (!controlsVisible) {
      controlsJustShownRef.current = true
      showControls()
    } else {
      controlsJustShownRef.current = false
    }
  }

  function handleScreenClick() {
    if (controlsVisible && !controlsJustShownRef.current) {
      hideControlsNow()
    } else if (!controlsVisible) {
      showControls()
    }
    controlsJustShownRef.current = false
  }

  // ── Derived values ────────────────────────────────────────────────────
  const currentTrack = tracks[currentIndex]
  const nextTrack = tracks[nextUpIndex]
  const isOnLastTrack = currentIndex === tracks.length - 1 && tracks.length > 1
  const nextUpLabel =
    isFadeOut && nextUpIndex === fadeOutFinalIndex ? 'FINAL SONG' : 'NEXT UP'
  const loopBadgeLabel = isFadeOut ? '↓  ENDING SOON' : '∞  LOOPING'
  void currentTrack; void nextTrack; void isOnLastTrack; void nextUpLabel; void loopBadgeLabel

  // ── Resume screen (shown as overlay on top of splash) ────────────────
  if (showResume && resumePos) {
    const trackName = displayName(tracks[resumePos.trackIndex])
    return (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 10000 }}
        onClick={handleScreenClick}
      >
        {/* Background */}
        <img
          src="/WitchDance/WitchDance.jpg"
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
        {/* Version number at top */}
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0, 0, 0, 0.85)',
          color: 'white',
          padding: '8px 24px',
          borderRadius: '8px',
          fontSize: '1.5rem',
          fontWeight: 600,
          letterSpacing: '0.05em',
          zIndex: 2,
        }}>
          v1.0-{__COMMIT_HASH__}
        </div>
        {/* Resume content */}
        <div className="screen resume-screen" style={{ position: 'relative', zIndex: 1 }}>
          <div className="resume-content">
            <p className="resume-label">RESUMING</p>
            <h2 className="resume-track-name">{trackName}</h2>
            <p className="resume-hint">Tap to continue where you left off</p>
            <button className="btn-resume" onClick={() => void handleResume()}>
              ▶  Resume
            </button>
            <button className="btn-resume-cancel" onClick={() => {
              clearPlaybackPos()
              setShowResume(false)
              onResumeConsumed?.()
              void engineRef.current.start(tracks, 0, null)
            }}>
              Start from beginning
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'hidden',
      }}
      onClick={handleScreenClick}
      onTouchStart={handleScreenTouchStart}
    >
      {/* Background image */}
      <img
        src="/WitchDance/WitchDance.jpg"
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center',
        }}
      />

      {/* Dark tint */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />

      {/* Title PNG + version + training row */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 'max(env(safe-area-inset-top), 0px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* PNG wrapper — double-tap zone covers top 80% */}
        <div style={{ position: 'relative', width: '100%', maxWidth: '480px' }}>
          <img
            src="/WitchDance/WitchDance.png"
            alt="WitchDance"
            style={{
              width: '100%',
              display: 'block',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            } as React.CSSProperties}
            draggable={false}
          />
          <div
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '80%' }}
            onDoubleClick={handleTitleDoubleClick}
            onTouchEnd={handleTitleTouchEnd}
          />
        </div>

        {/* Version label + hint text — same baseline, left/right */}
        <div style={{
          width: '100%',
          maxWidth: '480px',
          paddingLeft: '22px',
          paddingRight: '17px',
          marginTop: '-14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}>
          <span style={{
            fontSize: '0.65rem',
            fontFamily: 'monospace',
            color: 'rgba(255,255,255,0.45)',
            letterSpacing: '0.04em',
          }}>
            v1.0-{__COMMIT_HASH__}
          </span>
          {!trainingMode && (
            <span style={{
              fontSize: '0.65rem',
              fontFamily: 'monospace',
              color: 'rgba(255,255,255,0.45)',
              letterSpacing: '0.04em',
            }}>
              (double tap for training mode)
            </span>
          )}
          {trainingMode && (
            <span style={{
              fontSize: '0.65rem',
              fontFamily: 'monospace',
              color: 'rgba(255,255,255,0.45)',
              letterSpacing: '0.04em',
            }}>
              (double tap for performance mode)
            </span>
          )}
        </div>

        {/* Training mode row — always visible when on */}
        <div
          style={{
            width: '100%',
            maxWidth: '480px',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingLeft: '12px',
            paddingRight: '12px',
            marginTop: '2px',
            opacity: trainingMode ? 1 : 0,
            transition: 'opacity 0.3s ease',
            pointerEvents: trainingMode ? 'auto' : 'none',
          }}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <p style={{
            color: 'rgba(255,200,80,1)',
            fontSize: '0.85rem',
            fontFamily: 'monospace',
            margin: 0,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          }}>
            Training Mode
          </p>
          <div style={{ display: 'flex', flexDirection: 'row', gap: '6px' }}>
            {(() => {
              const btnStyle: React.CSSProperties = {
                background: 'rgba(20,16,4,0.85)',
                border: '1px solid rgba(255,200,80,0.35)',
                borderRadius: '8px',
                width: '44px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                WebkitTapHighlightColor: 'transparent',
              }
              const Y = 'rgba(255,200,80,1)'
              return (<>
                {/* Rewind to start */}
                <button aria-label="Rewind" style={btnStyle}
                  onClick={(e) => { e.stopPropagation(); handleTrainingRewind() }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <rect x="2" y="3" width="3" height="14" rx="1.2" fill={Y}/>
                    <polygon points="18,3 18,17 7,10" fill={Y}/>
                  </svg>
                </button>
                {/* Pause / Play */}
                <button aria-label="Pause/Play" style={btnStyle}
                  onClick={(e) => { e.stopPropagation(); handleTrainingPause() }}>
                  {trainingPaused
                    ? <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <polygon points="4,2 4,18 17,10" fill={Y}/>
                      </svg>
                    : <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <rect x="3" y="3" width="5" height="14" rx="1.8" fill={Y}/>
                        <rect x="12" y="3" width="5" height="14" rx="1.8" fill={Y}/>
                      </svg>
                  }
                </button>
                {/* Skip to end */}
                <button aria-label="Skip to End" style={btnStyle}
                  onClick={(e) => { e.stopPropagation(); handleSkipToEnd() }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <polygon points="2,3 2,17 13,10" fill={Y}/>
                    <rect x="15" y="3" width="3" height="14" rx="1.2" fill={Y}/>
                  </svg>
                </button>
              </>)
            })()}
          </div>
        </div>
      </div>

      {/* Bottom info section — song title, progress bar, next up */}
      <div style={{
        position: 'absolute',
        bottom: '1.5em',
        left: 0,
        right: 0,
        zIndex: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        padding: '0 24px',
        pointerEvents: 'auto', // Changed from 'none' to allow progress bar touches
      }}>
        {/* Song name */}
        <p style={{
          color: 'white',
          fontSize: '1.1rem',
          fontWeight: 600,
          margin: 0,
          width: '100%',
          textAlign: 'center',
          textShadow: '0 1px 6px rgba(0,0,0,0.9)',
          position: 'relative',
          zIndex: 1, // Below progress bar in stacking context
          marginBottom: '-1.2em',
          transform: 'translateY(1.1em)', // Move title down by ~1 line height
          pointerEvents: 'none', // Text shouldn't block touches
        }}>
          {isFillerMode
            ? (fillerTrack ? displayName(fillerTrack) : '')
            : currentTrackName}
        </p>

        {/* Elapsed / countdown flank the bar — only when controls are visible */}
        <div 
          ref={progressBarRef}
          style={{
            height: '50px', // Larger touch target
            width: '100%',
            position: 'relative',
            zIndex: 3, // Above title in stacking context to ensure touches reach it
            cursor: (trainingMode && (scrubStateRef.current !== 'locked' || engineRef.current.isPaused())) ? 'pointer' : 'default',
          }}
          onTouchStart={handleProgressBarTouchStart}
          onTouchMove={handleProgressBarTouchMove}
          onTouchEnd={handleProgressBarTouchEnd}
          onMouseDown={handleProgressBarMouseDown}
        >
          {/* Elapsed left, countdown right — overlaid on top of canvas area */}
          <span
            ref={elapsedRef}
            style={{
              position: 'absolute',
              left: -20,
              top: '3px',
              fontSize: '0.7rem',
              color: 'rgba(255,255,255,0.7)',
              fontFamily: 'monospace',
              opacity: controlsVisible ? 1 : 0,
              transition: 'opacity 0.3s ease',
              pointerEvents: 'none',
            }}
          >
            0:00
          </span>
          <span
            ref={durationRef}
            style={{
              position: 'absolute',
              right: -20,
              top: '3px',
              fontSize: '0.7rem',
              color: 'rgba(255,255,255,0.7)',
              fontFamily: 'monospace',
              opacity: controlsVisible ? 1 : 0,
              transition: 'opacity 0.3s ease',
              pointerEvents: 'none',
            }}
          >
            0:00
          </span>
        </div>

        {/* Next up */}
        {nextTrackName && (
          <p style={{
            color: 'rgba(255,255,255,0.88)',
            fontSize: '0.8rem',
            margin: 0,
            marginTop: 'calc(0.5em - 20px)',
            width: '100%',
            textAlign: 'center',
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            position: 'relative',
            zIndex: 2,
          }}>
            <span style={{ opacity: 0.75, fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Next up </span>
            {nextTrackName}
          </p>
        )}

      </div>

      {/* Filler mode centered overlay */}
      {isFillerMode && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            pointerEvents: 'auto',
          }}>
            <p style={{
              color: 'rgba(255,200,80,1)',
              fontSize: '0.85rem',
              fontFamily: 'monospace',
              margin: 0,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              textShadow: '0 1px 4px rgba(0,0,0,0.9)',
            }}>
              FILLER MODE
            </p>
            <button
              className="btn-resume-playlist"
              onClick={(e) => { e.stopPropagation(); handleExitFiller() }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                paddingTop: '20px',
                paddingBottom: '20px',
              }}
            >
              <div style={{
                color: 'white',
                fontSize: '0.95rem',
                fontWeight: 500,
                letterSpacing: '0.05em',
              }}>
                Fill: {Math.floor(fillerElapsed / 60)}:{String(fillerElapsed % 60).padStart(2, '0')}
              </div>
              <div style={{ fontSize: '1.5rem' }}>
                ▶&nbsp;&nbsp;Resume Performance
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Particle canvas — extends from near top to screen bottom */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: '24px',  // Match container padding
          right: '24px',  // Match container padding
          bottom: '0',  // Extend to screen bottom so particles can fall all the way down
          width: 'calc(100% - 48px)',  // Account for left+right padding
          height: '60vh',  // Taller canvas for particles to travel
          display: 'block',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* Progress bar div (for CSS class compatibility from Playback.tsx) */}
      <div style={{
        position: 'absolute',
        bottom: 'calc(2.2em + 1rem + 80px - 20px)',
        left: 0,
        right: 0,
        height: 0,
        zIndex: 0,
        pointerEvents: 'none',
      }}>
        <div ref={progressFillRef} style={{ display: 'none' }} />
      </div>

      {/* Credits — independently pinned to screen bottom */}
      <p style={{
        position: 'absolute',
        bottom: '0.3em',
        left: 0,
        right: 0,
        textAlign: 'center',
        color: 'white',
        fontSize: '0.76rem',
        fontWeight: 500,
        letterSpacing: '0.04em',
        textShadow: '0 1px 6px rgba(0,0,0,0.8)',
        opacity: 0.5,
        margin: 0,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 1,
      }}>
        Created by the Wayward Witches of Connecticut
      </p>

      {/* ── Cancel Fade button ────────── */}
      {isFadeOut && !isFillerMode && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(0.5em + 1rem + 30px + 48px)',
            left: 0,
            right: 0,
            zIndex: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '0 24px',
            gap: '12px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.85)',
              color: 'rgba(255, 255, 255, 0.95)',
              padding: '10px 20px',
              borderRadius: '8px',
              fontSize: '0.95rem',
              fontWeight: 500,
              textAlign: 'center',
              letterSpacing: '0.02em',
            }}
          >
            {fadeAfterThis ? 'Stopping performance after this song...' : 'Stopping performance now...'}
          </div>
          <button
            className="btn-cancel-fade"
            onClick={handleCancelFadeOut}
            disabled={isPanelOpen}
          >
            ↺  Resume Performance
          </button>
        </div>
      )}

      {/* ── Tap-reveal controls: Change Song, Stop ─────────── */}
      {!isFillerMode && !isFadeOut && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(0.5em + 1rem + 30px + 48px)',
            left: 0,
            right: 0,
            zIndex: 3,
            opacity: controlsVisible ? 1 : 0,
            transition: controlsVisible ? 'opacity 0.3s ease' : 'opacity 0.6s ease',
            pointerEvents: controlsVisible ? 'auto' : 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            padding: '0 24px',
          }}
          onClick={(e) => e.stopPropagation()}
        >

          <button
            className="btn-stop-immediate"
            onClick={handleChangeSong}
            disabled={isPanelOpen}
          >
            Change Song...
          </button>
          <button
            ref={fillerBtnRef}
            className="btn-enter-filler"
            onClick={handleEnterFiller}
            disabled={isPanelOpen || !fillerTrack}
            style={{ opacity: 0, pointerEvents: 'none' }}
          >
            <svg width="20" height="18" viewBox="0 0 20 18" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 12, position: 'relative', top: -1 }}>
              <rect x="1" y="1" width="6" height="16" rx="2" fill="rgba(251,191,36,0.5)" />
              <rect x="13" y="1" width="6" height="16" rx="2" fill="rgba(251,191,36,0.5)" />
            </svg>
            Pause & Fill
          </button>
          <button
            className="btn-stop-immediate btn-destructive"
            onClick={handleStopButton}
            disabled={isPanelOpen}
            style={{ width: 'auto', paddingLeft: '2rem', paddingRight: '2rem', marginTop: '12px' }}
          >
            <svg width="20" height="18" viewBox="0 0 20 18" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 12, position: 'relative', top: -1 }}>
              <rect x="1" y="1" width="16" height="16" rx="2" fill="rgba(255,255,255,0.5)" />
            </svg>
            Stop Performance...
          </button>
        </div>
      )}

      {/* ── Restart selector panel────────────────────────────────────── */}
      {isPanelOpen && (
        <div 
          className="confirm-overlay" 
          style={{ zIndex: 4 }} 
          onClick={() => { setIsPanelOpen(false); setIsChangeSongMode(false) }}
        >
          <div
            className={`restart-panel visible`}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="restart-panel-header">RESTART FROM</p>
            <div className="restart-track-list">
              {tracks.map((track, idx) => (
                <button
                  key={track.id}
                  className={`restart-track-row${idx === stoppedAtIndex ? ' active' : ''}`}
                  onClick={() => void handleRestartFrom(idx)}
                >
                  <span className="restart-track-name">{displayName(track)}</span>
                  {idx === stoppedAtIndex && (
                    <span className="restart-track-playing">● playing</span>
                  )}
                </button>
              ))}
            </div>
            <div className="restart-panel-footer">
              {!isChangeSongMode && (
                <button className="btn-back-playlist btn-destructive" onClick={handleBackToPlaylist}>
                  ← Back to Playlist
                </button>
              )}
              <button className="btn-restart-cancel" onClick={() => { setIsPanelOpen(false); setIsChangeSongMode(false) }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm dialogs ───────────────────────────────────────────── */}
      {pendingAction && (
        <div className="confirm-overlay" style={{ zIndex: 5 }} onClick={(e) => e.stopPropagation()}>
          <div className="confirm-dialog">
            <p className="confirm-message">
              {pendingAction.type === 'restart'
                ? `Fade out now and immediately start "${pendingAction.name}"?`
                : 'Stop playback and go back to the playlist?'}
            </p>
            <div className="confirm-buttons">
              <button className="btn-confirm-cancel" onClick={handleCancelConfirm}>Cancel</button>
              <button className="btn-confirm-ok" onClick={() => void handleConfirm()}>Confirm</button>
            </div>
          </div>
        </div>
      )}



      {showFadePicker && (
        <div 
          className="confirm-overlay" 
          style={{ zIndex: 5 }} 
          onClick={() => setShowFadePicker(false)}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <div 
            className="confirm-dialog fade-picker-dialog" 
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <p className="confirm-message">End Performance:</p>
            <div className="fade-picker-options">
              <button className="btn-fade-option btn-fade-after" onClick={handleFadeAfterThis}>
                <span className="fade-option-title">After This Song</span>
                <span className="fade-option-desc">Finish this song, then fade to silence</span>
              </button>
              <button className="btn-fade-option btn-fade-now btn-destructive" onClick={handleFadeNow}>
                <span className="fade-option-title">Right Now</span>
                <span className="fade-option-desc">Fade this song to silence immediately</span>
              </button>
            </div>
            <button className="btn-confirm-cancel" onClick={() => setShowFadePicker(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
