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

export function AboutOverlay({ debugMode, onClose, onToggleDebug, engine, tracks }: Props) {
  const lastTapRef = useRef<number>(0)

  // Debug label: only visible briefly after toggle, hidden on open
  const prevDebugRef = useRef<boolean | null>(null)
  const [debugLabelVisible, setDebugLabelVisible] = useState(false)
  const debugTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live playback state
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const rafHandleRef = useRef(0)
  const particlesRef = useRef<Particle[]>([])
  const lastEmitRef = useRef(0)
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

  // RAF loop for live playback info + particle canvas
  useEffect(() => {
    if (!engine || !tracks?.length) return
    const tick = () => {
      const state = engine.getPlaybackState()
      if (state) {
        const pct = state.duration > 0 ? (state.elapsed / state.duration) * 100 : 0
        if (elapsedRef.current) elapsedRef.current.textContent = formatTime(state.elapsed)

        // Canvas particle bar
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
              const barY = H / 2
              const filledW = W * pct / 100

              ctx.clearRect(0, 0, W, H)

              // Track (unfilled) line
              ctx.fillStyle = 'rgba(255,255,255,0.12)'
              ctx.fillRect(0, barY - 1, W, 2)

              // Filled portion with purple glow gradient
              if (filledW > 0) {
                const grad = ctx.createLinearGradient(0, 0, filledW, 0)
                grad.addColorStop(0, 'rgba(80,50,150,0.4)')
                grad.addColorStop(0.7, 'rgba(180,80,240,0.7)')
                grad.addColorStop(1, 'rgba(255,180,255,0.95)')
                ctx.fillStyle = grad
                ctx.fillRect(0, barY - 1, filledW, 2)
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
                    ? (Math.PI * 0.3 + Math.random() * Math.PI * 0.6) // downward arc
                    : (-Math.PI * 0.1 - Math.random() * Math.PI * 0.9) // upward arc
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
                p => p.life > 0 && p.y > -H * 0.5 && p.y < H * 1.5
              )
              for (const p of particlesRef.current) {
                p.life -= DT / p.maxLife
                p.vy += 0.06  // light gravity / drift
                p.vx *= 0.97  // gentle deceleration
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
    e.preventDefault()
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

            {/* Elapsed time */}
            <div style={{
              color: 'rgba(255,255,255,0.55)',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
            }}>
              <span ref={elapsedRef}>0:00</span>
            </div>

            {/* Mystic particle canvas progress bar */}
            <div style={{
              width: '100%',
              maxWidth: '360px',
              height: '80px',
              position: 'relative',
              marginTop: '-8px',
              marginBottom: '-28px',
            }}>
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%', display: 'block' }}
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

        {/* Credit line — pinned to bottom */}
        <p style={{
          color: 'white',
          fontSize: '0.95rem',
          fontWeight: 500,
          letterSpacing: '0.04em',
          textShadow: '0 1px 6px rgba(0,0,0,0.8)',
          opacity: 0.6,
          margin: 0,
          whiteSpace: 'nowrap',
        }}>
          Created by the Wayward Witches of Connecticut
        </p>
      </div>
    </div>
  )
}
