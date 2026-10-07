import { execFile } from 'node:child_process';

export interface EdgeSource { hwnd: string; pid: number }
let copyPending = false;
const safeFallback = '无法安全复制当前选区，请手动复制后粘贴到翻译面板。';
const helperErrors = new Set([
  '原 Edge 窗口已切换或关闭，请重新选择文字。', '剪贴板正在被其他应用使用，请稍后重试。',
  '无法完整保存当前剪贴板，未执行复制。', '当前剪贴板包含不支持安全恢复的格式。请手动复制并粘贴到翻译面板。',
  '无法保存剪贴板图片，未执行复制。', '剪贴板包含无法安全复制或过大的数据，未执行复制。', '剪贴板在保存期间发生变化，未执行复制。',
  '当前剪贴板数据超过 64 MiB，未执行复制。请手动粘贴文字。', '无法读取剪贴板格式，未执行复制。', '无法分配剪贴板备份空间，未执行复制。',
  '无法保存剪贴板格式，未执行复制。', '未能恢复原剪贴板，请检查剪贴板内容后重试。', '原剪贴板未能完整恢复，已停止翻译。请检查剪贴板内容。',
  '请松开 Ctrl、Alt、Shift 和 Windows 键后重试。未执行复制。', '剪贴板已经变化，未执行复制。',
  'Edge 未提供新的复制文本，请重新选择，或手动复制后粘贴到翻译面板。', '剪贴板已被其他操作修改，未读取或覆盖其内容。',
  '无法向 Edge 发送复制操作，请手动复制后粘贴。', '当前选区没有可复制的文字，请重新选择。', '复制文本为空或超过 12000 字符，请缩小选区。',
  '无法读取复制文本，请重试。', 'Edge 返回了无效的复制文本。', '复制请求无效，请重新选择文字。', safeFallback
]);
function validSource(value: unknown): value is EdgeSource {
  const item = value as EdgeSource | null;
  return !!item && typeof item.hwnd === 'string' && /^[1-9][0-9]{0,18}$/.test(item.hwnd) && Number.isSafeInteger(item.pid) && item.pid > 0 && item.pid <= 0x7fffffff;
}
function invoke(helperPath: string, args: string[], timeout?: number): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(helperPath, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 256 * 1024, ...(timeout ? { timeout } : {}) }, (error, stdout) => {
      let result: any;
      try { result = JSON.parse(stdout); } catch { reject(new Error(safeFallback)); return; }
      if (result?.ok === true && !error) resolve(result);
      else reject(new Error(typeof result?.error === 'string' && helperErrors.has(result.error) ? result.error : safeFallback));
    });
  });
}
export async function probeEdgeSource(helperPath: string): Promise<EdgeSource | null> {
  try { const result = await invoke(helperPath, ['probe'], 2500); return validSource(result.source) ? { hwnd: result.source.hwnd, pid: result.source.pid } : null; }
  catch { return null; }
}
export async function copyEdgeSelection(helperPath: string, source: EdgeSource): Promise<string> {
  if (!validSource(source)) throw new Error('复制请求无效，请重新选择文字。');
  if (copyPending) throw new Error('正在读取另一个选区，请稍后重试。');
  copyPending = true;
  try {
    // No subprocess hard timeout: after Ctrl+C the helper must be allowed to run its restoration finally.
    const result = await invoke(helperPath, ['copy', source.hwnd, String(source.pid)]);
    if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 12000) throw new Error(safeFallback);
    return result.text;
  } finally { copyPending = false; }
}
