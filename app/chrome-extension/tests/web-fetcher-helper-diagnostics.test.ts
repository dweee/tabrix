import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadWebFetcherHelper() {
  vi.resetModules();
  delete (window as unknown as { __WEB_FETCHER_HELPER_INITIALIZED__?: boolean })
    .__WEB_FETCHER_HELPER_INITIALIZED__;
  await import('../inject-scripts/web-fetcher-helper.js');
}

function dispatchWebFetcher(request: Record<string, unknown>) {
  const addListener = chrome.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>;
  const listener = addListener.mock.calls.at(-1)?.[0] as
    | ((request: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean)
    | undefined;
  if (!listener) {
    throw new Error('web fetcher helper listener was not registered');
  }
  return new Promise<Record<string, unknown>>((resolve) => {
    listener(request, {}, (response) => resolve(response as Record<string, unknown>));
  });
}

describe('web fetcher content diagnostics', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    await loadWebFetcherHelper();
  });

  it('reports long internal scroll containers without scrolling the page', async () => {
    document.body.innerHTML = `
      <main>
        <div id="answer" class="scroll-area">
          <p>物模型包含静态属性和时序属性。</p>
          <p>可控调节属性与服务/动作需要区分。</p>
          <p>W3C 和 OPC UA 的属性与动作分层可以作为参考。</p>
          <p>空调、固件升级、总结这些后半段内容必须被保留。</p>
        </div>
      </main>
    `;
    const answer = document.querySelector('#answer') as HTMLElement;
    Object.defineProperty(document.body, 'innerText', {
      configurable: true,
      value: '物模型包含静态属性和时序属性。',
    });
    Object.defineProperty(answer, 'innerText', {
      configurable: true,
      value:
        '物模型包含静态属性和时序属性。可控调节属性与服务/动作需要区分。W3C 和 OPC UA 的属性与动作分层可以作为参考。空调、固件升级、总结这些后半段内容必须被保留。',
    });
    Object.defineProperty(answer, 'scrollHeight', { configurable: true, value: 1600 });
    Object.defineProperty(answer, 'clientHeight', { configurable: true, value: 320 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 640,
      height: 320,
      top: 0,
      right: 640,
      bottom: 320,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const shortClone = document.implementation.createHTMLDocument('short');
    shortClone.body.innerHTML = '<main><p>物模型包含静态属性和时序属性。</p></main>';
    vi.spyOn(document, 'cloneNode').mockReturnValue(shortClone as unknown as Node);

    const response = await dispatchWebFetcher({ action: 'getTextContent' });

    expect(response.success).toBe(true);
    expect(response.contentDiagnostics).toMatchObject({
      scrollContainerCandidateCount: 1,
      longScrollableContentLikely: true,
    });
    const diagnostics = response.contentDiagnostics as {
      scrollContainers: Array<{ id: string; textPreview: string }>;
    };
    expect(diagnostics.scrollContainers[0]).toMatchObject({
      id: 'answer',
    });
    expect(diagnostics.scrollContainers[0].textPreview).toContain('W3C');
    expect(diagnostics.scrollContainers[0].textPreview).toContain('固件升级');
  });

  it('can return full visible page text separately from body extraction', async () => {
    document.body.innerHTML = `
      <nav>Docs API Reference Version 16</nav>
      <main>
        <article>
          <h1>Installation</h1>
          <p>Manual installation and system requirements are the task body.</p>
        </article>
      </main>
    `;
    Object.defineProperty(document.body, 'innerText', {
      configurable: true,
      value:
        'Docs API Reference Version 16\nInstallation\nManual installation and system requirements are the task body.',
    });
    const articleClone = document.implementation.createHTMLDocument('article');
    articleClone.body.innerHTML =
      '<article><h1>Installation</h1><p>Manual installation and system requirements are the task body.</p></article>';
    vi.spyOn(document, 'cloneNode').mockReturnValue(articleClone as unknown as Node);

    const bodyResponse = await dispatchWebFetcher({ action: 'getTextContent' });
    const fullVisibleResponse = await dispatchWebFetcher({
      action: 'getTextContent',
      textMode: 'full-visible',
    });

    expect(bodyResponse.success).toBe(true);
    expect(fullVisibleResponse.success).toBe(true);
    expect(bodyResponse.textMode).toBe('body');
    expect(bodyResponse.textContentSource).toBe('readability_body_text');
    expect(String(bodyResponse.textContent)).not.toContain('API Reference');
    expect(fullVisibleResponse.textMode).toBe('full-visible');
    expect(fullVisibleResponse.textContentSource).toBe('document_body_innerText');
    expect(String(fullVisibleResponse.textContent)).toContain('API Reference');
    expect(String(fullVisibleResponse.textContent)).toContain('Manual installation');
  });
});
