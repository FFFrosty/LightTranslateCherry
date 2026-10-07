/**
 * Adapted from Cherry Studio (AGPL-3.0-only).
 * Upstream: src/renderer/components/selection/SelectionToolbarView.tsx
 * Commit: dd0767e1e7ecd8e37f44376382f35cb7ba04bea8
 * Modified 2026-10-07: extracted logo/action regions and action-button layout;
 * replaced Cherry preferences/icons with independent branding and the Bridge.
 */
import { Languages, Loader2 } from 'lucide-react'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { TOOLBAR_METRICS } from '../../../shared/windowMetrics'
import AppLogo from '../../../../assets/logo.svg'

// Preserves the upstream stateless chrome split: the logo is the drag region;
// actions are ordinary non-draggable controls.
export default function SelectionToolbarView() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function handleAction() {
    if (busy) return
    setBusy(true)
    setError('')
    try { await window.lightTranslate.translateSelection() }
    catch { setError('翻译窗口打开失败，请重新选择文字。') }
    finally { setBusy(false) }
  }
  return (
    <div className="toolbar-container" style={{ '--toolbar-inset': `${TOOLBAR_METRICS.inset}px` } as CSSProperties}>
      <div data-ui="selection.toolbar" className="selection-toolbar">
        <div className="toolbar-logo"><img src={AppLogo} draggable={false} alt="LightTranslate" /></div>
        <div className="toolbar-actions">
          <button type="button" className="toolbar-action" disabled={busy} onClick={() => void handleAction()} title={error || '翻译选中文字'} aria-label={error || '翻译选中文字'}>
            <span className="toolbar-action-icon">{busy ? <Loader2 size={16} className="spin" /> : <Languages size={16} />}</span>
            <span className="toolbar-action-title">{error ? '重试' : '翻译'}</span>
          </button>
        </div>
      </div>
      {error && <div className="toolbar-error" role="alert">{error}</div>}
    </div>
  )
}
