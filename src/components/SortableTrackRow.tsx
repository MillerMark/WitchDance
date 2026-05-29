import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Track } from '../types/track'
import { SwipeableRow } from './SwipeableRow'

interface Props {
  track: Track
  index: number
  onRemove: (trackId: string) => void
  formatTitle: (name: string) => string
}

export function SortableTrackRow({ track, index, onRemove, formatTitle }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <SwipeableRow onDelete={() => onRemove(track.id)}>
        <div className={`playlist-row${isDragging ? ' dragging' : ''}`}>
          {/* Drag handle */}
          <button
            {...attributes}
            {...listeners}
            className="drag-handle"
            aria-label="Drag to reorder"
          >
            ≡
          </button>

          {/* Index */}
          <div className="playlist-row-index">{index + 1}</div>

          {/* Title */}
          <div className="playlist-row-title">{formatTitle(track.name)}</div>
        </div>
      </SwipeableRow>
    </div>
  )
}
