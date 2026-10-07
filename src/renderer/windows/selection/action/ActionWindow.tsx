/**
 * Adapted from Cherry Studio (AGPL-3.0-only).
 * Upstream: src/renderer/windows/selection/action/ActionWindow.tsx
 * Commit: dd0767e1e7ecd8e37f44376382f35cb7ba04bea8
 * Modified 2026-10-07: retain window shell, titlebar controls, focus styling and
 * scroll-follow behavior; replace Cherry IPC/preferences with per-window Bridge
 * state. Dedicated BrowserWindows replace the Cherry pooled-window lifecycle.
 */
import { Droplet, Minus, Pin, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import type { InitialState, PublicProfile } from '../../../../shared/api'
import ActionTranslate from './components/ActionTranslate'
import AppLogo from '../../../../../assets/logo.svg'

export default function ActionWindow({ initial }: { initial: InitialState }) {
  const [isPinned, setIsPinned] = useState(false)
  const [isWindowFocus, setIsWindowFocus] = useState(true)
  const [showOpacitySlider, setShowOpacitySlider] = useState(false)
  const [opacity, setOpacity] = useState(100)
  const [windowError, setWindowError] = useState('')
  const [profile, setProfile] = useState<PublicProfile | null>(initial.profile)
  const [importing, setImporting] = useState(false)
  const contentElementRef = useRef<HTMLDivElement>(null)
  const isAutoScrollEnabled = useRef(true)
  const lastScrollHeight = useRef(0)

  useEffect(() => {
    const focus = () => setIsWindowFocus(true)
    const blur = () => setIsWindowFocus(false)
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('focus', focus); window.removeEventListener('blur', blur) }
  }, [])

  const handleScrollToBottom = useCallback(() => {
    const el = contentElementRef.current
    if (el && isAutoScrollEnabled.current) el.scrollTo({ top: el.scrollHeight })
  }, [])
  function handleUserScroll() {
    const el = contentElementRef.current
    if (!el) return
    const contentIncreased = el.scrollHeight > lastScrollHeight.current
    lastScrollHeight.current = el.scrollHeight
    if (contentIncreased && isAutoScrollEnabled.current) return
    isAutoScrollEnabled.current = Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 32
  }
  async function togglePin() {
    const next = !isPinned
    try { await window.lightTranslate.setPinned(next); setIsPinned(next) }
    catch { setWindowError('无法更改置顶状态。') }
  }
  async function handleOpacityChange(next: number) {
    setOpacity(next)
    try { await window.lightTranslate.setOpacity(next / 100) }
    catch { setWindowError('无法调整窗口透明度。') }
  }
  async function reimport() {
    setImporting(true)
    setWindowError('')
    try { setProfile(await window.lightTranslate.reimportProfile()) }
    catch (error) { setWindowError(error instanceof Error ? error.message : '配置导入失败。') }
    finally { setImporting(false) }
  }
  return (
    <div data-ui="selection.action" className="action-window">
      <header className={`window-titlebar ${isWindowFocus ? 'focused' : ''}`}>
        <img src={AppLogo} className="window-logo" alt="" draggable={false} />
        <div className="window-title">{initial.kind === 'manual' ? '轻译 · Cherry 版' : '翻译'}</div>
        <div className="window-controls">
          <WindowButton title={isPinned ? '取消置顶' : '置顶窗口'} aria-label={isPinned ? '取消置顶' : '置顶窗口'} aria-pressed={isPinned} className={isPinned ? 'active' : ''} onClick={() => void togglePin()}><Pin size={13} className={isPinned ? 'rotate-45' : ''} /></WindowButton>
          <WindowButton title="窗口透明度" aria-label="窗口透明度" aria-expanded={showOpacitySlider} className={showOpacitySlider ? 'active' : ''} onClick={() => setShowOpacitySlider(!showOpacitySlider)}><Droplet size={13} /></WindowButton>
          {showOpacitySlider && <div className="opacity-popover"><label htmlFor="opacity">透明度 {opacity}%</label><input id="opacity" type="range" min="35" max="100" value={opacity} onChange={(event) => void handleOpacityChange(Number(event.target.value))} /></div>}
          <WindowButton title="最小化" aria-label="最小化" onClick={() => void window.lightTranslate.minimize()}><Minus size={14} /></WindowButton>
          <WindowButton title="关闭" aria-label="关闭" className="close-button" onClick={() => void window.lightTranslate.close()}><X size={14} /></WindowButton>
        </div>
      </header>
      {windowError && <div className="window-error" role="alert">{windowError}</div>}
      {initial.kind === 'manual' && <div className="profile-bar"><span title={profile ? `${profile.provider} · ${profile.model}` : ''}>{profile?.configured ? `${profile.provider} · ${profile.model}` : '尚未配置翻译模型'}</span><button disabled={importing} onClick={() => void reimport()}>{importing ? '正在导入…' : '重新导入配置'}</button></div>}
      <div ref={contentElementRef} onScroll={handleUserScroll} className="window-content">
        <ActionTranslate initial={initial} profile={profile} scrollToBottom={handleScrollToBottom} />
      </div>
    </div>
  )
}

function WindowButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`window-button ${className}`} {...props} />
}
