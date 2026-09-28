import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, type LiveryPanel } from '../state/store'
import { BasePanel } from './livery/BasePanel'
import { DesignPanel } from './livery/DesignPanel'
import { PartsPanel } from './livery/PartsPanel'
import { TemplatePanel } from './livery/TemplatePanel'
import { ExportBar, SavePanel } from './livery/SavePanel'

const PANELS: LiveryPanel[] = ['design', 'base', 'parts', 'template', 'save']

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable)
  )
}

/** Keyboard shortcuts of the livery editor. */
function useEditorShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const st = useStore.getState()
      if (st.tab !== 'livery') return
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const step = e.shiftKey ? 0.02 : 0.004
      if (ctrl && key === 'z' && !e.shiftKey) st.undo()
      else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) st.redo()
      else if (ctrl && key === 'd') st.duplicateSelection()
      else if (ctrl && key === 'g' && e.shiftKey) st.ungroupSelection()
      else if (ctrl && key === 'g') st.groupSelection()
      else if (ctrl && key === 'a') st.selectAll()
      else if (key === 'delete' || key === 'backspace') st.removeSelection()
      else if (key === 'escape') st.selectLayer(null)
      else if (key === 'arrowleft') st.nudgeSelection(-step, 0)
      else if (key === 'arrowright') st.nudgeSelection(step, 0)
      else if (key === 'arrowup') st.nudgeSelection(0, step)
      else if (key === 'arrowdown') st.nudgeSelection(0, -step)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function LiveryTab() {
  const { t } = useTranslation()
  const analysis = useStore((s) => s.analysis)
  const candidates = useStore((s) => s.liveryCandidates)
  const panel = useStore((s) => s.liveryPanel)
  const setPanel = useStore((s) => s.setLiveryPanel)
  useEditorShortcuts()

  if (!analysis || candidates.length === 0) {
    return <p className="notice warn">{t('livery.noTexture')}</p>
  }

  return (
    <div className="livery">
      <div className="segmented wide" role="tablist">
        {PANELS.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={panel === p}
            className={panel === p ? 'active' : ''}
            onClick={() => setPanel(p)}
          >
            {t(`livery.panels.${p}`)}
          </button>
        ))}
      </div>
      <div className="form livery-body">
        {panel === 'design' && <DesignPanel />}
        {panel === 'base' && <BasePanel />}
        {panel === 'parts' && <PartsPanel />}
        {panel === 'template' && <TemplatePanel />}
        {panel === 'save' && <SavePanel />}
      </div>
      <ExportBar />
    </div>
  )
}
