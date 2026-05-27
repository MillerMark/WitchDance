import { useRef, useState, useEffect } from 'react'
import { Library } from './screens/Library'
import { Playlist } from './screens/Playlist'
import { Playback } from './screens/Playback'
import { AboutOverlay } from './components/AboutOverlay'
import type { AudioEngine } from './audio/AudioEngine'
import type { Track } from './types/track'
import { trackFromFile } from './types/track'
import { saveLibrary, loadLibrary } from './storage/libraryDb'
import { savePlaylist, loadPlaylist, saveScreen, loadScreen, loadFillerTrackId, saveFillerTrackId, saveDebugMode, loadDebugMode } from './storage/sessionState'
import { loadPlaybackPos, clearPlaybackPos } from './storage/playbackPos'
import { iosAudioUnlock } from './audio/iosUnlock'
import './index.css'

type Screen = 'library' | 'playlist' | 'playback'

export function App() {
  const [screen, setScreen] = useState<Screen>('library')
  const [library, setLibrary] = useState<Track[]>([])
  const [playlist, setPlaylist] = useState<Track[]>([])
  const [restored, setRestored] = useState(false)
  const [resumePos, setResumePos] = useState<{ trackIndex: number; elapsed: number } | null>(null)
  const [fillerTrackId, setFillerTrackId] = useState<string | null>(loadFillerTrackId)
  const [debugMode, setDebugMode] = useState(() => loadDebugMode())
  const [showAbout, setShowAbout] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const playbackEngineRef = useRef<AudioEngine | null>(null)

  // Restore state from storage on mount
  useEffect(() => {
    loadLibrary()
      .then((stored) => {
        if (stored.length === 0) {
          setRestored(true)
          return
        }
        const tracks = stored.map((s) => trackFromFile(s.file))
        setLibrary(tracks)

        // Restore playlist from saved track IDs
        const savedIds = loadPlaylist()
        if (savedIds.length > 0) {
          const trackMap = new Map(tracks.map((t) => [t.id, t]))
          const restoredPlaylist = savedIds
            .map((id) => trackMap.get(id))
            .filter((t): t is Track => t !== undefined)
          if (restoredPlaylist.length > 0) {
            setPlaylist(restoredPlaylist)
            // If they were in playback or playlist, restore to playlist screen
            const lastScreen = loadScreen()
            if (lastScreen === 'playback' || lastScreen === 'playlist') {
              setScreen('playlist')
            }
            // Check for interrupted playback to offer resume
            if (lastScreen === 'playback' && restoredPlaylist.length > 0) {
              const pos = loadPlaybackPos()
              if (pos && pos.trackIndex < restoredPlaylist.length) {
                setResumePos({ trackIndex: pos.trackIndex, elapsed: pos.elapsed })
                setScreen('playback')
              }
            }
          }
        }
        setRestored(true)
      })
      .catch(() => setRestored(true))
  }, [])

  // Warn before unload when a playlist is active (prevents accidental refresh)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (playlist.length > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [playlist])

  function handleImport(tracks: Track[]) {
    setLibrary(tracks)
    saveLibrary(tracks.map((t) => ({ id: t.id, name: t.name, file: t.file }))).catch(() => {})
  }

  function handleAddToPlaylist(selected: Track[]) {
    setPlaylist(selected)
    savePlaylist(selected.map((t) => t.id))
    saveScreen('playlist')
    setScreen('playlist')
  }

  function handleReorder(tracks: Track[]) {
    setPlaylist(tracks)
    savePlaylist(tracks.map((t) => t.id))
  }

  function handleFillerTrackChange(id: string | null) {
    setFillerTrackId(id)
    saveFillerTrackId(id)
  }

  function handlePlay() {
    iosAudioUnlock()
    clearPlaybackPos()
    setResumePos(null)
    audioCtxRef.current = new AudioContext()
    saveScreen('playback')
    setScreen('playback')
  }

  function handleStop() {
    saveScreen('playlist')
    setScreen('playlist')
  }

  if (!restored) return null // wait for storage load before rendering

  return (
    <div className="app">
      <div
        style={{
          position: 'fixed',
          top: '8px',
          left: '10px',
          fontSize: '10px',
          color: debugMode ? 'rgba(255,200,0,0.6)' : 'rgba(255,255,255,0.35)',
          fontFamily: 'monospace',
          cursor: 'pointer',
          zIndex: 9999,
          userSelect: 'none',
        }}
        onClick={() => setShowAbout(true)}
      >
        WitchDance v1.0-{__COMMIT_HASH__}
      </div>
      {showAbout && (
        <AboutOverlay
          debugMode={debugMode}
          onClose={() => setShowAbout(false)}
          onToggleDebug={() => {
            const next = !debugMode
            setDebugMode(next)
            saveDebugMode(next)
          }}
          engine={playbackEngineRef.current}
          tracks={playlist}
        />
      )}
      {screen === 'library' && (
        <Library
          library={library}
          playlist={playlist}
          onImport={handleImport}
          onAddToPlaylist={handleAddToPlaylist}
        />
      )}
      {screen === 'playlist' && (
        <Playlist
          tracks={playlist}
          onReorder={handleReorder}
          onBack={() => { saveScreen('library'); setScreen('library') }}
          onPlay={handlePlay}
          library={library}
          fillerTrackId={fillerTrackId}
          onFillerTrackChange={handleFillerTrackChange}
        />
      )}
      {screen === 'playback' && (
        <Playback
          tracks={playlist}
          audioCtx={audioCtxRef.current}
          onStop={handleStop}
          resumePos={resumePos}
          onResumeConsumed={() => setResumePos(null)}
          fillerTrack={library.find((t) => t.id === fillerTrackId) ?? null}
          debugMode={debugMode}
          onEngineReady={(e) => { playbackEngineRef.current = e }}
        />
      )}
    </div>
  )
}
