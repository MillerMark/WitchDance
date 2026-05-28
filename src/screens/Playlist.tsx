import { useState, useCallback } from 'react'
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

export function Playlist({ tracks, onReorder, onBack, onPlay, library, fillerTrackId, onFillerTrackChange }: Props) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [showFillerPicker, setShowFillerPicker] = useState(false)

  const visualTracks = drag
    ? moveItem(tracks, drag.fromIndex, drag.toIndex)
    : tracks

  const handleDragStart = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, trackId: string) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const rowEl = e.currentTarget.closest('.playlist-row') as HTMLElement | null
      const rowHeight = rowEl?.getBoundingClientRect().height ?? 72
      const fromIndex = tracks.findIndex((t) => t.id === trackId)
      setDrag({ trackId, fromIndex, toIndex: fromIndex, startY: e.clientY, rowHeight })
    },
    [tracks],
  )

  const handleDragMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!drag) return
      const deltaY = e.clientY - drag.startY
      const toIndex = Math.max(
        0,
        Math.min(tracks.length - 1, drag.fromIndex + Math.round(deltaY / drag.rowHeight)),
      )
      if (toIndex !== drag.toIndex) {
        setDrag((prev) => (prev ? { ...prev, toIndex } : null))
      }
    },
    [drag, tracks.length],
  )

  const handleDragEnd = useCallback(() => {
    if (!drag) return
    if (drag.toIndex !== drag.fromIndex) {
      onReorder(moveItem(tracks, drag.fromIndex, drag.toIndex))
    }
    setDrag(null)
  }, [drag, tracks, onReorder])

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
                      className="drag-handle"
                      aria-label="Drag to reorder"
                      onPointerDown={(e) => handleDragStart(e, track.id)}
                      onPointerMove={isDragging ? handleDragMove : undefined}
                      onPointerUp={isDragging ? handleDragEnd : undefined}
                      onPointerCancel={isDragging ? handleDragEnd : undefined}
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
                  onClick={() => {
                    onFillerTrackChange(track.id)
                    saveFillerTrackId(track.id)
                    setShowFillerPicker(false)
                  }}
                >
                  <span className="filler-picker-name">{formatTitle(track.name)}</span>
                  {track.id === fillerTrackId && <span className="filler-picker-check">✓</span>}
                </button>
              ))}
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
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
