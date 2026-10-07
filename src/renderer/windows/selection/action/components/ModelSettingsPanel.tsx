import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ModelSettings, PublicProfile } from '../../../../../shared/api'

interface Props {
  onConfigured: (profile: PublicProfile) => void
  onClose: () => void
}
const endpointIdentity = (value: string) => value.trim()

/** Only public metadata is read back. API keys exist in this form until save/close. */
export default function ModelSettingsPanel({ onConfigured, onClose }: Props) {
  const [provider, setProvider] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState<ModelSettings | null>(null)
  const [forceNewKey, setForceNewKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'save' | 'file' | 'legacy' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const operation = useRef(false)

  function populate(settings: ModelSettings | null) {
    setSaved(settings)
    setProvider(settings?.provider ?? '')
    setBaseUrl(settings?.baseUrl ?? '')
    setModel(settings?.model ?? '')
    setApiKey('')
    setForceNewKey(false)
  }
  useEffect(() => {
    mounted.current = true
    window.lightTranslate.getModelSettings().then(settings => {
      if (mounted.current) populate(settings)
    }).catch(() => {
      if (mounted.current) setError('无法读取模型设置。可以重新填写，或导入已有配置文件。')
    }).finally(() => { if (mounted.current) setLoading(false) })
    return () => { mounted.current = false }
  }, [])

  const canKeepKey = !forceNewKey && !!saved?.hasApiKey && endpointIdentity(baseUrl) === endpointIdentity(saved.baseUrl)
  const disabled = loading || busy !== null

  function selectPreset(preset: string) {
    if (!preset) return
    setProvider(preset === 'deepseek' ? 'DeepSeek' : '')
    setBaseUrl(preset === 'deepseek' ? 'https://api.deepseek.com' : '')
    setModel(preset === 'deepseek' ? 'deepseek-v4-flash' : '')
    setApiKey('')
    setForceNewKey(true)
    setError('')
    setNotice('已切换预设，请填写此服务的 API Key。')
  }

  async function apply(kind: 'save' | 'file' | 'legacy') {
    if (operation.current || loading) return
    if (kind === 'save' && !canKeepKey && !apiKey.trim()) {
      setError('请填写当前服务的 API Key；更换 API 地址或预设后不能沿用原密钥。')
      return
    }
    operation.current = true
    setBusy(kind)
    setError('')
    setNotice('')
    try {
      const next = kind === 'save'
        ? await window.lightTranslate.saveModelSettings({ provider: provider.trim(), model: model.trim(), baseUrl: baseUrl.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
        : kind === 'file'
          ? await window.lightTranslate.importProfileFile()
          : await window.lightTranslate.reimportProfile()
      if (!next) return // A dismissed native file dialog is not an error.
      onConfigured(next)
      if (!mounted.current) return
      setApiKey('')
      setNotice(kind === 'save' ? '配置已保存，立即生效，无需重启。' : '配置已导入并在本机安全保存，立即生效，无需重启。')
      try {
        const current = await window.lightTranslate.getModelSettings()
        if (mounted.current) populate(current)
      } catch {
        if (mounted.current) {
          setSaved(null)
          setError('配置已生效，但无法刷新编辑字段。请关闭设置面板后重新打开。')
        }
      }
    } catch (reason) {
      if (mounted.current) {
        // Do not reflect a submitted key even if an unexpected error repeats it.
        const message = reason instanceof Error ? reason.message : '配置操作失败，请检查输入后重试。'
        const submittedKey = apiKey.trim()
        let safeMessage = apiKey ? message.split(apiKey).join('[已隐藏密钥]') : message
        if (submittedKey) safeMessage = safeMessage.split(submittedKey).join('[已隐藏密钥]')
        setError(safeMessage)
      }
    } finally {
      operation.current = false
      if (mounted.current) setBusy(null)
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void apply('save') }
  function close() { setApiKey(''); onClose() }

  return <section id="model-settings" className="model-settings-panel" aria-label="模型设置" aria-busy={disabled}>
    <div className="model-settings-heading"><strong>模型设置</strong><button type="button" onClick={close}>收起设置</button></div>
    <p className="model-settings-description">设置本工具使用的翻译模型。保存或导入会替换当前模型。</p>
    {loading && <p role="status">正在读取配置…</p>}
    <form onSubmit={submit} autoComplete="off">
      <fieldset disabled={disabled}>
        <label className="model-settings-field">快速填写<select aria-label="模型预设" value="" onChange={event => selectPreset(event.target.value)}><option value="">选择预设…</option><option value="deepseek">DeepSeek 官方</option><option value="custom">自定义 OpenAI 兼容服务</option></select></label>
        <div className="model-settings-grid">
          <label className="model-settings-field">Provider 名称<input name="provider" value={provider} onChange={event => setProvider(event.target.value)} required placeholder="例如 DeepSeek" maxLength={100} /></label>
          <label className="model-settings-field">Model ID<input name="model" value={model} onChange={event => setModel(event.target.value)} required placeholder="例如 deepseek-v4-flash" maxLength={200} spellCheck={false} /></label>
        </div>
        <label className="model-settings-field">API 地址<input name="baseUrl" type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} required placeholder="https://api.deepseek.com" spellCheck={false} autoCapitalize="none" /></label>
        <label className="model-settings-field">API Key<input name="apiKey" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} required={!canKeepKey} placeholder={canKeepKey ? '已保存密钥；留空保留现有值' : '输入此服务的 API Key'} autoComplete="new-password" spellCheck={false} autoCapitalize="none" /></label>
        <p className="model-key-hint">{canKeepKey ? '已有密钥不会显示。留空保留当前密钥，填写则替换。' : '此设置需要新密钥。切换服务时不会沿用原密钥。'}</p>
        <div className="model-settings-save"><button className="primary-button" type="submit">{busy === 'save' ? '正在保存…' : '保存配置'}</button></div>
      </fieldset>
    </form>
    <div className="model-import-actions">
      <button type="button" disabled={disabled} onClick={() => void apply('file')}>{busy === 'file' ? '正在导入…' : '导入已有配置文件'}</button>
      <button type="button" disabled={disabled} onClick={() => void apply('legacy')}>{busy === 'legacy' ? '正在导入…' : '从旧版重新导入'}</button>
      <p>两种导入都会替换当前模型；旧版导入从原有程序配置中读取。</p>
    </div>
    {error && <div className="model-settings-error" role="alert">{error}</div>}
    {notice && <div className="model-settings-notice" role="status">{notice}</div>}
  </section>
}
