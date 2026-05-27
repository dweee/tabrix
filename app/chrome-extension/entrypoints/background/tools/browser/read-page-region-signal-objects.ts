import type { ReadPageRegionObject, ReadPageRegionType } from '@tabrix/shared';
import {
  TEXT_AUTHENTICATED_PATTERN,
  TEXT_AUTH_MODAL_HIDDEN_PATTERN,
  TEXT_AUTH_MODAL_PATTERN,
  TEXT_FEEDBACK_PATTERN,
  TEXT_LOGGED_OUT_PATTERN,
  TEXT_QR_EXPIRED_PATTERN,
  TEXT_MENU_PATTERN,
  TEXT_NAVIGATION_PATTERN,
  TEXT_QR_PATTERN,
} from './read-page-perception-neutral';

export interface ReadPageVisualElementHint {
  id: string;
  label: string;
  selector: string;
  role?: string;
  rect?: { x: number; y: number; width: number; height: number } | null;
  visualSignature?: string;
  qrSignal?: boolean;
  reason: string;
  confidence: number;
}

export function buildVisualElementRegionObjects(
  visualElements: readonly ReadPageVisualElementHint[] | undefined,
): Array<{ regionType: ReadPageRegionType; object: ReadPageRegionObject }> {
  const items = Array.isArray(visualElements) ? visualElements : [];
  return items
    .filter((item) => item.selector && item.qrSignal === true)
    .slice(0, 3)
    .map((item) => ({
      regionType: 'qr_code' as const,
      object: {
        objectId: item.id,
        label: 'QR visual element candidate',
        objectType: item.visualSignature ? `qr_visual:${item.visualSignature}` : 'qr_visual',
        role: item.role || 'img',
        actionTypes: ['capture_element'],
        targetability: 'locator_chain',
        locatorChain: [{ type: 'css', value: item.selector }],
        confidence: clampConfidence(item.confidence),
        reason: item.reason || 'qr_visual_element_signal',
        layoutHint: item.rect ? 'inline' : 'unknown',
      },
    }));
}

export function buildTextSignalRegionObjects(
  visibleTextContent: string | null | undefined,
): Array<{ regionType: ReadPageRegionType; object: ReadPageRegionObject }> {
  const normalized = String(visibleTextContent || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length < 20) return [];

  const signals: Array<{ regionType: ReadPageRegionType; object: ReadPageRegionObject }> = [];
  const authenticated = TEXT_AUTHENTICATED_PATTERN.test(normalized);
  const loggedOut = !authenticated && TEXT_LOGGED_OUT_PATTERN.test(normalized);
  const authModalVisible = TEXT_AUTH_MODAL_PATTERN.test(normalized);
  const authModalHidden = TEXT_AUTH_MODAL_HIDDEN_PATTERN.test(normalized);
  const qrVisible = TEXT_QR_PATTERN.test(normalized) && (authModalVisible || !authModalHidden);
  const qrExpired = qrVisible && TEXT_QR_EXPIRED_PATTERN.test(normalized);
  const logoutActionVisible = /\b(?:log[ -]?out|sign[ -]?out)\b|退出|注销/i.test(normalized);

  if (authenticated || loggedOut) {
    signals.push({
      regionType: 'account',
      object: textSignalObject({
        objectId: 'text_signal_account_state',
        label: authenticated
          ? 'authenticated account state signal'
          : 'login required account state signal',
        confidence: authenticated ? 0.66 : 0.62,
        reason: authenticated
          ? 'visible_text_authenticated_state_signal'
          : 'visible_text_logged_out_state_signal',
      }),
    });
  }

  if (TEXT_MENU_PATTERN.test(normalized)) {
    signals.push({
      regionType: 'menu',
      object: textSignalObject({
        objectId: 'text_signal_menu_action',
        label: logoutActionVisible
          ? 'account menu logout action text signal'
          : 'account menu action text signal',
        confidence: logoutActionVisible ? 0.62 : 0.58,
        reason: logoutActionVisible
          ? 'visible_text_logout_action_signal'
          : 'visible_text_menu_action_signal',
      }),
    });
  }

  if (authModalVisible) {
    signals.push({
      regionType: 'modal',
      object: textSignalObject({
        objectId: 'text_signal_auth_modal',
        label: 'auth modal visible text signal',
        confidence: 0.62,
        reason: 'visible_text_auth_modal_signal',
      }),
    });
  }

  if (qrVisible) {
    signals.push({
      regionType: 'qr_code',
      object: textSignalObject({
        objectId: 'text_signal_qr_code',
        label: qrExpired ? 'QR code expired refresh text signal' : 'QR code scan login text signal',
        confidence: qrExpired ? 0.68 : 0.62,
        reason: qrExpired ? 'visible_text_qr_expired_signal' : 'visible_text_qr_signal',
      }),
    });
  }

  if (TEXT_FEEDBACK_PATTERN.test(normalized)) {
    signals.push({
      regionType: 'feedback',
      object: textSignalObject({
        objectId: 'text_signal_feedback',
        label: 'feedback text signal',
        confidence: 0.56,
        reason: 'visible_text_feedback_signal',
      }),
    });
  }

  if (TEXT_NAVIGATION_PATTERN.test(normalized)) {
    signals.push({
      regionType: 'navigation',
      object: textSignalObject({
        objectId: 'text_signal_navigation',
        label: 'navigation text signal',
        confidence: 0.54,
        reason: 'visible_text_navigation_signal',
      }),
    });
  }

  if (normalized.length >= 500) {
    signals.push({
      regionType: 'content',
      object: textSignalObject({
        objectId: 'text_signal_content',
        label: 'visible content text signal',
        confidence: 0.52,
        reason: 'visible_text_content_signal',
      }),
    });
  }

  return signals;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.min(1, Math.max(0, value)).toFixed(3));
}

function textSignalObject(params: {
  objectId: string;
  label: string;
  confidence: number;
  reason: string;
}): ReadPageRegionObject {
  return {
    objectId: params.objectId,
    label: params.label,
    objectType: 'text_signal',
    actionTypes: [],
    targetability: 'not_clickable',
    confidence: params.confidence,
    reason: params.reason,
  };
}
