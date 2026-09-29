import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentEngine, useStore } from '../state/store'

interface Point {
  x: number
  y: number
}

/** Screen-space frame of the selection: four corners and the centre. */
interface Handles {
  corners: Point[]
  center: Point
  rotate: Point
}

const ROTATE_OFFSET = 26

/**
 * Handles drawn over the canvas around the selected vinyls: corners scale,
 * the dot above the frame rotates. Positions follow the camera every frame.
 */
function computeHandles(): Handles | null {
  const engine = currentEngine()
  const st = useStore.getState()
  if (!engine || st.tab !== 'livery' || !st.selection.length) return null
  const chosen = st.draft.design.layers.filter((l) => st.selection.includes(l.id))
  if (chosen.every((l) => l.locked)) return null
  const bounds = st.selectionBounds()
  if (!bounds) return null
  const pts = engine.viewer.toScreen([...bounds.corners, bounds.center])
  if (pts.some((p) => !p)) return null
  const [a, b, c, d, center] = pts as Point[]
  // rotation dot: beyond the middle of the top edge, away from the centre
  const top = { x: (c!.x + d!.x) / 2, y: (c!.y + d!.y) / 2 }
  const len = Math.hypot(top.x - center!.x, top.y - center!.y) || 1
  const rotate = {
    x: top.x + ((top.x - center!.x) / len) * ROTATE_OFFSET,
    y: top.y + ((top.y - center!.y) / len) * ROTATE_OFFSET,
  }
  return { corners: [a!, b!, c!, d!], center: center!, rotate }
}

/**
 * Handles drawn over the canvas around the selected vinyls: corners scale,
 * the dot above the frame rotates. Positions follow the camera every frame.
 */
export function Gizmo() {
  const { t } = useTranslation()
  // re-render on selection and design changes, and after every 3D frame
  useStore((s) => s.tab)
  useStore((s) => s.selection)
  useStore((s) => s.selectedLayer)
  useStore((s) => s.draft.design)
  const [, setFrame] = useState(0)
  const active = useRef<{ kind: 'scale' | 'rotate'; start: Point; center: Point } | null>(null)

  useEffect(() => {
    const engine = currentEngine()
    if (!engine) return
    return engine.viewer.onRender(() => setFrame((n) => n + 1))
  }, [])

  const handles = computeHandles()
  if (!handles) return null

  const local = (e: React.PointerEvent): Point => {
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const begin = (kind: 'scale' | 'rotate', e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    active.current = { kind, start: local(e), center: handles.center }
    useStore.getState().beginGizmo()
  }

  const move = (e: React.PointerEvent) => {
    const a = active.current
    if (!a) return
    const p = local(e)
    const st = useStore.getState()
    if (a.kind === 'scale') {
      const d0 = Math.hypot(a.start.x - a.center.x, a.start.y - a.center.y) || 1
      const d1 = Math.hypot(p.x - a.center.x, p.y - a.center.y)
      st.gizmoUpdate({ scale: Math.min(20, Math.max(0.05, d1 / d0)) })
    } else {
      // screen y grows downwards: negate it for counter-clockwise angles
      const a0 = Math.atan2(-(a.start.y - a.center.y), a.start.x - a.center.x)
      const a1 = Math.atan2(-(p.y - a.center.y), p.x - a.center.x)
      st.gizmoUpdate({ rotate: ((a1 - a0) * 180) / Math.PI, snap: e.shiftKey })
    }
  }

  const end = (e: React.PointerEvent) => {
    if (!active.current) return
    active.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    useStore.getState().endGizmo()
  }

  const [, , c, d] = handles.corners
  const topMid = { x: (c!.x + d!.x) / 2, y: (c!.y + d!.y) / 2 }

  return (
    <div className="gizmo" aria-hidden>
      <svg className="gizmo-lines">
        <line x1={topMid.x} y1={topMid.y} x2={handles.rotate.x} y2={handles.rotate.y} />
      </svg>
      {handles.corners.map((p, i) => (
        <div
          key={i}
          className="gizmo-handle scale"
          title={t('design.gizmoScale')}
          style={{ left: p.x, top: p.y }}
          onPointerDown={(e) => begin('scale', e)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
      <div
        className="gizmo-handle rotate"
        title={t('design.gizmoRotate')}
        style={{ left: handles.rotate.x, top: handles.rotate.y }}
        onPointerDown={(e) => begin('rotate', e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  )
}
