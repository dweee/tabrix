import { describe, expect, it, vi } from 'vitest';

import { sampleVisibleTextContent } from '../entrypoints/background/tools/browser/read-page-visible-text-content';

describe('read-page visible text content sampling', () => {
  it('samples visible text from the requested frame', async () => {
    const executeScript = vi.fn().mockResolvedValue([{ result: '  第一行\n第二行  ' }]);

    const text = await sampleVisibleTextContent({
      tabId: 81,
      frameId: 9,
      executeScript,
    });

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 81, frameIds: [9] },
        args: [12_000],
      }),
    );
    expect(text).toBe('  第一行\n第二行  ');
  });

  it('returns null for empty sampled text', async () => {
    await expect(
      sampleVisibleTextContent({
        tabId: 81,
        executeScript: vi.fn().mockResolvedValue([{ result: '   ' }]),
      }),
    ).resolves.toBeNull();
  });

  it('returns null when script injection fails', async () => {
    await expect(
      sampleVisibleTextContent({
        tabId: 81,
        executeScript: vi.fn().mockRejectedValue(new Error('cannot inject')),
      }),
    ).resolves.toBeNull();
  });
});
