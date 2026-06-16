'use client'

import { useEffect, useRef, useState } from 'react'

export type SelectOption = { value: string; label: string }

type SelectProps = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  id?: string
  className?: string
  /** Tailwind classes controlling padding/height to match the old `.input py-*` usage. */
  sizeClassName?: string
  placeholder?: string
}

/**
 * Custom dropdown that fully follows the dark theme. We can't use a native
 * <select> because macOS renders its popup with the OS-native (light) menu,
 * ignoring CSS — see the company-filter theming bug.
 */
export default function Select({
  value,
  onChange,
  options,
  id,
  className = '',
  sizeClassName = 'py-2.5 px-4',
  placeholder = 'Select…',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        className={`input flex w-full items-center justify-between gap-2 text-left ${sizeClassName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`truncate ${selected ? '' : 'text-[var(--muted)]'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full min-w-max overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg"
        >
          {options.map((opt) => {
            const isSelected = opt.value === value
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--card-hover)] ${
                    isSelected ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'
                  }`}
                >
                  <span className="w-3 shrink-0">{isSelected ? '✓' : ''}</span>
                  <span className="truncate">{opt.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
