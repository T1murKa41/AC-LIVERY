import type { ShapeKind } from '@shared/design/types'

const PATHS: Record<ShapeKind, string> = {
  rect: 'M3 6h18v12H3z',
  roundrect: 'M7 6h10a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4z',
  circle: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z',
  ring: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zm0 5a4 4 0 1 1 0 8a4 4 0 1 1 0-8z',
  triangle: 'M12 3l10 18H2z',
  star: 'M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7L2 9.5l7.1-.6z',
  arrow: 'M2 9h11V4l9 8-9 8v-5H2z',
  chevron: 'M3 3h8l10 9-10 9H3l10-9z',
  hexagon: 'M7 3h10l5 9-5 9H7l-5-9z',
}

export function ShapeIcon({ shape }: { shape: ShapeKind }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path d={PATHS[shape]} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
