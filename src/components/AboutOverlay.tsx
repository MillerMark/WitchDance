import { useRef, useState, useEffect } from 'react'
import type { AudioEngine } from '../audio/AudioEngine'
import type { Track } from '../types/track'

interface Props {
  debugMode: boolean
  onClose: () => void
  onToggleDebug: () => void
  engine?: AudioEngine | null
  tracks?: Track[]
}

function displayName(track: Track | undefined): string {
  if (!track) return ''
  return track.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatTime(secs: number): string {
  if (!isFinite(secs) || secs < 0) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AboutOverlay({ debugMode, onClose, onToggleDebug, engine, tracks }: Props) {
  const lastTapRef = useRef<number>(0)

  // Debug label: only visible briefly after toggle, hidden on open
  const prevDebugRef = useRef<boolean | null>(null)
  const [debugLabelVisible, setDebugLabelVisible] = useState(false)
  const debugTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live playback state
  const progressFillRef = useRef<HTMLDivElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const rafHandleRef = useRef(0)
  const lastTrackIdxRef = useRef(-1)
  const [currentTrackName, setCurrentTrackName] = useState('')
  const [nextTrackName, setNextTrackName] = useState('')

  // Detect debugMode changes after mount → show toast
  useEffect(() => {
    if (prevDebugRef.current === null) {
      prevDebugRef.current = debugMode
      return
    }
    prevDebugRef.current = debugMode
    setDebugLabelVisible(true)
    if (debugTimerRef.current) clearTimeout(debugTimerRef.current)
    debugTimerRef.current = setTimeout(() => setDebugLabelVisible(false), 3500)
    return () => {
      if (debugTimerRef.current) clearTimeout(debugTimerRef.current)
    }
  }, [debugMode])

  // RAF loop for live playback info
  useEffect(() => {
    if (!engine || !tracks?.length) return
    const tick = () => {
      const state = engine.getPlaybackState()
      if (state) {
        const pct = state.duration > 0 ? (state.elapsed / state.duration) * 100 : 0
        if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`
        if (elapsedRef.current) elapsedRef.current.textContent = formatTime(state.elapsed)
        if (state.currentTrackIndex !== lastTrackIdxRef.current) {
          lastTrackIdxRef.current = state.currentTrackIndex
          setCurrentTrackName(displayName(tracks[state.currentTrackIndex]))
          const nextIdx = (state.currentTrackIndex + 1) % tracks.length
          setNextTrackName(displayName(tracks[nextIdx]))
        }
      }
      rafHandleRef.current = requestAnimationFrame(tick)
    }
    // Init names immediately
    const initState = engine.getPlaybackState()
    if (initState) {
      lastTrackIdxRef.current = initState.currentTrackIndex
      setCurrentTrackName(displayName(tracks[initState.currentTrackIndex]))
      const nextIdx = (initState.currentTrackIndex + 1) % tracks.length
      setNextTrackName(displayName(tracks[nextIdx]))
    }
    rafHandleRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafHandleRef.current)
  }, [engine, tracks])

  function handleOverlayTouchEnd(e: React.TouchEvent) {
    // Only dismiss for taps directly on the backdrop, not the image area
    e.stopPropagation()
    onClose()
  }

  function handleOverlayClick(e: React.MouseEvent) {
    onClose()
    e.stopPropagation()
  }

  function handleTitleClick(e: React.MouseEvent) {
    e.stopPropagation()
  }

  function handleTitleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation()
    onToggleDebug()
  }

  function handleTitleTouchEnd(e: React.TouchEvent) {
    e.stopPropagation()
    e.preventDefault() // prevent ghost click from propagating to backdrop
    const now = Date.now()
    if (now - lastTapRef.current < 450) {
      onToggleDebug()
    }
    lastTapRef.current = now
  }

  const showPlayback = !!engine && !!tracks?.length

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: 'pointer',
      }}
      onClick={handleOverlayClick}
      onTouchEnd={handleOverlayTouchEnd}
    >
      {/* Background image stretched to fill */}
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

      {/* Dark tint for text legibility */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
      }} />

      {/* Title PNG — top-aligned, double-tap toggles debug */}
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
        onClick={handleTitleClick}
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
        {/* Debug mode toast — only visible briefly after toggle */}
        <p style={{
          color: 'white',
          fontSize: '0.85rem',
          fontFamily: 'monospace',
          marginTop: '-10px',
          letterSpacing: '0.05em',
          textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          opacity: debugLabelVisible ? 1 : 0,
          transition: 'opacity 0.4s ease',
          pointerEvents: 'none',
        }}>
          {debugMode ? 'Debug mode: ON' : 'Debug mode: OFF'}
        </p>
      </div>

      {/* Bottom section: Now Playing info + credit, stacked at the bottom */}
      <div style={{
        position: 'absolute',
        bottom: '1em',
        left: 0,
        right: 0,
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        padding: '0 24px',
        pointerEvents: 'none',
      }}>
        {/* Credit line */}
        <p style={{
          color: 'white',
          fontSize: '0.95rem',
          fontWeight: 500,
          letterSpacing: '0.04em',
          textShadow: '0 1px 6px rgba(0,0,0,0.8)',
          opacity: 0.8,
          margin: 0,
        }}>
          Created by the Wayward Witches of Connecticut
        </p>

        {/* Live playback info — only when music is playing */}
        {showPlayback && (
          <>
            {/* Next up */}
            {nextTrackName && (
              <p style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: '0.8rem',
                margin: 0,
                textAlign: 'center',
                textShadow: '0 1px 4px rgba(0,0,0,0.8)',
              }}>
                <span style={{ opacity: 0.6, fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Next up </span>
                {nextTrackName}
              </p>
            )}

            {/* Elapsed time only */}
            <div style={{
              color: 'rgba(255,255,255,0.55)',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
            }}>
              <span ref={elapsedRef}>0:00</span>
            </div>

            {/* Progress bar */}
            <div style={{
              width: '100%',
              maxWidth: '360px',
              height: '3px',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}>
              <div
                ref={progressFillRef}
                style={{
                  height: '100%',
                  width: '0%',
                  background: 'rgba(255,255,255,0.75)',
                  borderRadius: '2px',
                }}
              />
            </div>

            {/* Song name */}
            <p style={{
              color: 'white',
              fontSize: '1.1rem',
              fontWeight: 600,
              margin: 0,
              textAlign: 'center',
              textShadow: '0 1px 6px rgba(0,0,0,0.9)',
            }}>{currentTrackName}</p>
          </>
        )}
      </div>
    </div>
  )
}
