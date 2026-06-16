'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  /** Tailwind max-width class for the panel. Defaults to a compact form width. */
  maxWidthClassName?: string
}

export default function Modal({ open, onClose, title, children, maxWidthClassName = 'max-w-md' }: ModalProps) {
  // Portal to <body> so a transformed ancestor (e.g. the page's animate-fade-in
  // wrapper) can't become the containing block and push this off-center.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Close on Escape and lock background scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open || !mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel: capped to the viewport height; body scrolls if content is tall */}
      <div className={`relative z-10 w-full ${maxWidthClassName} max-h-[90vh] flex flex-col bg-card border border-border rounded-xl shadow-2xl animate-fade-in`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 -mr-1.5 rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  )
}
