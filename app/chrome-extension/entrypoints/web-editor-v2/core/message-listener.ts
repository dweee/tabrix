/**
 * Web Editor V2 Message Listener
 *
 * Handles chrome.runtime.onMessage communication with the background script.
 * Uses versioned action names (suffix _v2) to avoid conflicts with V1.
 */

import type {
  WebEditorV2Api,
  WebEditorV2Request,
  WebEditorV2PingResponse,
  WebEditorV2ToggleResponse,
  WebEditorV2StartResponse,
  WebEditorV2StopResponse,
} from '@/common/web-editor-types';
import { WEB_EDITOR_V2_ACTIONS } from '@/common/web-editor-types';

// =============================================================================
// Types
// =============================================================================

/** Function to remove the message listener */
export type RemoveMessageListener = () => void;

/** All possible V2 response types */
type WebEditorV2Response =
  | WebEditorV2PingResponse
  | WebEditorV2ToggleResponse
  | WebEditorV2StartResponse
  | WebEditorV2StopResponse;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Type guard to check if a request is a V2 editor request
 */
function isV2Request(request: unknown): request is WebEditorV2Request {
  if (!request || typeof request !== 'object') return false;

  const action = (request as { action?: unknown }).action;
  return (
    action === WEB_EDITOR_V2_ACTIONS.PING ||
    action === WEB_EDITOR_V2_ACTIONS.TOGGLE ||
    action === WEB_EDITOR_V2_ACTIONS.START ||
    action === WEB_EDITOR_V2_ACTIONS.STOP
  );
}

/**
 * Install the message listener for background communication.
 * Returns a function to remove the listener.
 *
 * @param api The WebEditorV2Api instance to delegate commands to
 * @returns Function to remove the listener
 */
export function installMessageListener(api: WebEditorV2Api): RemoveMessageListener {
  const listener = (
    request: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: WebEditorV2Response) => void,
  ): boolean => {
    // Only handle V2 requests
    if (!isV2Request(request)) {
      return false;
    }

    switch (request.action) {
      case WEB_EDITOR_V2_ACTIONS.PING: {
        const response: WebEditorV2PingResponse = {
          status: 'pong',
          active: api.getState().active,
          version: 2,
        };
        sendResponse(response);
        return false; // Synchronous response
      }

      case WEB_EDITOR_V2_ACTIONS.TOGGLE: {
        const response: WebEditorV2ToggleResponse = {
          active: api.toggle(),
        };
        sendResponse(response);
        return false;
      }

      case WEB_EDITOR_V2_ACTIONS.START: {
        api.start();
        const response: WebEditorV2StartResponse = {
          active: true,
        };
        sendResponse(response);
        return false;
      }

      case WEB_EDITOR_V2_ACTIONS.STOP: {
        api.stop();
        const response: WebEditorV2StopResponse = {
          active: false,
        };
        sendResponse(response);
        return false;
      }

      default:
        // Should never reach here due to type guard
        return false;
    }
  };

  chrome.runtime.onMessage.addListener(listener);

  return () => {
    chrome.runtime.onMessage.removeListener(listener);
  };
}
