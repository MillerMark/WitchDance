import { useEffect, useRef, useState } from 'react'
import { AudioEngine } from '../audio/AudioEngine'
import type { Track } from '../types/track'
import { iosAudioUnlock } from '../audio/iosUnlock'
import { updateMediaSession, clearMediaSession, requestWakeLock, releaseWakeLock } from '../audio/mediaSession'
import { savePlaybackPos, clearPlaybackPos } from '../storage/playbackPos'
import { saveFillerOffset, loadFillerOffset } from '../storage/sessionState'


interface Props {
  tracks: Track[]
  audioCtx: AudioContext | null
  onStop: () => void
  resumePos?: { trackIndex: number; elapsed: number } | null
  onResumeConsumed?: () => void
  fillerTrack: Track | null
  debugMode?: boolean
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

type TitlePhase = 'stable' | 'dim' | 'swap'

export function Playback({ tracks, audioCtx, onStop, resumePos, onResumeConsumed, fillerTrack, debugMode, onEngineReady }: Props) {
  const engineRef = useRef(new AudioEngine())
  const onStopRef = useRef(onStop)
  useEffect(() => { onStopRef.current = onStop })
  useEffect(() => { onEngineReady?.(engineRef.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  type ConfirmAction =
    | { type: 'restart'; index: number; name: string }
    | { type: 'backToPlaylist' }

  // Playback UI state
  const [currentIndex, setCurrentIndex] = useState(resumePos ? resumePos.trackIndex : 0)
  const [nextUpIndex, setNextUpIndex] = useState(
    resumePos
      ? (resumePos.trackIndex + 1) % tracks.length
      : tracks.length > 1 ? 1 : 0,
  )
  const [showResume, setShowResume] = useState(!!resumePos)
  const [isCrossfading, setIsCrossfading] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [isChangeSongMode, setIsChangeSongMode] = useState(false)
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [isFadingToStop, setIsFadingToStop] = useState(false)
  const [stopFadeCountdown, setStopFadeCountdown] = useState(0)
  const stopFadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [stoppedAtIndex, setStoppedAtIndex] = useState(0)
  const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null)
  const [isFadeOut, setIsFadeOut] = useState(false)
  const [isFadeAfterThis, setIsFadeAfterThis] = useState(false)
  const [fadeOutFinalIndex, setFadeOutFinalIndex] = useState(-1)
  const [showFadePicker, setShowFadePicker] = useState(false)

  // Title crossfade animation
  const [displayTitle, setDisplayTitle] = useState(
    resumePos ? displayName(tracks[resumePos.trackIndex]) : displayName(tracks[0])
  )
  const [incomingTitle, setIncomingTitle] = useState('')
  const [titlePhase, setTitlePhase] = useState<TitlePhase>('stable')
  const [nowPlayingDim, setNowPlayingDim] = useState(false)

  const [showDebug, setShowDebug] = useState(false)
  const [debugLog, setDebugLog] = useState<string[]>([])

  // Filler mode
  const [isFillerMode, setIsFillerMode] = useState(false)
  const fillerOffsetRef = useRef(loadFillerOffset())
  const lastFillerSaveRef = useRef(0)
  const fillerResumeIndexRef = useRef(0)

  // Direct-DOM refs for RAF updates (no re-renders at 60fps)
  const progressFillRef = useRef<HTMLDivElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const durationRef = useRef<HTMLSpanElement>(null)
  const fillerBtnRef = useRef<HTMLButtonElement>(null)
  const rafRef = useRef(0)
  const xfadeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const lastPosSaveRef = useRef(0)
  const lastEnsureRef = useRef(0)
  // Crossfade timing for filler-button visibility
  const xfadeStartWallRef = useRef(0)
  const xfadeDurationMsRef = useRef(0)

  function startTitleAnimation(incomingIdx: number, durationMs: number) {
    xfadeTimersRef.current.forEach(clearTimeout)
    xfadeTimersRef.current = []

    const inName = displayName(tracks[incomingIdx])
    const half = durationMs / 2

    setIncomingTitle(inName)
    setTitlePhase('dim')
    setNowPlayingDim(true)

    // Midpoint: swap titles + update next-up
    xfadeTimersRef.current.push(
      setTimeout(() => {
        setTitlePhase('swap')
        setNextUpIndex((incomingIdx + 1) % tracks.length)
      }, half),
    )

    // End: settle on new track
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

  // Mount: wire engine and start playback
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
    // If resumePos is set, don't auto-start — wait for user tap (iOS gesture requirement)
    void requestWakeLock()

    const tick = () => {
      const state = engine.getPlaybackState()
      if (state) {
        if (progressFillRef.current) {
          const pct =
            state.duration > 0
              ? (state.elapsed / state.duration) * 100
              : 0
          progressFillRef.current.style.width = `${pct}%`
        }
        if (elapsedRef.current)
          elapsedRef.current.textContent = formatTime(state.elapsed)
        if (durationRef.current) {
          const remaining = state.duration > 0 ? Math.max(0, state.duration - state.elapsed) : 0
          durationRef.current.textContent = `-${formatTime(remaining)}`

          // Filler button visibility: fade in at 15s remaining, fade out at xfade midpoint
          if (fillerBtnRef.current) {
            const SHOW_WINDOW = 15
            const FADE_IN_SECS = 2
            let opacity = 0
            if (state.crossfading) {
              const xfadeElapsedMs = Date.now() - xfadeStartWallRef.current
              const halfwayMs = xfadeDurationMsRef.current / 2
              // Fade out from 1→0 over the first half of the crossfade
              opacity = Math.max(0, 1 - xfadeElapsedMs / halfwayMs)
            } else {
              // Fade in: 0 at 15s remaining, 1 at (15-FADE_IN_SECS)s remaining
              opacity = Math.min(1, Math.max(0, (SHOW_WINDOW - remaining) / FADE_IN_SECS))
            }
            fillerBtnRef.current.style.opacity = String(opacity)
            fillerBtnRef.current.style.pointerEvents = opacity < 0.05 ? 'none' : 'auto'
          }
        }

        // Throttle position saves to once per second
        const now = Date.now()
        if (now - lastPosSaveRef.current > 1000) {
          lastPosSaveRef.current = now
          savePlaybackPos({
            trackIndex: state.currentTrackIndex,
            elapsed: state.elapsed,
            savedAt: now,
          })
        }

        // Soft recovery: re-kick _mediaEl if it stalled (iOS Safari edge case)
        if (now - lastEnsureRef.current > 2000) {
          lastEnsureRef.current = now
          engine.ensurePlaying()
        }
      }

      // Save filler offset periodically while in filler mode
      if (engine.isInFillerMode()) {
        const off = engine.getFillerOffset()
        fillerOffsetRef.current = off
        const now = Date.now()
        if (now - lastFillerSaveRef.current > 2000) {
          lastFillerSaveRef.current = now
          saveFillerOffset(off)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      xfadeTimersRef.current.forEach(clearTimeout)
      if (stopFadeIntervalRef.current) clearInterval(stopFadeIntervalRef.current)
      clearMediaSession()
      void releaseWakeLock()
      engine.stop()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  const currentTrack = tracks[currentIndex]
  const nextTrack = tracks[nextUpIndex]
  const isOnLastTrack = currentIndex === tracks.length - 1 && tracks.length > 1
  const nextUpLabel =
    isFadeOut && nextUpIndex === fadeOutFinalIndex ? 'FINAL SONG' : 'NEXT UP'
  const loopBadgeLabel = isFadeOut ? '↓  ENDING SOON' : '∞  LOOPING'

  if (showResume && resumePos) {
    const trackName = displayName(tracks[resumePos.trackIndex])
    return (
      <div className="screen resume-screen">
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
    )
  }

  return (
    <div className="screen playback">
      {/* ── NOW PLAYING / FILLER MODE zone ───────────────── */}
      {isFillerMode ? (
        <div className="playback-upper filler-mode-upper">
          <p className="filler-mode-label">FILLER MODE</p>
          <div className="playback-title-zone">
            <h1 className="filler-mode-track-name">{displayName(fillerTrack!)}</h1>
          </div>
          <p className="filler-mode-hint">Playlist is paused</p>
        </div>
      ) : (
      <div className={`playback-upper${isPanelOpen ? ' stopped' : ''}`}>
        <p
          className={`playback-now-playing-label${
            nowPlayingDim ? ' dim' : ''
          }`}
        >
          NOW PLAYING
        </p>

        <div className="playback-title-zone">
          <h1
            className={`playback-title-current${
              titlePhase === 'dim' ? ' phase-dim' : ''
            }${titlePhase === 'swap' ? ' phase-gone' : ''}`}
          >
            {displayTitle || displayName(currentTrack)}
          </h1>
          {incomingTitle && (
            <h1
              className={`playback-title-incoming${
                titlePhase === 'swap' ? ' phase-in' : ''
              }`}
            >
              {incomingTitle}
            </h1>
          )}
        </div>

        <div className="playback-progress-track">
          <div ref={progressFillRef} className="playback-progress-fill" />
        </div>
        <div className="playback-time-row">
          <span ref={elapsedRef} className="playback-time">
            0:00
          </span>
          <span ref={durationRef} className="playback-time">
            0:00
          </span>
        </div>
      </div>
      )}

      <div className="playback-divider" />

      {/* ── NEXT UP zone ─────────────────────────────────── */}
      <div className="playback-next">
        {isFillerMode ? (
          <>
            <p className="playback-next-label filler-resume-label">RESUMES AFTER FILLER</p>
            <p className="playback-next-title">{displayName(tracks[fillerResumeIndexRef.current])}</p>
          </>
        ) : isFadeAfterThis ? (
          <>
            <p className="playback-next-label ending-label">■  ENDING AFTER THIS SONG</p>
            <p className="playback-next-title ending-subtitle">Fading to silence…</p>
          </>
        ) : (
          <>
            <p className="playback-next-label">{nextUpLabel}</p>
            <p className="playback-next-title">{displayName(nextTrack)}</p>
            {isOnLastTrack && !isCrossfading && (
              <p className="playback-loops-annotation">↩  loops to first</p>
            )}
          </>
        )}
      </div>

      <div className="playback-divider" />

      {/* ── Status badges ────────────────────────────────── */}
      <div className="playback-status">
        <span className="playback-badge loop-badge">{loopBadgeLabel}</span>
        <span
          className={`playback-badge xfade-badge${
            isCrossfading ? ' visible' : ''
          }`}
        >
          ↝  CROSSFADE
        </span>
      </div>

      {/* ── Sticky footer ────────────────────────────────── */}
      <div className="playback-footer">
        {isFillerMode ? (
          <button className="btn-resume-playlist" onClick={handleExitFiller}>
            ▶&nbsp;&nbsp;Resume Playlist
          </button>
        ) : isFadingToStop ? (
          <div className="stop-fade-status">
            <p className="ending-subtitle">
              Fading out, returning to playlist{stopFadeCountdown > 0 ? ` in ${stopFadeCountdown}…` : '…'}
            </p>
            <button className="btn-cancel-fade" onClick={handleResumeFromStop}>
              ↺ Resume Playback
            </button>
          </div>
        ) : (
          <>
            {isFadeOut ? (
              <button
                className="btn-cancel-fade"
                onClick={handleCancelFadeOut}
                disabled={isPanelOpen}
              >
                ↺  Resume Playback
              </button>
            ) : (
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
            )}
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
            {debugMode && (
            <button
              className="btn-test-skip"
              onClick={handleSkipToEnd}
              disabled={isPanelOpen}
            >
              ⏭ Skip to End
            </button>
            )}
          </>
        )}
      </div>

      {/* ── Restart selector (slides up on Stop) ─────────── */}
      <div className={`restart-panel${isPanelOpen ? ' visible' : ''}`}>
        <p className="restart-panel-header">RESTART FROM</p>
        <div className="restart-track-list">
          {tracks.map((track, idx) => (
            <button
              key={track.id}
              className={`restart-track-row${
                idx === stoppedAtIndex ? ' active' : ''
              }`}
              onClick={() => void handleRestartFrom(idx)}
            >
              <span className="restart-track-name">
                {displayName(track)}
              </span>
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

      {pendingAction && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p className="confirm-message">
              {pendingAction.type === 'restart'
                ? `Fade out now and immediately start "${pendingAction.name}"?`
                : 'Stop playback and go back to the playlist?'}
            </p>
            <div className="confirm-buttons">
              <button className="btn-confirm-cancel" onClick={handleCancelConfirm}>
                Cancel
              </button>
              <button className="btn-confirm-ok" onClick={() => void handleConfirm()}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {showStopConfirm && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p className="confirm-message">Fade out and go back to playlist?</p>
            <div className="confirm-buttons">
              <button className="btn-confirm-cancel" onClick={handleCancelStopConfirm}>
                Cancel
              </button>
              <button className="confirm-btn btn-destructive" onClick={handleStopConfirm}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {showFadePicker && (
        <div className="confirm-overlay" onClick={() => setShowFadePicker(false)}>
          <div className="confirm-dialog fade-picker-dialog" onClick={e => e.stopPropagation()}>
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
            <button className="btn-confirm-cancel" onClick={() => setShowFadePicker(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Debug overlay ────────────────────────────────── */}
      {debugMode && (
      <button
        onClick={() => { setDebugLog(engineRef.current.getDebugLog()); setShowDebug(v => !v) }}
        style={{
          position: 'fixed', bottom: 4, right: 4, zIndex: 9999,
          fontSize: 10, padding: '2px 6px', opacity: 0.4,
          background: '#333', color: '#fff', border: '1px solid #666', borderRadius: 4,
        }}
      >
        DBG
      </button>
      )}

      {showDebug && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.92)',
          display: 'flex', flexDirection: 'column', padding: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: '#0f0', fontFamily: 'monospace', fontSize: 12 }}>AudioEngine Log</span>
            <button onClick={() => setShowDebug(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {debugLog.length === 0 ? (
              <p style={{ color: '#666', fontFamily: 'monospace', fontSize: 11 }}>No log entries yet.</p>
            ) : (
              debugLog.map((line, i) => (
                <div key={i} style={{ fontFamily: 'monospace', fontSize: 11, color: '#aef', marginBottom: 2, wordBreak: 'break-all' }}>{line}</div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
