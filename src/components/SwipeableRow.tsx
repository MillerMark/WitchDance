import { useRef, useState, useEffect, useCallback } from 'react'

interface Props {
  onDelete: () => void
  children: React.ReactNode
  className?: string
}

const SWIPE_THRESHOLD = 70
const DELETE_BUTTON_WIDTH = 90

export function SwipeableRow({ onDelete, children, className = '' }: Props) {
  const [offset, setOffset] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const startXRef = useRef<number>(0)
  const startYRef = useRef<number>(0)
  const currentXRef = useRef<number>(0)
  const rowRef = useRef<HTMLDivElement>(null)
  const lockScrollRef = useRef<boolean>(false)

  const close = useCallback(() => {
    setOffset(0)
    setIsOpen(false)
  }, [])

  const open = useCallback(() => {
    setOffset(-DELETE_BUTTON_WIDTH)
    setIsOpen(true)
  }, [])

  const handleStart = useCallback((clientX: number, clientY: number) => {
    startXRef.current = clientX
    startYRef.current = clientY
    currentXRef.current = clientX
    lockScrollRef.current = false
    setIsDragging(true)
  }, [])

  const handleMove = useCallback((clientX: number, clientY: number) => {
    if (!isDragging) return

    const deltaX = clientX - startXRef.current
    const deltaY = clientY - startYRef.current

    // Determine if this is a horizontal or vertical gesture
    if (!lockScrollRef.current && Math.abs(deltaX) > 5) {
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        lockScrollRef.current = true
      }
    }

    // Only handle horizontal swipes (left swipe = negative deltaX)
    if (lockScrollRef.current) {
      // Prevent default to stop scrolling when swiping horizontally
      const newOffset = Math.min(0, Math.max(-DELETE_BUTTON_WIDTH, deltaX))
      setOffset(newOffset)
      currentXRef.current = clientX
    }
  }, [isDragging])

  const handleEnd = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)

    const deltaX = currentXRef.current - startXRef.current

    if (lockScrollRef.current) {
      // Horizontal swipe
      if (deltaX < -SWIPE_THRESHOLD) {
        open()
      } else {
        close()
      }
    }
    lockScrollRef.current = false
  }, [isDragging, open, close])

  // Touch events
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    handleStart(touch.clientX, touch.clientY)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (lockScrollRef.current) {
      e.preventDefault()
    }
    const touch = e.touches[0]
    handleMove(touch.clientX, touch.clientY)
  }

  const handleTouchEnd = () => {
    handleEnd()
  }

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    handleStart(e.clientX, e.clientY)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX, e.clientY)
  }

  const handleMouseUp = () => {
    handleEnd()
  }

  const handleMouseLeave = () => {
    if (isDragging) {
      handleEnd()
    }
  }

  const handleDeleteClick = () => {
    onDelete()
  }

  // Close when clicking on the content while open
  const handleContentClick = (e: React.MouseEvent) => {
    if (isOpen) {
      e.stopPropagation()
      close()
    }
  }

  // Close other rows when this one opens
  useEffect(() => {
    if (isOpen) {
      const handleClickOutside = (e: MouseEvent | TouchEvent) => {
        if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
          close()
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        document.removeEventListener('touchstart', handleClickOutside)
      }
    }
  }, [isOpen, close])

  return (
    <div ref={rowRef} className={`swipeable-row ${className}`}>
      <div
        className="swipeable-content"
        style={{
          transform: `translateX(${offset}px)`,
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={isDragging ? handleMouseMove : undefined}
        onMouseUp={isDragging ? handleMouseUp : undefined}
        onMouseLeave={handleMouseLeave}
        onClick={handleContentClick}
      >
        {children}
      </div>
      <button
        className="swipeable-delete"
        onClick={handleDeleteClick}
        aria-label="Delete"
      >
        Delete
      </button>
    </div>
  )
}
