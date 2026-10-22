import type { ReactElement } from 'react'

const ICON_PROPS = { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': true } as const

export function PlayIcon(): ReactElement {
  return (
    <svg {...ICON_PROPS} fill="currentColor">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

export function PauseIcon(): ReactElement {
  return (
    <svg {...ICON_PROPS} fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  )
}

export function BoltIcon(): ReactElement {
  return (
    <svg {...ICON_PROPS} fill="currentColor">
      <path d="M13.5 2 4 14h7l-1.5 8L20 10h-7l.5-8Z" />
    </svg>
  )
}

export function ResetIcon(): ReactElement {
  return (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  )
}
