import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cdpSessionManager,
  type CDPDetachListener,
  type CDPEventListener,
} from '@/utils/cdp-session-manager';

describe('CDP session manager listener routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes debugger event listeners through the central manager', () => {
    const listener: CDPEventListener = () => {};

    cdpSessionManager.addEventListener(listener);
    cdpSessionManager.removeEventListener(listener);

    expect(chrome.debugger.onEvent.addListener).toHaveBeenCalledWith(listener);
    expect(chrome.debugger.onEvent.removeListener).toHaveBeenCalledWith(listener);
  });

  it('routes debugger detach listeners through the central manager', () => {
    const listener: CDPDetachListener = () => {};

    cdpSessionManager.addDetachListener(listener);
    cdpSessionManager.removeDetachListener(listener);

    expect(chrome.debugger.onDetach.addListener).toHaveBeenCalledWith(listener);
    expect(chrome.debugger.onDetach.removeListener).toHaveBeenCalledWith(listener);
  });
});
