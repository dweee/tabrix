import { initNativeHostListener } from './native-host';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { buildPopupBrowserWorldOverview } from '@/common/popup-browser-world-overview';
import { initBrowserWorldInventory, refreshBrowserWorldSnapshot } from './browser-world-inventory';

/**
 * Background script entry point
 * Initializes all background services and listeners.
 *
 * The local-model / semantic-similarity / storage-manager services were
 * removed as part of the MKEP pruning.
 * Any future MKEP Memory/Knowledge indexing will bring up its own service
 * from `background/memory/` or `background/knowledge/`.
 */
export default defineBackground(() => {
  initBrowserWorldInventory();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== BACKGROUND_MESSAGE_TYPES.GET_BROWSER_WORLD_OVERVIEW) {
      return undefined;
    }

    refreshBrowserWorldSnapshot({ ensureBaselineReady: true })
      .then((snapshot) => {
        sendResponse({
          success: true,
          overview: buildPopupBrowserWorldOverview(snapshot),
        });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true;
  });

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      chrome.tabs.create({
        url: chrome.runtime.getURL('/welcome.html'),
      });
    }
  });

  initNativeHostListener();
});
