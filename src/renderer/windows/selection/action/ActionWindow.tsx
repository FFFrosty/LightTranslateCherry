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
import type { AppDiagnostics, InitialState, PublicProfile } from '../../../../shared/api'
import ActionTranslate from './components/ActionTranslate'
import ModelSettingsPanel from './components/ModelSettingsPanel'
import AppLogo from '../../../../../assets/logo.svg'

export default function ActionWindow({ initial }: { initial: InitialState }) {
  const [isPinned, setIsPinned] = useState(false)
  const [isWindowFocus, setIsWindowFocus] = useState(true)
  const [showOpacitySlider, setShowOpacitySlider] = useState(false)
  const [opacity, setOpacity] = useState(100)
  const [windowError, setWindowError] = useState('')
  const [profile, setProfile] = useState<PublicProfile | null>(initial.profile)
  const [showModelSettings, setShowModelSettings] = useState(false)
  const [profileError, setProfileError] = useState(initial.profileError ?? '')
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null)
  const [diagnosticsError, setDiagnosticsError] = useState('')
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const diagnosticsGeneration = useRef(0)
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

  const refreshDiagnostics = useCallback(async () => {
    const generation = ++diagnosticsGeneration.current
    setDiagnosticsLoading(true)
    setDiagnosticsError('')
    try {
      const current = await window.lightTranslate.getDiagnostics()
      if (generation === diagnosticsGeneration.current) setDiagnostics(current)
    } catch {
      if (generation === diagnosticsGeneration.current) setDiagnosticsError('无法读取当前进程诊断，请重试。')
    } finally {
      if (generation === diagnosticsGeneration.current) setDiagnosticsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!showDiagnostics) return
    void refreshDiagnostics()
    const refresh = () => { void refreshDiagnostics() }
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh); diagnosticsGeneration.current++ }
  }, [showDiagnostics, refreshDiagnostics])

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
  function handleConfigured(next: PublicProfile) {
    setProfile(next)
    setProfileError('')
    void refreshDiagnostics()
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
      {initial.kind === 'manual' && <div className="profile-bar"><span title={profile ? `${profile.provider} · ${profile.model}` : ''}>{profile?.configured ? `${profile.provider} · ${profile.model}` : '尚未配置翻译模型'}</span><button aria-expanded={showDiagnostics} aria-controls="configuration-diagnostics" onClick={() => setShowDiagnostics(!showDiagnostics)}>配置诊断</button><button aria-expanded={showModelSettings} aria-controls="model-settings" onClick={() => setShowModelSettings(!showModelSettings)}>模型设置</button></div>}
      {initial.kind === 'manual' && !profile?.configured && profileError && <div className="window-error" role="alert">{profileError}</div>}
      <div ref={contentElementRef} onScroll={handleUserScroll} className="window-content">
        {initial.kind === 'manual' && showModelSettings && <ModelSettingsPanel onConfigured={handleConfigured} onClose={() => setShowModelSettings(false)} />}
        {initial.kind === 'manual' && showDiagnostics && <section id="configuration-diagnostics" className="diagnostics-panel" aria-label="配置诊断" aria-busy={diagnosticsLoading}>
          <div className="diagnostics-heading"><strong>当前运行进程</strong><button onClick={() => void refreshDiagnostics()} disabled={diagnosticsLoading}>{diagnosticsLoading ? '正在刷新…' : '刷新诊断'}</button></div>
          <p>实时读取本实例内存；仅显示配置来源与请求状态。</p>
          {diagnosticsError && <div role="alert">{diagnosticsError}</div>}
          {diagnostics && <>
            {diagnostics.demo && <p>演示模式：未加载真实配置，也不发起真实请求。</p>}
            <dl>
              <dt>程序版本</dt><dd>{diagnostics.version}</dd>
              <dt>进程 PID</dt><dd>{diagnostics.pid}</dd>
              <dt>运行程序</dt><dd>{diagnostics.executable}</dd>
              <dt>数据目录</dt><dd>{diagnostics.userData}</dd>
              <dt>加密配置文件</dt><dd>{diagnostics.profile.profilePath}</dd>
              <dt>成功加载来源</dt><dd>{diagnostics.profile.source === 'local' ? 'local · 本地加密配置' : diagnostics.profile.source === 'legacy' ? 'legacy · 旧版导入' : '尚未成功加载'}</dd>
              <dt>实际读取路径</dt><dd>{diagnostics.profile.sourcePath ?? '—'}</dd>
              <dt>来源文件大小</dt><dd>{diagnostics.profile.sourceSize === null ? '—' : `${diagnostics.profile.sourceSize} 字节`}</dd>
              <dt>来源文件修改时间</dt><dd>{diagnostics.profile.sourceModifiedAt ?? '—'}</dd>
              <dt>旧版导入路径</dt><dd>{diagnostics.profile.legacyImportPath ?? '本实例尚未尝试旧版导入'}</dd>
              <dt>加载时间</dt><dd>{diagnostics.profile.loadedAt ?? '—'}</dd>
              <dt>本地加载结果</dt><dd>{diagnostics.profile.localLoadFailure === 'missing' ? 'missing · 本地文件缺失' : diagnostics.profile.localLoadFailure === 'unreadable' ? 'unreadable · 本地文件无法读取或解密' : '无失败记录'}</dd>
              <dt>内存服务商</dt><dd>{diagnostics.profile.provider ?? '—'}</dd>
              <dt>内存模型</dt><dd>{diagnostics.profile.model ?? '—'}</dd>
              <dt>内存服务域名</dt><dd>{diagnostics.profile.host ?? '—'}</dd>
            </dl>
            <strong>最近一次真实翻译请求</strong>
            {diagnostics.latestRequest ? <dl>
              <dt>开始时间</dt><dd>{diagnostics.latestRequest.startedAt}</dd>
              <dt>实际服务商</dt><dd>{diagnostics.latestRequest.provider}</dd>
              <dt>实际模型</dt><dd>{diagnostics.latestRequest.model}</dd>
              <dt>实际服务域名</dt><dd>{diagnostics.latestRequest.host}</dd>
              <dt>请求状态</dt><dd>{diagnostics.latestRequest.status === 'pending' ? 'pending · 请求中' : diagnostics.latestRequest.status === 'succeeded' ? 'succeeded · 已完成' : 'failed · 失败或取消'}</dd>
              <dt>HTTP 状态</dt><dd>{diagnostics.latestRequest.httpStatus ?? '尚未收到 HTTP 响应'}</dd>
            </dl> : <p>本实例尚无真实翻译请求。</p>}
          </>}
        </section>}
        <ActionTranslate initial={initial} profile={profile} scrollToBottom={handleScrollToBottom} />
      </div>
    </div>
  )
}

function WindowButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`window-button ${className}`} {...props} />
}
