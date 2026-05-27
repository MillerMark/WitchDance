import { useRef } from 'react'

interface Props {
  debugMode: boolean
  onClose: () => void
  onToggleDebug: () => void
}

export function AboutOverlay({ debugMode, onClose, onToggleDebug }: Props) {
  const lastTapRef = useRef<number>(0)

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
    const now = Date.now()
    if (now - lastTapRef.current < 350) {
      onToggleDebug()
    }
    lastTapRef.current = now
  }

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
        <p style={{
          color: 'white',
          fontSize: '0.85rem',
          fontFamily: 'monospace',
          marginTop: '8px',
          letterSpacing: '0.05em',
          opacity: 0.9,
          textShadow: '0 1px 4px rgba(0,0,0,0.8)',
        }}>
          {debugMode ? 'Debug mode: ON' : 'Debug mode: OFF'}
        </p>
      </div>

      {/* Bottom credit text */}
      <div style={{
        position: 'absolute',
        bottom: 'max(env(safe-area-inset-bottom), 24px)',
        left: 0,
        right: 0,
        textAlign: 'center',
        zIndex: 1,
        pointerEvents: 'none',
      }}>
        <p style={{
          color: 'white',
          fontSize: '0.95rem',
          fontWeight: 500,
          letterSpacing: '0.04em',
          textShadow: '0 1px 6px rgba(0,0,0,0.8)',
        }}>
          Created by the Wayward Witches of Connecticut
        </p>
      </div>
    </div>
  )
}
