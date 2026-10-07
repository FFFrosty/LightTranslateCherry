/**
 * Adapted from Cherry Studio (AGPL-3.0-only).
 * Upstream: src/renderer/windows/selection/action/components/ActionTranslate.tsx
 * Commit: dd0767e1e7ecd8e37f44376382f35cb7ba04bea8
 * Modified 2026-10-07: retain the language/settings/original/result/footer
 * composition; replace Cherry translation hooks, message records and services
 * with Bridge streaming, local language hints and safe lightweight Markdown.
 */
import { ArrowRight, ChevronDown, CircleHelp, Copy, Globe2, Languages, Loader2, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { InitialState, Preferences, PublicProfile } from '../../../../../shared/api'
import WindowFooter from './WindowFooter'

const LANGUAGES = [
  ['zh-cn', '简体中文'], ['en-us', 'English'], ['ja', '日本語'], ['ko', '한국어'],
  ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español']
] as const
function label(code: string) { return LANGUAGES.find(([value]) => value === code)?.[1] ?? code }
function hintedLanguage(text: string): string | null {
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja'
  if (/[\uac00-\ud7af]/u.test(text)) return 'ko'
  if (/[\u4e00-\u9fff]/u.test(text)) return 'zh-cn'
  // Latin-script languages cannot be reliably distinguished without a detector.
  return null
}
function chooseTarget(text: string, pair: Preferences) {
  return hintedLanguage(text) === pair.primary ? pair.alternate : pair.primary
}

interface Props { initial: InitialState; profile: PublicProfile | null; scrollToBottom: () => void }
export default function ActionTranslate({ initial, profile, scrollToBottom }: Props) {
  const [selectedText] = useState(initial.text)
  const [draft, setDraft] = useState(initial.text)
  const [pair, setPair] = useState(initial.preferences)
  const [actualTargetLanguage, setActualTargetLanguage] = useState(() => chooseTarget(initial.text, initial.preferences))
  const [showOriginal, setShowOriginal] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [content, setContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [completionError, setCompletionError] = useState('')
  const [notice, setNotice] = useState('')
  const [stopped, setStopped] = useState(false)
  const requestRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const profileRef = useRef(profile)
  profileRef.current = profile

  useEffect(() => {
    mountedRef.current = true
    const unsubscribe = window.lightTranslate.onChunk(({ id, text }) => {
      if (mountedRef.current && requestRef.current === id) setContent(text)
    })
    return () => {
      mountedRef.current = false
      unsubscribe()
      const id = requestRef.current
      requestRef.current = null
      if (id) void window.lightTranslate.cancel(id).catch(() => {})
    }
  }, [])
  useEffect(() => { scrollToBottom() }, [content, scrollToBottom])

  const fetchResult = useCallback(async (text: string, target: string) => {
    const previous = requestRef.current
    requestRef.current = null
    if (previous) void window.lightTranslate.cancel(previous).catch(() => {})
    setContent('')
    setCompletionError('')
    setNotice('')
    setStopped(false)
    if (!text.trim()) { setIsStreaming(false); return }
    if (!profileRef.current?.configured) {
      setIsStreaming(false)
      setCompletionError('尚未配置翻译模型。请在主窗口重新导入旧版轻译已保存的配置。')
      return
    }
    const id = crypto.randomUUID()
    requestRef.current = id
    setIsStreaming(true)
    try {
      const result = await window.lightTranslate.translate({ id, text, target })
      if (mountedRef.current && requestRef.current === id) {
        setContent(result)
        if (!result.trim()) setCompletionError('模型返回了空内容，请重试或更换模型。')
      }
    } catch (error) {
      if (mountedRef.current && requestRef.current === id) {
        setCompletionError(error instanceof Error ? error.message : '翻译失败，请检查网络或模型配置后重试。')
      }
    } finally {
      if (mountedRef.current && requestRef.current === id) { requestRef.current = null; setIsStreaming(false) }
    }
  }, [])
  useEffect(() => {
    if (initial.kind === 'result') void fetchResult(initial.text, chooseTarget(initial.text, initial.preferences))
    // A dedicated window starts exactly one request; language/profile changes do
    // not remount the window shell or reset its pin and opacity state.
  }, [fetchResult, initial])

  const handlePause = useCallback(() => {
    const id = requestRef.current
    requestRef.current = null
    if (id) void window.lightTranslate.cancel(id).catch(() => {})
    setIsStreaming(false)
    setStopped(true)
  }, [])
  const handleRegenerate = useCallback(() => { void fetchResult(selectedText, actualTargetLanguage) }, [fetchResult, selectedText, actualTargetLanguage])

  function handleDirectTargetChange(target: string) {
    setActualTargetLanguage(target)
    if (selectedText.trim()) void fetchResult(selectedText, target)
  }
  async function handleChangeLanguage(next: Preferences) {
    setPair(next)
    setNotice('')
    try { await window.lightTranslate.saveLanguages(next) }
    catch { setNotice('语言偏好保存失败，本窗口仍可使用所选语言。') }
  }
  async function handleSubmit() {
    const text = draft.trim()
    if (!text) return
    setNotice('')
    setCompletionError('')
    try { await window.lightTranslate.openTranslation(text); setNotice('已打开独立翻译窗口。') }
    catch (error) { setCompletionError(error instanceof Error ? error.message : '翻译窗口打开失败。') }
  }
  const sourceHint = hintedLanguage(selectedText)
  if (initial.kind === 'manual') return <>
    <section className="manual-input">
      <label htmlFor="source-text">输入或粘贴要翻译的文字</label>
      <textarea id="source-text" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="在其他应用中选中文字，也可通过划词工具条翻译。" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void handleSubmit() } }} />
      <div className="manual-submit"><span>Ctrl + Enter 翻译</span><button className="primary-button" disabled={!draft.trim()} onClick={() => void handleSubmit()}><Languages size={15} />翻译</button></div>
    </section>
    <div className="language-settings">
      <label>首选语言<select value={pair.primary} onChange={(event) => void handleChangeLanguage({ ...pair, primary: event.target.value })}>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <label>备选语言<select value={pair.alternate} onChange={(event) => void handleChangeLanguage({ ...pair, alternate: event.target.value })}>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <p>每次翻译打开独立窗口，可置顶、拖动和调整大小。原文含首选语言的明显文字特征时，自动使用备选语言。</p>
    </div>
    {completionError && <div className="translation-error" role="alert">{completionError}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
  </>
  return (
    <>
      <div className="translation-body">
        <div className="language-bar">
          <div className="language-pair">
            <div className="detected-language" title="基于文字特征提示；实际原文语言由模型理解"><Globe2 size={14} /><span>{sourceHint ? `${label(sourceHint)}（推测）` : '自动识别'}</span></div>
            <ArrowRight size={16} className="muted" />
            <select aria-label="目标语言" value={actualTargetLanguage} onChange={(event) => handleDirectTargetChange(event.target.value)}>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
          </div>
          <div className="language-actions">
            <button className="icon-button" aria-label="语言偏好" title="语言偏好" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={14} /></button>
            <span className="help-icon" title="默认译为首选语言；原文含首选语言的明显文字特征时改用备选语言。可直接选择目标语言。"><CircleHelp size={14} /></span>
            <button className="original-toggle" onClick={() => setShowOriginal(!showOriginal)} aria-expanded={showOriginal}>{showOriginal ? '隐藏原文' : '显示原文'}<ChevronDown size={14} className={showOriginal ? 'rotate-180' : ''} /></button>
          </div>
        </div>
        {settingsOpen && <div className="language-settings">
          <label>首选语言<select value={pair.primary} onChange={(event) => void handleChangeLanguage({ ...pair, primary: event.target.value })}>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <label>备选语言<select value={pair.alternate} onChange={(event) => void handleChangeLanguage({ ...pair, alternate: event.target.value })}>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <p>偏好用于下一次输入；本次目标语言可直接在上方更改。</p>
        </div>}
        {showOriginal && <div className="original-text">{selectedText || '暂无原文'}<div className="original-copy"><button className="icon-button" title="复制原文" aria-label="复制原文" disabled={!selectedText} onClick={() => { void window.lightTranslate.copy(selectedText).then(() => setNotice('原文已复制。')).catch(() => setNotice('原文复制失败。')) }}><Copy size={12} /></button></div></div>}
        <div className="translation-result" aria-busy={isStreaming}>
          {isStreaming && <div className="stream-status" role="status"><Loader2 size={15} className="spin" />{content ? '正在翻译…' : '正在等待模型响应…'}</div>}
          {content && <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>[图片{alt ? `：${alt}` : ''}]</span>, a: ({ children }) => <span className="inert-link">{children}</span> }}>{content}</Markdown>}
          {!content && !isStreaming && !completionError && <p className="empty-state">{stopped ? '翻译已停止。' : selectedText ? '译文将在这里显示。' : '等待输入文字'}</p>}
          {stopped && content && <p className="stream-status">已停止，以上为部分译文。</p>}
        </div>
        {completionError && <div className="translation-error" role="alert">{completionError}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
      </div>
      <WindowFooter loading={isStreaming} onPause={handlePause} onRegenerate={handleRegenerate} canRegenerate={!!selectedText.trim()} content={content} />
    </>
  )
}
