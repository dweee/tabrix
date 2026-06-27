import type { ReadPageSensingDiagnostic } from '@tabrix/shared';

import { appendObjectSensingDiagnostic } from './read-page-sensing-diagnostics';

export interface SyntheticRefBindingResult {
  attempted: number;
  bound: number;
  sensingDiagnostic?: ReadPageSensingDiagnostic;
}

export async function bindSyntheticRefsToSelectors(
  tabId: number,
  refMap: Array<{ ref?: unknown; selector?: unknown } | null>,
  frameId?: number,
): Promise<SyntheticRefBindingResult> {
  const entries = refMap
    .map((entry) => ({
      ref: typeof entry?.ref === 'string' ? entry.ref.trim() : '',
      selector: typeof entry?.selector === 'string' ? entry.selector.trim() : '',
    }))
    .filter(
      (entry) =>
        (entry.ref.startsWith('ref_text_search_toolbar_') ||
          entry.ref.startsWith('ref_text_filter_panel_') ||
          entry.ref.startsWith('ref_text_control_')) &&
        entry.selector,
    );
  if (entries.length === 0) return { attempted: 0, bound: 0 };

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId, ...(typeof frameId === 'number' ? { frameIds: [frameId] } : {}) },
      world: 'ISOLATED',
      func: (bindings: Array<{ ref: string; selector: string }>) => {
        try {
          const pageWindow = window as any;
          if (!pageWindow.__claudeElementMap) pageWindow.__claudeElementMap = {};
          let bound = 0;
          for (const binding of bindings) {
            if (!binding?.ref || !binding?.selector) continue;
            const element = document.querySelector(binding.selector);
            if (!(element instanceof Element)) continue;
            pageWindow.__claudeElementMap[binding.ref] = new WeakRef(element);
            bound += 1;
          }
          return { bound };
        } catch (error) {
          return {
            bound: 0,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      args: [entries],
    } as any);
    const resultValue = result?.[0]?.result as { bound?: unknown; error?: unknown } | undefined;
    const bound = resultValue?.bound;
    const safeBound = typeof bound === 'number' && Number.isFinite(bound) ? bound : 0;
    if (safeBound >= entries.length) {
      return { attempted: entries.length, bound: safeBound };
    }
    const errorMessage =
      typeof resultValue?.error === 'string' && resultValue.error.trim()
        ? `: ${resultValue.error.replace(/\s+/g, ' ').slice(0, 100)}`
        : '';
    return {
      attempted: entries.length,
      bound: safeBound,
      sensingDiagnostic: {
        source: errorMessage ? 'target_ref_binding.failed' : 'target_ref_binding.partial',
        message: `recovered target refs bound ${safeBound}/${entries.length}${errorMessage}`,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      attempted: entries.length,
      bound: 0,
      sensingDiagnostic: {
        source: 'target_ref_binding.failed',
        message: `recovered target ref binding failed: ${message.replace(/\s+/g, ' ').slice(0, 120)}`,
      },
    };
  }
}

export function appendSyntheticRefBindingDiagnostic(
  basePayload: Record<string, any>,
  binding: SyntheticRefBindingResult,
): void {
  if (!binding.sensingDiagnostic) return;
  basePayload.sensingDiagnostics = appendObjectSensingDiagnostic(
    basePayload.sensingDiagnostics,
    binding.sensingDiagnostic,
  );
}
