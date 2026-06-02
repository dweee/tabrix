import type {
  ReadPageArtifactRef,
  ReadPageAssistantGuidance,
  ReadPageAuthArtifactStatus,
  ReadPageRegion,
} from '@tabrix/shared';
import type { BrowserWorldTabObject } from '../../browser-world-inventory';
import { canvasToDataURL, cropAndResizeImage } from '../../../../utils/image-utils';
import { prepareFileViaNative } from './native-file';
import {
  buildNotRequestedAuthArtifactStatus,
  canExtractAuthArtifactForTab,
} from './read-page-auth-artifact-policy';
import {
  AUTH_QR_ARTIFACT_KIND,
  AUTH_QR_ARTIFACT_TTL_MS,
  AUTH_QR_CLAIM_BOUNDARY,
} from './read-page-auth-guidance-copy';
import {
  findAuthQrCandidateByTargetRef,
  hasExpiredAuthQrSignal,
  hasObservedAuthSurfaceForQrExtraction,
  selectAuthQrArtifactCandidates,
  uniqueSelectors,
  type AuthQrArtifactCandidate,
} from './read-page-auth-qr-probe';

type AuthQrExtractionMethod =
  | 'img_data_url'
  | 'img_canvas'
  | 'canvas_to_data_url'
  | 'css_background_data_url'
  | 'element_screenshot';

interface ExtractedAuthQrImage {
  dataUrl?: string;
  method?: AuthQrExtractionMethod;
  width?: number;
  height?: number;
  selector?: string;
  rect?: { x: number; y: number; width: number; height: number };
  devicePixelRatio?: number;
  failureReason?: string;
}

function normalizeDataUrl(input: unknown): string | null {
  const value = typeof input === 'string' ? input.trim() : '';
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(value)) return value;
  return null;
}

async function extractAuthQrImageFromDom(
  tabId: number,
  selectors: string[],
  frameId?: number,
): Promise<ExtractedAuthQrImage> {
  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId, ...(typeof frameId === 'number' ? { frameIds: [frameId] } : {}) },
    world: 'MAIN',
    func: (candidateSelectors: string[]) => {
      function visibleRect(element: Element) {
        const rect = element.getBoundingClientRect();
        if (!rect || rect.width < 30 || rect.height < 30) return null;
        const style = window.getComputedStyle(element);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number(style.opacity || '1') <= 0.01
        ) {
          return null;
        }
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }

      function dataUrlFromBackground(styleValue: string): string | null {
        const match = /url\((['"]?)(data:image\/[^'")]+)\1\)/i.exec(styleValue || '');
        return match?.[2] || null;
      }

      async function dataUrlFromImage(image: HTMLImageElement): Promise<string | null> {
        const direct = image.currentSrc || image.src || '';
        if (/^data:image\//i.test(direct)) return direct;
        try {
          if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
            await image.decode();
          }
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          const context = canvas.getContext('2d');
          if (!context || canvas.width <= 0 || canvas.height <= 0) return null;
          context.drawImage(image, 0, 0);
          return canvas.toDataURL('image/png');
        } catch {
          return null;
        }
      }

      function collectQrSourceElements(root: Element): Element[] {
        const sourceSelector = [
          'img',
          'canvas',
          'svg',
          '[style]',
          '[class*="qr"]',
          '[class*="QR"]',
          '[class*="qrcode"]',
          '[class*="QRCode"]',
          '[aria-label*="qr"]',
          '[aria-label*="QR"]',
          '[aria-label*="二维码"]',
          '[alt*="qr"]',
          '[alt*="QR"]',
          '[alt*="二维码"]',
          '[title*="qr"]',
          '[title*="QR"]',
          '[title*="二维码"]',
        ].join(', ');
        const seen = new Set<Element>();
        const result: Element[] = [];
        const add = (element: Element | null) => {
          if (!element || seen.has(element)) return;
          seen.add(element);
          result.push(element);
        };
        add(root);
        try {
          for (const element of Array.from(root.querySelectorAll(sourceSelector))) add(element);
        } catch {
          /* keep root-only inspection */
        }
        return result;
      }

      function elementTextSignal(element: Element): string {
        const attrs = [
          element.getAttribute('role') || '',
          element.getAttribute('aria-label') || '',
          element.getAttribute('aria-labelledby') || '',
          element.getAttribute('title') || '',
          element.getAttribute('class') || '',
          element.getAttribute('id') || '',
        ].join(' ');
        return `${attrs} ${(element.textContent || '').slice(0, 1600)}`;
      }

      function hasAuthSignal(element: Element): boolean {
        return /\b(auth|login|log in|sign in|signin|account)\b|登录|授权|账号/i.test(
          elementTextSignal(element),
        );
      }

      function isReasonableAuthRoot(element: Element): boolean {
        const rect = visibleRect(element);
        if (!rect) return false;
        const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
        const area = rect.width * rect.height;
        if (area > viewportArea * 0.92 && element !== document.body) return false;
        return hasAuthSignal(element);
      }

      function cssSelectorForElement(element: Element): string {
        const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id');
        if (testId) return `[data-testid="${String(testId).replace(/"/g, '\\"')}"]`;
        const id = element.getAttribute('id');
        if (id && !/\s/.test(id)) return `#${String(id).replace(/"/g, '\\"')}`;
        const tagName = element.tagName ? element.tagName.toLowerCase() : 'element';
        const className = String(element.getAttribute('class') || '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((item) => `.${item.replace(/[^a-zA-Z0-9_-]/g, '')}`)
          .join('');
        return `${tagName}${className || ''}`;
      }

      function collectAuthRoots(): Element[] {
        const rootSelector = [
          '[role="dialog"]',
          '[aria-modal="true"]',
          'dialog',
          'form',
          '[class*="auth" i]',
          '[class*="login" i]',
          '[class*="signin" i]',
          '[class*="modal" i]',
          '[id*="auth" i]',
          '[id*="login" i]',
          '[id*="signin" i]',
        ].join(', ');
        const seen = new Set<Element>();
        const result: Element[] = [];
        const add = (element: Element | null) => {
          if (!element || seen.has(element) || !isReasonableAuthRoot(element)) return;
          seen.add(element);
          result.push(element);
        };
        try {
          for (const element of Array.from(document.querySelectorAll(rootSelector))) add(element);
        } catch {
          /* keep ancestor-based discovery below */
        }
        try {
          for (const source of collectQrSourceElements(document.body)) {
            let current: Element | null = source;
            for (let depth = 0; current && depth < 6; depth += 1) {
              if (isReasonableAuthRoot(current)) {
                add(current);
                break;
              }
              current = current.parentElement;
            }
          }
        } catch {
          /* no direct DOM probe */
        }
        return result;
      }

      function scoreQrSourceElement(element: Element, root: Element, index: number): number {
        const rect = visibleRect(element);
        if (!rect) return -1;
        const area = rect.width * rect.height;
        if (area < 900 || area > 220000) return -1;
        const aspectRatio = rect.width / Math.max(1, rect.height);
        if (aspectRatio < 0.55 || aspectRatio > 1.75) return -1;
        const tagName = element.tagName ? element.tagName.toLowerCase() : '';
        const style = window.getComputedStyle(element);
        const signal = [
          tagName,
          element.getAttribute('class') || '',
          element.getAttribute('aria-label') || '',
          element.getAttribute('alt') || '',
          element.getAttribute('title') || '',
          element.getAttribute('src') || '',
          element.getAttribute('currentSrc') || '',
          style.backgroundImage || '',
        ].join(' ');
        let score = 0;
        if (element !== root) score += 16;
        if (/^(img|canvas|svg)$/.test(tagName)) score += 40;
        if (style.backgroundImage && style.backgroundImage !== 'none') score += 32;
        if (/\bqr|qrcode|scan\b|二维码|扫码|扫一扫/i.test(signal)) score += 34;
        if (rect.width >= 90 && rect.width <= 420 && rect.height >= 90 && rect.height <= 420) {
          score += 24;
        }
        score -= Math.min(12, index * 2);
        return score;
      }

      async function inspectRenderableElement(
        element: Element,
        selector: string,
      ): Promise<ExtractedAuthQrImage> {
        const rect = visibleRect(element);
        if (!rect) return { failureReason: 'qr_element_not_visible' };

        if (element instanceof HTMLImageElement) {
          const dataUrl = await dataUrlFromImage(element);
          if (dataUrl) {
            return {
              dataUrl,
              method: /^data:image\//i.test(element.currentSrc || element.src || '')
                ? 'img_data_url'
                : 'img_canvas',
              width: Math.round(element.naturalWidth || rect.width),
              height: Math.round(element.naturalHeight || rect.height),
              selector,
              rect,
              devicePixelRatio: window.devicePixelRatio || 1,
            };
          }
        }

        if (element instanceof HTMLCanvasElement) {
          try {
            return {
              dataUrl: element.toDataURL('image/png'),
              method: 'canvas_to_data_url',
              width: Math.round(element.width || rect.width),
              height: Math.round(element.height || rect.height),
              selector,
              rect,
              devicePixelRatio: window.devicePixelRatio || 1,
            };
          } catch {
            /* screenshot fallback below */
          }
        }

        const backgroundDataUrl = dataUrlFromBackground(
          window.getComputedStyle(element).backgroundImage,
        );
        if (backgroundDataUrl) {
          return {
            dataUrl: backgroundDataUrl,
            method: 'css_background_data_url',
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            selector,
            rect,
            devicePixelRatio: window.devicePixelRatio || 1,
          };
        }

        return {
          method: 'element_screenshot',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          selector,
          rect,
          devicePixelRatio: window.devicePixelRatio || 1,
        };
      }

      async function inspectElement(selector: string): Promise<ExtractedAuthQrImage> {
        let element: Element | null = null;
        try {
          element = document.querySelector(selector);
        } catch {
          return { failureReason: 'invalid_qr_selector' };
        }
        if (!element) return { failureReason: 'qr_element_not_found' };

        const rect = visibleRect(element);
        if (!rect) return { failureReason: 'qr_element_not_visible' };

        const sourceElements = collectQrSourceElements(element)
          .map((source, index) => ({
            source,
            score: scoreQrSourceElement(source, element, index),
            index,
          }))
          .filter((item) => item.score >= 0)
          .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return left.index - right.index;
          });

        let screenshotFallback: ExtractedAuthQrImage | null = null;
        for (const { source } of sourceElements) {
          const extracted = await inspectRenderableElement(source, selector);
          if (extracted.dataUrl) return extracted;
          if (extracted.method === 'element_screenshot' && !screenshotFallback) {
            screenshotFallback = extracted;
          }
        }
        return screenshotFallback || { failureReason: 'auth_qr_image_unavailable' };
      }

      async function inspectDiscoveredAuthQr(): Promise<ExtractedAuthQrImage> {
        const roots = collectAuthRoots();
        for (const root of roots) {
          const sourceElements = collectQrSourceElements(root)
            .map((source, index) => ({
              source,
              score: scoreQrSourceElement(source, root, index),
              index,
            }))
            .filter((item) => item.score >= 0)
            .sort((left, right) => {
              if (right.score !== left.score) return right.score - left.score;
              return left.index - right.index;
            });
          let screenshotFallback: ExtractedAuthQrImage | null = null;
          for (const { source } of sourceElements) {
            const selector = cssSelectorForElement(source);
            const extracted = await inspectRenderableElement(source, selector);
            if (extracted.dataUrl) return extracted;
            if (extracted.method === 'element_screenshot' && !screenshotFallback) {
              screenshotFallback = extracted;
            }
          }
          if (screenshotFallback) return screenshotFallback;
        }
        return { failureReason: 'auth_qr_dom_auth_surface_not_found' };
      }

      return (async () => {
        if (candidateSelectors.length === 0) {
          return inspectDiscoveredAuthQr();
        }
        for (const selector of candidateSelectors) {
          const result = await inspectElement(selector);
          if (result.dataUrl || result.method === 'element_screenshot') return result;
        }
        return { failureReason: 'auth_qr_image_unavailable' };
      })();
    },
    args: [selectors],
  } as any);

  return (injectionResult?.result || {
    failureReason: 'auth_qr_dom_extraction_unavailable',
  }) as ExtractedAuthQrImage;
}

async function captureElementScreenshot(
  tabId: number,
  windowId: number | null,
  extraction: ExtractedAuthQrImage,
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (!extraction.rect) throw new Error('missing QR element rect for screenshot fallback');
  if (typeof windowId !== 'number') {
    throw new Error('auth_qr_screenshot_fallback_target_tab_not_proven');
  }
  let activeTabId: number | undefined;
  try {
    const activeTabs = await chrome.tabs.query({ windowId, active: true });
    activeTabId = activeTabs[0]?.id;
  } catch {
    throw new Error('auth_qr_screenshot_fallback_active_tab_unknown');
  }
  if (activeTabId !== tabId) {
    throw new Error('auth_qr_screenshot_fallback_target_tab_not_active');
  }
  const dpr =
    typeof extraction.devicePixelRatio === 'number' && extraction.devicePixelRatio > 0
      ? extraction.devicePixelRatio
      : 1;
  const visibleCaptureDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  if (!visibleCaptureDataUrl) throw new Error('captureVisibleTab returned empty QR screenshot');

  const cropped = await cropAndResizeImage(
    visibleCaptureDataUrl,
    {
      x: extraction.rect.x * dpr,
      y: extraction.rect.y * dpr,
      width: extraction.rect.width * dpr,
      height: extraction.rect.height * dpr,
    },
    dpr,
  );
  return {
    dataUrl: await canvasToDataURL(cropped),
    width: Math.round(extraction.rect.width),
    height: Math.round(extraction.rect.height),
  };
}

export async function buildAuthQrArtifactRefs(params: {
  includeAuthArtifacts: boolean;
  tabId: number;
  windowId: number | null;
  pageRegions: ReadPageRegion[] | undefined;
  browserWorldTab: BrowserWorldTabObject | null;
  artifactRefs: ReadPageArtifactRef[];
  assistantGuidance?: ReadPageAssistantGuidance;
  nowMs?: number;
  prepareFile?: typeof prepareFileViaNative;
}): Promise<ReadPageAuthArtifactStatus> {
  if (!params.includeAuthArtifacts) return buildNotRequestedAuthArtifactStatus();

  const gate = canExtractAuthArtifactForTab(params.browserWorldTab);
  if (!gate.allowed) {
    return {
      requested: true,
      status: 'blocked',
      reason: gate.reason,
      ownerType: gate.ownerType,
      claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
    };
  }

  try {
    const assistantTarget = params.assistantGuidance?.assistantProvidedTarget;
    const assistantTargetHasSelector =
      assistantTarget?.purpose === 'auth_qr_image' &&
      typeof assistantTarget.selector === 'string' &&
      assistantTarget.selector.trim().length > 0;
    const candidates = selectAuthQrArtifactCandidates(params.pageRegions, 3);
    const hasAuthSurface =
      candidates.length > 0 || hasObservedAuthSurfaceForQrExtraction(params.pageRegions);

    if (!hasAuthSurface && !assistantTargetHasSelector) {
      return {
        requested: true,
        status: 'not_applicable',
        reason: 'auth_scoped_qr_visual_not_found',
        ownerType: gate.ownerType,
        failureReason: 'auth_qr_auth_surface_not_observed',
        claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
      };
    }

    if (hasExpiredAuthQrSignal(params.pageRegions)) {
      return {
        requested: true,
        status: 'failed',
        reason: 'auth_qr_image_artifact_failed',
        ownerType: gate.ownerType,
        failureReason: 'auth_qr_expired_refresh_required',
        claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
      };
    }

    if (params.browserWorldTab?.active !== true) {
      return {
        requested: true,
        status: 'blocked',
        reason: 'target_tab_not_active_for_auth_qr',
        ownerType: gate.ownerType,
        failureReason: 'switch_target_tab_active_before_qr_login',
        claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
      };
    }

    const assistantTargetRef =
      assistantTarget?.purpose === 'auth_qr_image' &&
      typeof assistantTarget.targetRef === 'string' &&
      assistantTarget.targetRef.trim().length > 0
        ? assistantTarget.targetRef.trim()
        : undefined;
    const assistantTargetCandidate = findAuthQrCandidateByTargetRef(candidates, assistantTargetRef);
    const assistantSelector =
      assistantTarget?.purpose === 'auth_qr_image' &&
      typeof assistantTarget.selector === 'string' &&
      assistantTarget.selector.trim().length > 0
        ? assistantTarget.selector.trim()
        : assistantTargetCandidate?.selector || null;
    const assistantFrameId =
      assistantTarget?.purpose === 'auth_qr_image' && typeof assistantTarget.frameId === 'number'
        ? assistantTarget.frameId
        : undefined;
    if (assistantTargetRef && !assistantTargetCandidate && !assistantTarget?.selector) {
      return {
        requested: true,
        status: 'not_applicable',
        reason: 'auth_scoped_qr_visual_not_found',
        ownerType: gate.ownerType,
        failureReason: 'assistant_target_ref_not_resolved',
        claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
      };
    }
    const selectors = uniqueSelectors([
      assistantSelector,
      ...candidates.map((item) => item.selector),
    ]);
    const extracted = await extractAuthQrImageFromDom(params.tabId, selectors, assistantFrameId);
    if (selectors.length === 0 && !extracted.dataUrl && extracted.method !== 'element_screenshot') {
      return {
        requested: true,
        status: 'not_applicable',
        reason: 'auth_scoped_qr_visual_not_found',
        ownerType: gate.ownerType,
        failureReason: extracted.failureReason,
        claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
      };
    }
    const candidate =
      (assistantSelector && extracted.selector === assistantSelector
        ? (assistantTargetCandidate ??
          ({
            regionId: 'assistant_guided_auth_surface',
            objectId: 'assistant_provided_qr_target',
            targetRef: assistantTargetRef,
            selector: assistantSelector,
            width: extracted.width ?? null,
            height: extracted.height ?? null,
          } satisfies AuthQrArtifactCandidate))
        : null) ??
      candidates[0] ??
      ({
        regionId: 'auth_surface_dom_probe',
        objectId: 'dom_qr_visual',
        selector: extracted.selector || 'dom_auth_qr_probe',
        width: extracted.width ?? null,
        height: extracted.height ?? null,
      } satisfies AuthQrArtifactCandidate);
    let dataUrl = normalizeDataUrl(extracted.dataUrl);
    let method = extracted.method;
    let width = extracted.width || candidate.width || null;
    let height = extracted.height || candidate.height || null;

    if (!dataUrl && extracted.method === 'element_screenshot') {
      const screenshot = await captureElementScreenshot(params.tabId, params.windowId, extracted);
      dataUrl = screenshot.dataUrl;
      method = 'element_screenshot';
      width = screenshot.width;
      height = screenshot.height;
    }

    if (!dataUrl || !method) {
      throw new Error(extracted.failureReason || 'auth_qr_image_unavailable');
    }

    const producedAtMs = Number.isFinite(params.nowMs) ? Number(params.nowMs) : Date.now();
    const safeObjectId = candidate.objectId.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 48);
    const fileName = `tabrix_auth_qr_tab-${params.tabId}_${safeObjectId}_${producedAtMs}.png`;
    const prepareFile = params.prepareFile ?? prepareFileViaNative;
    const saved = await prepareFile({
      base64Data: dataUrl,
      fileName,
      requestPrefix: 'auth-qr-artifact',
    });
    const ref = `artifact://read_page/tab-${params.tabId}/auth-qr/${safeObjectId}`;
    params.artifactRefs.push({
      kind: AUTH_QR_ARTIFACT_KIND,
      ref,
      localPath: saved.fullPath,
      mimeType: 'image/png',
      width: typeof width === 'number' ? Math.round(width) : undefined,
      height: typeof height === 'number' ? Math.round(height) : undefined,
      producedAtMs,
      expiresAtMs: producedAtMs + AUTH_QR_ARTIFACT_TTL_MS,
      method,
      sourceRegionId: candidate.regionId,
      sourceObjectId: candidate.objectId,
      claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
    });
    return {
      requested: true,
      status: 'ready',
      reason: 'auth_qr_image_artifact_ready',
      artifactRef: ref,
      ownerType: gate.ownerType,
      claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
    };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    return {
      requested: true,
      status: 'failed',
      reason: 'auth_qr_image_artifact_failed',
      ownerType: gate.ownerType,
      failureReason,
      claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
    };
  }
}
