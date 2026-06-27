const VISIBLE_TEXT_FALLBACK_MAX_CHARS = 12_000;

type VisibleTextScriptResult = {
  result?: unknown;
};

export type VisibleTextScriptExecutor = (details: {
  target: { tabId: number; frameIds?: number[] };
  func: typeof sampleDocumentBodyInnerText;
  args: [number];
}) => Promise<VisibleTextScriptResult[]>;

export function sampleDocumentBodyInnerText(maxChars: number): string {
  try {
    const text = document.body?.innerText || '';
    return typeof text === 'string' ? text.slice(0, maxChars) : '';
  } catch {
    return '';
  }
}

async function executeVisibleTextSample(params: {
  tabId: number;
  frameId?: number;
  executeScript?: VisibleTextScriptExecutor;
}): Promise<VisibleTextScriptResult[]> {
  const executor =
    params.executeScript ??
    ((details) =>
      chrome.scripting.executeScript(
        details as Parameters<typeof chrome.scripting.executeScript>[0],
      ) as Promise<VisibleTextScriptResult[]>);
  return executor({
    target: {
      tabId: params.tabId,
      ...(typeof params.frameId === 'number' ? { frameIds: [params.frameId] } : {}),
    },
    func: sampleDocumentBodyInnerText,
    args: [VISIBLE_TEXT_FALLBACK_MAX_CHARS],
  });
}

export async function sampleVisibleTextContent(params: {
  tabId: number;
  frameId?: number;
  executeScript?: VisibleTextScriptExecutor;
}): Promise<string | null> {
  try {
    const result = await executeVisibleTextSample(params);
    const text = result?.[0]?.result;
    return typeof text === 'string' && text.trim() ? text : null;
  } catch {
    return null;
  }
}
