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
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [isFadingToStop, setIsFadingToStop] = useState(false)
  const [stopFadeCountdown, setStopFadeCountdown] = useState(0)
  const stopFadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [stoppedAtIndex, setStoppedAtIndex] = useState(0)
  const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null)
  const [isFadeOut, setIsFadeOut] = useState(false)
  const [, setIsFadeAfterThis] = useState(false)
  const [fadeOutFinalIndex, setFadeOutFinalIndex] = useState(-1)
  const [showFadePicker, setShowFadePicker] = useState(false)
  const [isFillerMode, setIsFillerMode] = useState(false)
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

  const [showDebug, setShowDebug] = useState(false)
  const [debugLog, setDebugLog] = useState<string[]>([])
  const [trainingPaused, setTrainingPaused] = useState(false)

  // ── Tap-reveal controls state ───────────────────────────────────────────
  const [controlsVisible, setControlsVisible] = useState(false)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => {
      setControlsVisible(false)
    }, 4000)
  }, [])

  // Resume playback if training mode is turned off while paused
  useEffect(() => {
    if (!trainingMode && trainingPaused) {
      engineRef.current.resumePlayback()
      setTrainingPaused(false)
    }
  }, [trainingMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Direct-DOM refs for RAF (no re-renders at 60fps) ───────────────────
  const progressFillRef = useRef<HTMLDivElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const durationRef = useRef<HTMLSpanElement>(null)
  const fillerBtnRef = useRef<HTMLButtonElement>(null)
  const rafRef = useRef(0)
  const xfadeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const lastPosSaveRef = useRef(0)
  const lastEnsureRef = useRef(0)
  const xfadeStartWallRef = useRef(0)
  const xfadeDurationMsRef = useRef(0)

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
        updateMediaSession(
          tracks[idx]?.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') ?? 'WitchDance',
        )
      },
      onCrossfadeStart: (incomingIdx, durationMs) => {
        setIsCrossfading(true)
        xfadeStartWallRef.current = Date.now()
        xfadeDurationMsRef.current = durationMs
        startTitleAnimation(incomingIdx, durationMs)
      },
      onLoopEnd: () => onStopRef.current(),
      onDebugLog: () => setDebugLog(engine.getDebugLog()),
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
      if (engine.isInFillerMode()) {
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
              const FADE_IN_SECS = 2
              let opacity = 0
              if (state.crossfading) {
                const xfadeElapsedMs = Date.now() - xfadeStartWallRef.current
                const halfwayMs = xfadeDurationMsRef.current / 2
                opacity = Math.max(0, 1 - xfadeElapsedMs / halfwayMs)
              } else {
                opacity = Math.min(1, Math.max(0, (SHOW_WINDOW - remaining) / FADE_IN_SECS))
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
          }
          const ctx = canvas.getContext('2d')
          if (ctx) {
            // Determine fill pct for canvas
            let pct = 0
            if (engine.isInFillerMode()) {
              const fs = engine.getFillerState()
              if (fs) pct = fs.duration > 0 ? (fs.elapsed / fs.duration) * 100 : 0
            } else {
              const state = engine.getPlaybackState()
              if (state) pct = state.duration > 0 ? (state.elapsed / state.duration) * 100 : 0
            }

            const barY = 18
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
            const now = Date.now()
            if (filledW > 2 && now - lastEmitRef.current > 45) {
              lastEmitRef.current = now
              for (let i = 0; i < 4; i++) {
                const family = COLOR_FAMILIES[Math.floor(Math.random() * COLOR_FAMILIES.length)]
                const goDown = Math.random() < 0.28
                const speed = 0.4 + Math.random() * 1.8
                const angle = goDown
                  ? (Math.PI * 0.3 + Math.random() * Math.PI * 0.6)
                  : (-Math.PI * 0.1 - Math.random() * Math.PI * 0.9)
                particlesRef.current.push({
                  x: filledW + (Math.random() - 0.5) * 4,
                  y: barY + (Math.random() - 0.5) * 3,
                  vx: Math.cos(angle) * speed * 0.5,
                  vy: Math.sin(angle) * speed,
                  life: 1.0,
                  maxLife: 0.5 + Math.random() * 1.2,
                  family,
                  size: 2 + Math.random() * 5,
                })
              }
            }

            // Update + draw particles
            const DT = 1 / 60
            particlesRef.current = particlesRef.current.filter(
              p => p.life > 0 && p.y > -H * 0.5 && p.y < H
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
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      xfadeTimersRef.current.forEach(clearTimeout)
      if (stopFadeIntervalRef.current) clearInterval(stopFadeIntervalRef.current)
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
      clearMediaSession()
      void releaseWakeLock()
      engine.stop()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers (from Playback.tsx, unchanged) ───────────────────────────

  function handleChangeSong() {
    const engine = engineRef.current
    setStoppedAtIndex(engine.getCurrentIndex())
    setIsChangeSongMode(true)
    setIsPanelOpen(true)
  }

  function handleStopButton() {
    setShowStopConfirm(true)
  }

  function handleStopConfirm() {
    clearPlaybackPos()
    const fadeSecs = engineRef.current.fadeOutNow()
    const secs = Math.round(fadeSecs)
    setStopFadeCountdown(secs)
    setIsFadingToStop(true)
    setShowStopConfirm(false)
    if (stopFadeIntervalRef.current) clearInterval(stopFadeIntervalRef.current)
    let remaining = secs
    stopFadeIntervalRef.current = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        clearInterval(stopFadeIntervalRef.current!)
        stopFadeIntervalRef.current = null
        setStopFadeCountdown(0)
      } else {
        setStopFadeCountdown(remaining)
      }
    }, 1000)
  }

  function handleResumeFromStop() {
    engineRef.current.cancelFadeOut()
    setIsFadingToStop(false)
    if (stopFadeIntervalRef.current) {
      clearInterval(stopFadeIntervalRef.current)
      stopFadeIntervalRef.current = null
    }
  }

  function handleCancelStopConfirm() {
    setShowStopConfirm(false)
  }

  function handleFadeOut() {
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
    setIsFadeAfterThis(true)
    setFadeOutFinalIndex(engine.getFadeOutFinalIndex())
  }

  function handleCancelFadeOut() {
    engineRef.current.cancelFadeOut()
    setIsFadeOut(false)
    setIsFadeAfterThis(false)
    setFadeOutFinalIndex(-1)
  }

  function handleRestartFrom(index: number) {
    setPendingAction({ type: 'restart', index, name: displayName(tracks[index]) })
  }

  function handleSkipToEnd() {
    engineRef.current.seekToNearEnd(10)
    setTrainingPaused(false)
  }

  function handleTrainingPause() {
    const engine = engineRef.current
    if (engine.isPaused()) {
      engine.resumePlayback()
      setTrainingPaused(false)
    } else {
      engine.pausePlayback()
      setTrainingPaused(true)
    }
  }

  function handleTrainingRewind() {
    engineRef.current.seekToTrackStart()
    setTrainingPaused(false)
  }

  function handleEnterFiller() {
    if (!fillerTrack) return
    const engine = engineRef.current
    const resumeNextIndex = (engine.getCurrentIndex() + 1) % tracks.length
    fillerResumeIndexRef.current = resumeNextIndex
    setIsFillerMode(true)
    void engine.enterFillerMode(fillerTrack, fillerOffsetRef.current, resumeNextIndex)
  }

  function handleExitFiller() {
    const engine = engineRef.current
    const { fillerOffset } = engine.exitFillerMode()
    fillerOffsetRef.current = fillerOffset
    saveFillerOffset(fillerOffset)
    setIsFillerMode(false)
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
      setIsFadeAfterThis(false)
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

  function handleScreenTap() {
    if (!isFillerMode) showControls()
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
        onClick={handleScreenTap}
      >
        {/* Background */}
        <img
          src="/WitchDance/WitchDance.jpg"
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
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
      onClick={handleScreenTap}
      onTouchStart={handleScreenTap}
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
        onDoubleClick={handleTitleDoubleClick}
        onTouchEnd={handleTitleTouchEnd}
      >
        <img
          src="/WitchDance/WitchDance.png"
          alt="WitchDance"
          style={{
            width: '100%',
            maxWidth: '480px',
            display: 'block',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          } as React.CSSProperties}
          draggable={false}
        />

        {/* Version label — left-aligned under PNG */}
        <div style={{ width: '100%', maxWidth: '480px', paddingLeft: '12px', marginTop: '-4px' }}>
          <span style={{
            fontSize: '0.65rem',
            fontFamily: 'monospace',
            color: 'rgba(255,255,255,0.45)',
            letterSpacing: '0.04em',
          }}>
            v1.0-{__COMMIT_HASH__}
          </span>
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
            transition: 'opacity 0.6s ease',
            pointerEvents: trainingMode ? 'auto' : 'none',
          }}
          onTouchEnd={(e) => e.stopPropagation()}
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
            {[
              { icon: '⏮', label: 'Rewind', onClick: () => handleTrainingRewind() },
              { icon: trainingPaused ? '▶' : '⏸', label: 'Pause/Play', onClick: () => handleTrainingPause() },
              { icon: '⏭', label: 'Skip to End', onClick: () => handleSkipToEnd() },
            ].map(({ icon, label, onClick }) => (
              <button
                key={label}
                aria-label={label}
                onClick={(e) => { e.stopPropagation(); onClick() }}
                style={{
                  background: 'rgba(0,0,0,0.85)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'rgba(255,200,80,1)',
                  fontSize: '1.3rem',
                  width: '44px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                  WebkitTapHighlightColor: 'transparent',
                } as React.CSSProperties}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom info section — song title, spacer, next up */}
      <div style={{
        position: 'absolute',
        bottom: '0.5em',
        left: 0,
        right: 0,
        zIndex: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        padding: '0 24px',
        pointerEvents: 'none',
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
          zIndex: 2,
          marginBottom: '-1.2em',
        }}>
          {isFillerMode
            ? (fillerTrack ? displayName(fillerTrack) : '')
            : currentTrackName}
        </p>

        {/* Elapsed / countdown flank the bar — only when controls are visible */}
        <div style={{
          height: '30px',
          width: '100%',
          position: 'relative',
        }}>
          {/* Elapsed left, countdown right — overlaid on top of canvas area */}
          <span
            ref={elapsedRef}
            style={{
              position: 'absolute',
              left: 0,
              top: '8px',
              fontSize: '0.7rem',
              color: 'rgba(255,255,255,0.7)',
              fontFamily: 'monospace',
              opacity: controlsVisible && !isFillerMode ? 1 : 0,
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
              right: 0,
              top: '8px',
              fontSize: '0.7rem',
              color: 'rgba(255,255,255,0.7)',
              fontFamily: 'monospace',
              opacity: controlsVisible && !isFillerMode ? 1 : 0,
              transition: 'opacity 0.3s ease',
              pointerEvents: 'none',
            }}
          >
            0:00
          </span>
        </div>

        {/* Next up */}
        {!isFillerMode && nextTrackName && (
          <p style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: '0.8rem',
            margin: 0,
            marginTop: '0.5em',
            width: '100%',
            textAlign: 'center',
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            position: 'relative',
            zIndex: 2,
          }}>
            <span style={{ opacity: 0.6, fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Next up </span>
            {nextTrackName}
          </p>
        )}

        {/* Filler mode: always-visible resume */}
        {isFillerMode && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'auto',
            marginTop: '0.5em',
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
            <p style={{
              color: 'rgba(255,255,255,0.5)',
              fontSize: '0.8rem',
              margin: 0,
              textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            }}>
              <span style={{ opacity: 0.6, fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Resumes: </span>
              {displayName(tracks[fillerResumeIndexRef.current])}
            </p>
            <button
              className="btn-resume-playlist"
              onClick={(e) => { e.stopPropagation(); handleExitFiller() }}
            >
              ▶&nbsp;&nbsp;Resume Playlist
            </button>
          </div>
        )}
      </div>

      {/* Particle canvas — full height so particles fall to screen bottom */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: 'calc(30px + 0.5em + 2rem)',
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
        opacity: 0.6,
        margin: 0,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 1,
      }}>
        Created by the Wayward Witches of Connecticut
      </p>

      {/* ── Always-visible Resume Playback (when fading to stop) ────────── */}
      {isFadingToStop && !isFillerMode && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(0.5em + 1rem + 30px + 20px)',
            left: 0,
            right: 0,
            zIndex: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '0 24px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="stop-fade-status">
            <p className="ending-subtitle">
              Fading out, returning to playlist{stopFadeCountdown > 0 ? ` in ${stopFadeCountdown}…` : '…'}
            </p>
            <button className="btn-cancel-fade" onClick={handleResumeFromStop}>
              ↺ Resume Playback
            </button>
          </div>
        </div>
      )}

      {/* ── Always-visible Cancel Fade (when fade-out active, not stop-fading) ── */}
      {isFadeOut && !isFadingToStop && !isFillerMode && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(0.5em + 1rem + 30px + 20px)',
            left: 0,
            right: 0,
            zIndex: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '0 24px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="btn-cancel-fade"
            onClick={handleCancelFadeOut}
            disabled={isPanelOpen}
          >
            ↺  Resume Playback
          </button>
        </div>
      )}

      {/* ── Tap-reveal controls: Fade Out, Change Song, Stop ─────────── */}
      {!isFillerMode && !isFadingToStop && !isFadeOut && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(0.5em + 1rem + 30px + 20px)',
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
            className="btn-fade-out"
            onClick={handleFadeOut}
            disabled={isPanelOpen}
          >
            Fade Out
            <svg width="36" height="14" viewBox="0 0 40 16" style={{ display:'inline-block', verticalAlign:'middle', marginLeft:10, position:'relative', top:-2 }}>
              <polygon points="0,0 0,16 40,16" fill="rgba(255,255,255,0.5)" />
            </svg>
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', width: '100%' }}>
                {fillerTrack && (
                  <button
                    ref={fillerBtnRef}
                    className="btn-enter-filler"
                    onClick={handleEnterFiller}
                    disabled={isPanelOpen}
                    style={{ opacity: 0, pointerEvents: 'none' }}
                  >
                    <svg width="20" height="18" viewBox="0 0 20 18" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 12, position: 'relative', top: -1 }}>
                      <rect x="1" y="1" width="6" height="16" rx="2" fill="rgba(251,191,36,0.5)" />
                      <rect x="13" y="1" width="6" height="16" rx="2" fill="rgba(251,191,36,0.5)" />
                    </svg>
                    Pause and Fill...
                  </button>
                )}
                <button
                  className="btn-stop-immediate"
                  onClick={handleChangeSong}
                  disabled={isPanelOpen}
                >
                  Change Song
                </button>
              </div>
              <button
                className="btn-stop-immediate btn-destructive"
                onClick={handleStopButton}
                disabled={isPanelOpen}
                style={{ width: 'auto', paddingLeft: '2rem', paddingRight: '2rem', marginTop: 'calc(56px + 6px)' }}
              >
                Stop
              </button>
        </div>
      )}

      {/* ── Restart selector panel────────────────────────────────────── */}
      <div
        className={`restart-panel${isPanelOpen ? ' visible' : ''}`}
        style={{ zIndex: 4 }}
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

      {showStopConfirm && (
        <div className="confirm-overlay" style={{ zIndex: 5 }} onClick={(e) => e.stopPropagation()}>
          <div className="confirm-dialog">
            <p className="confirm-message">Fade out and go back to playlist?</p>
            <div className="confirm-buttons">
              <button className="btn-confirm-cancel" onClick={handleCancelStopConfirm}>Cancel</button>
              <button className="confirm-btn btn-destructive" onClick={handleStopConfirm}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {showFadePicker && (
        <div className="confirm-overlay" style={{ zIndex: 5 }} onClick={() => setShowFadePicker(false)}>
          <div className="confirm-dialog fade-picker-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="confirm-message">How would you like to end the playlist?</p>
            <div className="fade-picker-options">
              <button className="btn-fade-option btn-fade-after" onClick={handleFadeAfterThis}>
                <span className="fade-option-title">Fade Out After This Song</span>
                <span className="fade-option-desc">Finish this song, then fade to silence</span>
              </button>
              <button className="btn-fade-option btn-fade-now btn-destructive" onClick={handleFadeNow}>
                <span className="fade-option-title">Fade Out Now</span>
                <span className="fade-option-desc">Fade this song to silence immediately</span>
              </button>
            </div>
            <button className="btn-confirm-cancel" onClick={() => setShowFadePicker(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Debug overlay (training mode only) ───────────────────────── */}
      {trainingMode && (
        <button
          onClick={(e) => { e.stopPropagation(); setDebugLog(engineRef.current.getDebugLog()); setShowDebug(v => !v) }}
          style={{
            position: 'fixed', bottom: 4, right: 4, zIndex: 9999,
            fontSize: 10, padding: '2px 6px', opacity: 0.4,
            background: '#333', color: '#fff', border: '1px solid #666', borderRadius: 4,
          }}
        >
          dbg
        </button>
      )}
      {showDebug && (
        <div style={{
          position: 'fixed', bottom: 30, right: 4, zIndex: 9999,
          background: 'rgba(0,0,0,0.85)', color: '#0f0', fontFamily: 'monospace',
          fontSize: 10, padding: '8px', borderRadius: 6, maxHeight: '50vh',
          overflowY: 'auto', width: '90vw', maxWidth: 400,
        }}
          onClick={(e) => e.stopPropagation()}
        >
          {debugLog.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </div>
  )
}
