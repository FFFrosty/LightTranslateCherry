/**
 * Adapted from Cherry Studio (AGPL-3.0-only).
 * Upstream: src/renderer/windows/selection/action/components/WindowFooter.tsx
 * Commit: dd0767e1e7ecd8e37f44376382f35cb7ba04bea8
 * Modified 2026-10-07: preserve Esc stop/close, R retry and C copy actions;
 * replace Cherry hotkeys/timers/toasts with native events and Bridge clipboard.
 * Keep footer visible and in normal flow for resizing and keyboard accessibility.
 */
import { Check, CircleX, Copy, Loader2, Pause, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

interface FooterProps {
  content?: string
  loading?: boolean
  canRegenerate?: boolean
  onPause: () => void
  onRegenerate: () => void
}

export default function WindowFooter({ content = '', loading = false, canRegenerate = true, onPause, onRegenerate }: FooterProps) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(timer) }, [copied])
  const handleEsc = useCallback(() => {
    if (loading) onPause()
    else void window.lightTranslate.close()
  }, [loading, onPause])
  const handleCopy = useCallback(async () => {
    if (!content || loading) return
    try { await window.lightTranslate.copy(content); setCopied(true); setCopyError('') }
    catch { setCopyError('复制失败，请重试。') }
  }, [content, loading])
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      // Bare-letter shortcuts must never intercept typing, IME or system copy.
      if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, button, [contenteditable="true"], [role="textbox"]')) return
      const key = event.key.toLowerCase()
      if (key === 'escape') { event.preventDefault(); handleEsc() }
      if (key === 'r' && canRegenerate) { event.preventDefault(); onRegenerate() }
      if (key === 'c' && !window.getSelection()?.toString()) { event.preventDefault(); void handleCopy() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleEsc, handleCopy, canRegenerate, onRegenerate])
  return (
    <footer className="window-footer">
      <div className="footer-actions">
        <button type="button" onClick={handleEsc} className={loading ? 'footer-button danger' : 'footer-button'}>
          {loading ? <span className="pause-icon"><Pause size={12} /><Loader2 size={16} className="spin" /></span> : <CircleX size={14} />}
          {loading ? 'Esc 停止' : 'Esc 关闭'}
        </button>
        <button type="button" onClick={onRegenerate} disabled={!canRegenerate} className="footer-button"><RefreshCw size={14} />R 重试</button>
        <button type="button" onClick={() => void handleCopy()} disabled={!content || loading} className="footer-button">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : 'C 复制'}</button>
      </div>
      {copyError && <span role="alert" className="footer-error">{copyError}</span>}
    </footer>
  )
}
