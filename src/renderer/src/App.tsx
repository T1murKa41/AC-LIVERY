import { useEffect } from 'react'
import { useStore } from './state/store'
import { CarList } from './ui/CarList'
import { Header } from './ui/Header'
import { Setup } from './ui/Setup'
import { SidePanel } from './ui/SidePanel'
import { Viewport } from './ui/Viewport'

export function App() {
  const settings = useStore((s) => s.settings)
  const init = useStore((s) => s.init)
  useEffect(() => {
    void init()
  }, [init])
  if (!settings) return <div className="app loading" />
  return (
    <div className="app">
      <Header />
      {settings.acRoot ? (
        <main className="workspace">
          <CarList />
          <Viewport />
          <SidePanel />
        </main>
      ) : (
        <Setup />
      )}
    </div>
  )
}
