import { describe, expect, it, vi } from 'vitest';
import { createSseParser, endpointFor, translate } from '../src/main/translation';
import { fitBounds, replaceableResults } from '../src/main/windowPolicy';
const profile = { provider: 'Test', model: 'mock', baseUrl: 'https://example.invalid/v1', apiKey: 'fake-test-secret' };
const sseResponse = (parts: string[]) => new Response(new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });

describe('translation protocol', () => {
  it('joins fragmented CRLF SSE records and emits accumulated text', () => {
    const chunks: string[] = [], parser = createSseParser(text => chunks.push(text));
    for (const part of ['data: {"choices":[{"delta":{"content":"你"}}]}\r', '\n\r\ndata: {"choices":[{"delta":', '{"content":"好"}}]}\n\ndata: [DONE]\n\n']) parser.push(part);
    expect(parser.finish()).toBe('你好'); expect(chunks).toEqual(['你', '你好']); expect(parser.done).toBe(true);
  });
  it('consumes an SSE response and disables redirects on authenticated fetch', async () => {
    const fetcher = vi.fn(async () => sseResponse(['data: {"choices":[{"delta":{"content":"OK"}}]}\n\n', 'data: [DONE]\n\n'])) as unknown as typeof fetch;
    expect(await translate(profile, 'text', 'en-us', new AbortController().signal, () => {}, fetcher)).toBe('OK');
    expect(fetcher).toHaveBeenCalledWith('https://example.invalid/v1/chat/completions', expect.objectContaining({ redirect: 'error' }));
  });
  it.each([
    ['https://api.deepseek.com', true],
    ['https://API.DEEPSEEK.COM/v1/', true],
    ['https://api.deepseek.com/chat/completions', true],
    ['https://api.siliconflow.cn/v1', false],
    ['https://api.deepseek.com.example.invalid/v1', false],
  ])('uses non-thinking translation only for the official DeepSeek host: %s', async (baseUrl, official) => {
    const fetcher = vi.fn(async (_url: unknown, _options: RequestInit | undefined) => sseResponse(['data: {"choices":[{"delta":{"content":"译文"}}]}\n\ndata: [DONE]\n\n']));
    const onText = vi.fn();
    const result = await translate({ ...profile, provider: 'DeepSeek', model: 'deepseek-v4-flash', baseUrl }, 'text', 'zh-cn', new AbortController().signal, onText, fetcher as typeof fetch);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    if (official) expect(body.thinking).toEqual({ type: 'disabled' });
    else expect(body).not.toHaveProperty('thinking');
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.stream).toBe(true);
    expect(body.messages[1]).toEqual({ role: 'user', content: 'text' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(onText).toHaveBeenCalledWith('译文');
    expect(result).toBe('译文');
  });
  it('handles JSON fallback', async () => {
    const chunk = vi.fn(); const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: '译文' } }] })) as unknown as typeof fetch;
    expect(await translate(profile, 'text', 'zh-cn', new AbortController().signal, chunk, fetcher)).toBe('译文'); expect(chunk).toHaveBeenCalledWith('译文');
  });
  it('rejects an oversized JSON body before parsing and cancels its reader', async () => {
    const cancel = vi.fn(), onText = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"padding":"')); controller.enqueue(new Uint8Array(1024 * 1024).fill(32)); controller.enqueue(new Uint8Array(1024 * 1024).fill(32)); }, cancel
    });
    const fetcher = vi.fn(async () => new Response(body, { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    await expect(translate(profile, 'text', 'en-us', new AbortController().signal, onText, fetcher)).rejects.toThrow('超过 2 MB');
    expect(cancel).toHaveBeenCalledOnce(); expect(onText).not.toHaveBeenCalled();
  });
  it('counts total SSE bytes across small valid events and cancels an oversized stream', async () => {
    const cancel = vi.fn(), event = new TextEncoder().encode(': ' + 'x'.repeat(65530) + '\n\n');
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (let index = 0; index < 34; index++) controller.enqueue(event); }, cancel });
    const fetcher = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
    await expect(translate(profile, 'text', 'en-us', new AbortController().signal, () => {}, fetcher)).rejects.toThrow('超过 2 MB');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects a provider error after partial SSE output without disclosing its payload', async () => {
    const chunks: string[] = [], cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      controller.enqueue(new TextEncoder().encode('data: {"error":{"message":"fake-test-secret private trace"}}\n\n'));
    }, cancel });
    const fetcher = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
    await expect(translate(profile, 'text', 'en-us', new AbortController().signal, text => chunks.push(text), fetcher)).rejects.toThrow('翻译服务报告请求失败，请检查服务配置或稍后重试。');
    expect(chunks).toEqual(['partial']); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([401, 402, 403, 429, 500])('sanitizes HTTP %i without response payload disclosure', async status => {
    const fetcher = vi.fn(async () => new Response('fake-test-secret private upstream trace', { status })) as unknown as typeof fetch;
    let failure = ''; try { await translate(profile, 'text', 'zh-cn', new AbortController().signal, () => {}, fetcher); } catch (error) { failure = (error as Error).message; }
    expect(failure).not.toContain('fake-test-secret'); expect(failure).not.toContain('upstream'); expect(failure.length).toBeGreaterThan(5);
  });
  it('describes HTTP 402 without asserting a confirmed account balance or exposing its body', async () => {
    const response = new Response('upstream-private-detail fake-test-secret', { status: 402 });
    const read = vi.spyOn(response, 'text');
    const fetcher = vi.fn(async () => response) as unknown as typeof fetch;
    await expect(translate(profile, 'text', 'zh-cn', new AbortController().signal, () => {}, fetcher)).rejects.toThrow('翻译服务拒绝了付费请求（HTTP 402），请检查该服务账户的余额或配额。');
    expect(read).not.toHaveBeenCalled();
  });
  it('does not issue a request after cancellation', async () => {
    const controller = new AbortController(); controller.abort(); const fetcher = vi.fn();
    await expect(translate(profile, 'text', 'en-us', controller.signal, () => {}, fetcher)).rejects.toThrow('翻译已取消'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels an in-flight request and distinguishes timeout', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new Error('private network detail'))); })) as typeof fetch;
    const pending = translate(profile, 'text', 'en-us', controller.signal, () => {}, fetcher); controller.abort('timeout');
    await expect(pending).rejects.toThrow('翻译超时');
  });
  it('rejects oversized text, invalid languages and unsafe endpoints', async () => {
    const fetcher = vi.fn();
    await expect(translate(profile, 'x'.repeat(12001), 'en-us', new AbortController().signal, () => {}, fetcher)).rejects.toThrow('12000');
    expect(() => endpointFor('http://remote.invalid/v1')).toThrow('HTTPS');
    expect(() => endpointFor('https://user:secret@example.invalid/v1')).toThrow();
    expect(endpointFor('http://localhost:1234/v1/')).toBe('http://localhost:1234/v1/chat/completions');
    expect(endpointFor('https://example.invalid/custom/chat/completions')).toBe('https://example.invalid/custom/chat/completions');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('window policy', () => {
  it('retains pinned results and manual windows while replacing unpinned results', () => {
    expect(replaceableResults([{ id: 1, kind: 'result', pinned: true }, { id: 2, kind: 'result', pinned: false }, { id: 3, kind: 'manual', pinned: false }, { id: 4, kind: 'toolbar', pinned: false }])).toEqual([2]);
  });
  it('clamps a window to a negative-origin secondary display', () => {
    const bounds = fitBounds({ x: -1, y: 1100 }, { width: 540, height: 540 }, { x: -1920, y: 0, width: 1920, height: 1080 });
    expect(bounds).toEqual({ width: 540, height: 540, x: -546, y: 534 });
  });
});
