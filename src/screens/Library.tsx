import { useRef, useState } from 'react'
import type { Track } from '../types/track'
import { trackFromFile } from '../types/track'

interface Props {
  library: Track[]
  playlist: Track[]
  onImport: (merged: Track[]) => void
  onAddToPlaylist: (selected: Track[]) => void
  onDeleteTrack: (trackId: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function Library({ library, playlist, onImport, onAddToPlaylist, onDeleteTrack }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(playlist.map((t) => t.id))
  )

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    const existingIds = new Set(library.map((t) => t.id))
    const newTracks = files
      .map(trackFromFile)
      .filter((t) => !existingIds.has(t.id))

    if (newTracks.length > 0) {
      onImport([...library, ...newTracks])
    }

    // reset so the same file can be re-imported after a library clear
    e.target.value = ''
  }

  function toggleTrack(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleAddToPlaylist() {
    const selected = library.filter((t) => selectedIds.has(t.id))
    onAddToPlaylist(selected)
  }

  function handleDelete(e: React.MouseEvent, trackId: string) {
    e.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(trackId)
      return next
    })
    onDeleteTrack(trackId)
  }

  const selectedCount = library.filter((t) => selectedIds.has(t.id)).length

  return (
    <div className="screen library">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,audio/flac,audio/x-m4a,.mp3,.m4a,.aac,.wav,.ogg,.flac,.mp4"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className="library-header">
        <h1>WitchDance</h1>
        {library.length > 0 && (
          <button className="btn-import" onClick={handleImportClick}>
            + Import
          </button>
        )}
      </div>

      {library.length === 0 ? (
        <div className="library-empty">
          <div className="library-empty-icon">🎵</div>
          <h2>Your library is empty</h2>
          <p>Import audio files from your device to get started.</p>
          <button className="btn-import-empty" onClick={handleImportClick}>
            Import Songs
          </button>
        </div>
      ) : (
        <>
          <div className="track-list">
            {library.map((track) => {
              const isSelected = selectedIds.has(track.id)
              return (
                <div
                  key={track.id}
                  className={`track-row${isSelected ? ' selected' : ''}`}
                  onClick={() => toggleTrack(track.id)}
                  role="checkbox"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === ' ' && toggleTrack(track.id)}
                >
                  <div className="track-checkbox">
                    {isSelected && <div className="track-checkbox-dot" />}
                  </div>
                  <div className="track-info">
                    <div className="track-name">{track.name}</div>
                    <div className="track-meta">{formatBytes(track.file.size)}</div>
                  </div>
                  <button
                    className="btn-delete-track"
                    onClick={(e) => handleDelete(e, track.id)}
                    aria-label="Delete track"
                    title="Delete track"
                  >
                    🗑️
                  </button>
                </div>
              )
            })}
          </div>

          <div className="library-footer">
            <button
              className="btn-add-playlist"
              disabled={selectedCount === 0}
              onClick={handleAddToPlaylist}
            >
              {selectedCount === 0
                ? 'Select songs to continue'
                : `Add ${selectedCount} song${selectedCount !== 1 ? 's' : ''} to Playlist →`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
