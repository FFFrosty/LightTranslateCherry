import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import type { InitialState } from '../shared/api'
import ActionWindow from './windows/selection/action/ActionWindow'
import SelectionToolbarView from './components/selection/SelectionToolbarView'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/600.css'
import './style.css'

function App() {
  const [initial, setInitial] = useState<InitialState | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    window.lightTranslate.getInitial().then(setInitial).catch(() => setError('窗口初始化失败，请关闭后重试。'))
  }, [])
  if (error) return <div className="startup-error" role="alert">{error}</div>
  if (!initial) return <div className="startup-loading">正在准备…</div>
  return initial.kind === 'toolbar' ? <SelectionToolbarView /> : <ActionWindow initial={initial} />
}

createRoot(document.getElementById('root')!).render(<App />)
