import { useTranslation } from 'react-i18next'
import { useStore, type PanelTab } from '../state/store'
import { InfoTab } from './InfoTab'
import { LeagueTab } from './LeagueTab'
import { LiveryTab } from './LiveryTab'
import { SkinsTab } from './SkinsTab'

const TABS: PanelTab[] = ['skins', 'livery', 'league', 'info']

export function SidePanel() {
  const { t } = useTranslation()
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const ready = useStore((s) => s.load.status === 'ready')
  return (
    <aside className="side-panel">
      <nav className="tabs" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
            disabled={!ready}
          >
            {t(`tabs.${id}`)}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {ready && tab === 'skins' && <SkinsTab />}
        {ready && tab === 'livery' && <LiveryTab />}
        {ready && tab === 'league' && <LeagueTab />}
        {ready && tab === 'info' && <InfoTab />}
      </div>
    </aside>
  )
}
