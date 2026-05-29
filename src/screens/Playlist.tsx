import { useState, useCallback, useEffect, useRef } from 'react'
import type { Track } from '../types/track'
import { saveFillerTrackId } from '../storage/sessionState'
import { SwipeableRow } from '../components/SwipeableRow'

interface Props {
  tracks: Track[]
  onReorder: (tracks: Track[]) => void
  onBack: () => void
  onPlay: () => void
  library: Track[]
  fillerTrackId: string | null
  onFillerTrackChange: (id: string | null) => void
  fillVolume: number
  onFillVolumeChange: (volume: number) => void
}

interface DragState {
  trackId: string
  fromIndex: number
  toIndex: number
  startY: number
  rowHeight: number
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}

function formatTitle(name: string): string {
  return name
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function Playlist({ tracks, onReorder, onBack, onPlay, library, fillerTrackId, onFillerTrackChange, fillVolume, onFillVolumeChange }: Props) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [showFillerPicker, setShowFillerPicker] = useState(false)
  const dragHandleRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Stable refs so drag-move/end handlers never need listener re-attachment
  const dragRef = useRef<DragState | null>(null)
  const handleDragMoveRef = useRef<(e: PointerEvent) => void>(() => {})
  const handleDragEndRef = useRef<(e: PointerEvent) => void>(() => {})

  // ── Fill preview audio ──
  const previewCtxRef = useRef<AudioContext | null>(null)
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const previewGainRef = useRef<GainNode | null>(null)
  const previewTrackIdRef = useRef<string | null>(null)

  const visualTracks = drag
    ? moveItem(tracks, drag.fromIndex, drag.toIndex)
    : tracks

  const handleDragStart = useCallback(
    (e: PointerEvent, trackId: string) => {
      e.preventDefault()
      const target = e.currentTarget as HTMLButtonElement
      target.setPointerCapture(e.pointerId)
      const rowEl = target.closest('.playlist-row') as HTMLElement | null
      const rowHeight = rowEl?.getBoundingClientRect().height ?? 72
      const fromIndex = tracks.findIndex((t) => t.id === trackId)
      console.log('[DRAG START]', {
        trackId,
        fromIndex,
        pageY: e.pageY,
        clientY: e.clientY,
        scrollY: window.scrollY,
        rowHeight
      })
      setDrag({ trackId, fromIndex, toIndex: fromIndex, startY: e.pageY, rowHeight })
    },
    [tracks],
  )

  const handleDragMove = useCallback(
    (e: PointerEvent) => {
      if (!drag) return
      e.preventDefault()
      const deltaY = e.pageY - drag.startY
      const toIndex = Math.max(
        0,
        Math.min(tracks.length - 1, drag.fromIndex + Math.round(deltaY / drag.rowHeight)),
      )
      console.log('[DRAG MOVE]', {
        pageY: e.pageY,
        clientY: e.clientY,
        scrollY: window.scrollY,
        startY: drag.startY,
        deltaY,
        deltaRows: deltaY / drag.rowHeight,
        fromIndex: drag.fromIndex,
        toIndex,
        currentToIndex: drag.toIndex
      })
      if (toIndex !== drag.toIndex) {
        setDrag((prev) => (prev ? { ...prev, toIndex } : null))
      }
    },
    [drag, tracks.length],
  )

  const handleDragEnd = useCallback((e: PointerEvent) => {
    e.preventDefault()
    if (!drag) return
    console.log('[DRAG END]', {
      fromIndex: drag.fromIndex,
      toIndex: drag.toIndex,
      willReorder: drag.toIndex !== drag.fromIndex
    })
    if (drag.toIndex !== drag.fromIndex) {
      onReorder(moveItem(tracks, drag.fromIndex, drag.toIndex))
    }
    setDrag(null)
  }, [drag, tracks, onReorder])

  // Keep refs current on every render so stable event listeners always call the latest handlers
  dragRef.current = drag
  handleDragMoveRef.current = handleDragMove
  handleDragEndRef.current = handleDragEnd

  // Attach non-passive event listeners for drag handles.
  // IMPORTANT: deps must NOT include drag/handleDragMove/handleDragEnd — those change on every
  // drag-state update, which would remove/re-add listeners mid-drag. On iOS Safari, removing a
  // pointermove listener from an element with setPointerCapture releases the capture, causing all
  // subsequent events to miss the button entirely (looks like "stuck at 1 position"). Refs are
  // updated synchronously each render, so the stable closures always call the latest handlers.
  useEffect(() => {
    const handles = dragHandleRefs.current
    const cleanups: (() => void)[] = []
    
    handles.forEach((button, trackId) => {
      const onPointerDown = (e: PointerEvent) => handleDragStart(e, trackId)
      const onPointerMove = (e: PointerEvent) => {
        if (dragRef.current?.trackId === trackId) handleDragMoveRef.current(e)
      }
      const onPointerUp = (e: PointerEvent) => {
        if (dragRef.current?.trackId === trackId) handleDragEndRef.current(e)
      }
      const onPointerCancel = (e: PointerEvent) => {
        if (dragRef.current?.trackId === trackId) handleDragEndRef.current(e)
      }

      button.addEventListener('pointerdown', onPointerDown, { passive: false })
      button.addEventListener('pointermove', onPointerMove, { passive: false })
      button.addEventListener('pointerup', onPointerUp, { passive: false })
      button.addEventListener('pointercancel', onPointerCancel, { passive: false })

      cleanups.push(() => {
        button.removeEventListener('pointerdown', onPointerDown)
        button.removeEventListener('pointermove', onPointerMove)
        button.removeEventListener('pointerup', onPointerUp)
        button.removeEventListener('pointercancel', onPointerCancel)
      })
    })

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [tracks, handleDragStart])

  // ── Fill preview playback ──
  const stopPreview = useCallback(() => {
    if (previewSourceRef.current) {
      try {
        previewSourceRef.current.stop()
      } catch { /* already stopped */ }
      previewSourceRef.current = null
    }
    previewTrackIdRef.current = null
  }, [])

  const playPreview = useCallback(async (track: Track) => {
    stopPreview()
    previewTrackIdRef.current = track.id

    try {
      // Initialize AudioContext if needed
      if (!previewCtxRef.current) {
        previewCtxRef.current = new AudioContext()
        previewGainRef.current = previewCtxRef.current.createGain()
        previewGainRef.current.connect(previewCtxRef.current.destination)
      }

      const ctx = previewCtxRef.current
      const gainNode = previewGainRef.current!
      
      // Resume context if suspended
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      // Load and decode audio from File object
      const arrayBuffer = await track.file.arrayBuffer()
      const buffer = await ctx.decodeAudioData(arrayBuffer)

      // If track changed while loading, abort
      if (previewTrackIdRef.current !== track.id) return

      // Create and start source
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.connect(gainNode)
      gainNode.gain.value = fillVolume
      source.start(0)
      
      previewSourceRef.current = source
    } catch (err) {
      console.error('Failed to play preview:', err)
    }
  }, [stopPreview, fillVolume])

  const updatePreviewVolume = useCallback((volume: number) => {
    if (previewGainRef.current) {
      previewGainRef.current.gain.value = volume
    }
  }, [])

  // Clean up on unmount or when dialog closes
  useEffect(() => {
    if (!showFillerPicker) {
      stopPreview()
    } else if (fillerTrackId) {
      // Auto-play current filler when dialog opens
      const track = library.find((t) => t.id === fillerTrackId)
      if (track) {
        void playPreview(track)
      }
    }
    return () => stopPreview()
  }, [showFillerPicker, stopPreview]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFillerTrackSelect = useCallback((track: Track) => {
    onFillerTrackChange(track.id)
    saveFillerTrackId(track.id)
    void playPreview(track)
  }, [onFillerTrackChange, playPreview])

  const handleVolumeChange = useCallback((volume: number) => {
    onFillVolumeChange(volume)
    updatePreviewVolume(volume)
  }, [onFillVolumeChange, updatePreviewVolume])

  function handleRemove(trackId: string) {
    onReorder(tracks.filter((t) => t.id !== trackId))
  }

  const fillerTrack = library.find((t) => t.id === fillerTrackId) ?? null

  const n = tracks.length

  return (
    <div className="screen playlist">
      {/* ── Header ── */}
      <div className="playlist-header">
        <button className="btn-back" onClick={onBack} aria-label="Back to Library">
          ← Library
        </button>
        <h2 className="playlist-title">Your Playlist</h2>
      </div>

      {n === 0 ? (
        /* ── Empty state ── */
        <div className="playlist-empty-state">
          <p>No tracks yet</p>
          <button className="btn-back-link" onClick={onBack}>
            ← Library
          </button>
        </div>
      ) : (
        <>
          {/* ── Track list ── */}
          <div className="playlist-list">
            {visualTracks.map((track, visualIndex) => {
              const isDragging = drag?.trackId === track.id
              return (
                <SwipeableRow
                  key={track.id}
                  onDelete={() => handleRemove(track.id)}
                >
                  <div
                    className={`playlist-row${isDragging ? ' dragging' : ''}`}
                  >
                    {/* Drag handle */}
                    <button
                      ref={(el) => {
                        if (el) dragHandleRefs.current.set(track.id, el)
                        else dragHandleRefs.current.delete(track.id)
                      }}
                      className="drag-handle"
                      aria-label="Drag to reorder"
                    >
                      ≡
                    </button>

                    {/* Index */}
                    <div className="playlist-row-index">{visualIndex + 1}</div>

                    {/* Title */}
                    <div className="playlist-row-title">{formatTitle(track.name)}</div>
                  </div>
                </SwipeableRow>
              )
            })}
          </div>

          {/* ── Loop-wrap note ── */}
          <p className="playlist-loop-note">
            {n === 1
              ? '∞ This track will loop on its own'
              : `∞ After track ${n}, loops back to track 1`}
          </p>

          {/* ── Too-many-tracks warning ── */}
          {n > 5 && (
            <p className="playlist-warning">
              ⚠ Best with 5 or fewer tracks for smooth crossfades
            </p>
          )}
        </>
      )}

      {/* ── Filler song section ── */}
      <div className="filler-section">
        <span className="filler-section-label">FILLER SONG</span>
        <button
          className="btn-set-filler"
          onClick={() => setShowFillerPicker(true)}
          disabled={library.length === 0}
        >
          {fillerTrack ? formatTitle(fillerTrack.name) : 'None set'}
        </button>
      </div>

      {/* ── Footer ── */}
      <div className="playlist-footer">
        <button className="btn-play" disabled={n === 0} onClick={onPlay}>
          ▶&nbsp;&nbsp;Play Loop
        </button>
      </div>

      {/* ── Filler picker overlay ── */}
      {showFillerPicker && (
        <div className="confirm-overlay" onClick={() => setShowFillerPicker(false)}>
          <div className="filler-picker-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="filler-picker-header">SET FILLER SONG</p>
            <div className="filler-picker-list">
              {library.map((track) => (
                <button
                  key={track.id}
                  className={`filler-picker-row${track.id === fillerTrackId ? ' active' : ''}`}
                  onClick={() => handleFillerTrackSelect(track)}
                >
                  <span className="filler-picker-name">{formatTitle(track.name)}</span>
                  {track.id === fillerTrackId && <span className="filler-picker-check">✓</span>}
                </button>
              ))}
            </div>
            {/* Fill volume slider */}
            <div className="filler-volume-row">
              <span className="filler-volume-label">Fill volume</span>
              <div className="filler-volume-control">
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(fillVolume * 100)}
                  className="filler-volume-slider"
                  onChange={(e) => handleVolumeChange(parseInt(e.target.value) / 100)}
                />
                <span className="filler-volume-pct">{Math.round(fillVolume * 100)}%</span>
              </div>
            </div>
            {fillerTrackId && (
              <button
                className="btn-filler-clear"
                onClick={() => {
                  onFillerTrackChange(null)
                  saveFillerTrackId(null)
                  setShowFillerPicker(false)
                }}
              >
                Clear filler
              </button>
            )}
            <button className="btn-confirm-cancel" onClick={() => setShowFillerPicker(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
