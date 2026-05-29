import { useState, useCallback, useEffect, useRef } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { Track } from '../types/track'
import { saveFillerTrackId } from '../storage/sessionState'
import { SortableTrackRow } from '../components/SortableTrackRow'

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

function formatTitle(name: string): string {
  return name
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function Playlist({ tracks, onReorder, onBack, onPlay, library, fillerTrackId, onFillerTrackChange, fillVolume, onFillVolumeChange }: Props) {
  const [showFillerPicker, setShowFillerPicker] = useState(false)

  // Configure sensors for touch and mouse support
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts (prevents conflicts with swipe-to-delete)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // ── Fill preview audio ──
  const previewCtxRef = useRef<AudioContext | null>(null)
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const previewGainRef = useRef<GainNode | null>(null)
  const previewTrackIdRef = useRef<string | null>(null)

  // Handle drag end event
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = tracks.findIndex((t) => t.id === active.id)
      const newIndex = tracks.findIndex((t) => t.id === over.id)
      onReorder(arrayMove(tracks, oldIndex, newIndex))
    }
  }, [tracks, onReorder])

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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={tracks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="playlist-list">
                {tracks.map((track, index) => (
                  <SortableTrackRow
                    key={track.id}
                    track={track}
                    index={index}
                    onRemove={handleRemove}
                    formatTitle={formatTitle}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

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
