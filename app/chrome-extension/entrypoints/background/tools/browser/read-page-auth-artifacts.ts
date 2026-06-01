import type {
  BrowserPageOwnerType,
  ReadPageArtifactRef,
  ReadPageAuthArtifactStatus,
  ReadPageRegion,
  ReadPageRegionObject,
} from '@tabrix/shared';
import type { BrowserWorldTabObject } from '../../browser-world-inventory';
import { canvasToDataURL, cropAndResizeImage } from '../../../../utils/image-utils';
import { prepareFileViaNative } from './native-file';

const AUTH_QR_ARTIFACT_KIND = 'auth_qr_image';
const AUTH_QR_ARTIFACT_TTL_MS = 120_000;
const AUTH_QR_CLAIM_BOUNDARY =
  'temporary auth-scoped QR image artifact only; not QR payload proof, not login success proof, and not long-term memory';

type AuthQrExtractionMethod =
  | 'img_data_url'
  | 'img_canvas'
  | 'canvas_to_data_url'
  | 'css_background_data_url'
  | 'element_screenshot';

export interface AuthQrArtifactCandidate {
  regionId: string;
  objectId: string;
  selector: string;
  width: number | null;
  height: number | null;
}

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

export function buildNotRequestedAuthArtifactStatus(): ReadPageAuthArtifactStatus {
  return {
    requested: false,
    status: 'not_requested',
    reason: 'includeAuthArtifacts_false',
    claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
  };
}

export function ownerTypeFromBrowserWorldTab(
  tab: Pick<BrowserWorldTabObject, 'openedBy'> | null,
): BrowserPageOwnerType | 'unknown' {
  if (tab?.openedBy === 'ai') return 'run_owned';
  if (tab?.openedBy === 'user_or_page') return 'user_owned';
  return 'unknown';
}

export function canExtractAuthArtifactForTab(tab: BrowserWorldTabObject | null): {
  allowed: boolean;
  ownerType: BrowserPageOwnerType | 'unknown';
  reason: string;
} {
  const ownerType = ownerTypeFromBrowserWorldTab(tab);
  if (!tab) {
    return {
      allowed: false,
      ownerType,
      reason: 'browser_world_tab_unknown',
    };
  }
  if (tab.openedBy !== 'ai') {
    return {
      allowed: false,
      ownerType,
      reason: 'current_tab_not_ai_owned_for_auth_artifact',
    };
  }
  if (tab.canTabrixOperate === false) {
    return {
      allowed: false,
      ownerType,
      reason: tab.operabilityReason || 'current_tab_not_operable_for_auth_artifact',
    };
  }
  return {
    allowed: true,
    ownerType,
    reason: 'ai_owned_tab_auth_artifact_allowed',
  };
}

function selectCssLocator(object: ReadPageRegionObject): string | null {
  const locators = Array.isArray(object.locatorChain) ? object.locatorChain : [];
  const cssLocator = locators.find(
    (locator) => locator?.type === 'css' && typeof locator.value === 'string',
  );
  return cssLocator?.value?.trim() || null;
}

export function selectAuthQrArtifactCandidate(
  pageRegions: ReadPageRegion[] | undefined,
): AuthQrArtifactCandidate | null {
  const regions = Array.isArray(pageRegions) ? pageRegions : [];
  const hasAuthSurface = regions.some((region) => {
    if (region.regionType === 'modal') return true;
    if (region.regionType === 'account' && /logged_out|auth|login|登录/i.test(region.state)) {
      return true;
    }
    return /\bauth|login\b|登录|授权/i.test(
      `${region.regionId} ${region.state} ${region.label || ''}`,
    );
  });
  if (!hasAuthSurface) return null;

  for (const region of regions) {
    if (region.regionType !== 'qr_code') continue;
    for (const object of region.objects || []) {
      const selector = selectCssLocator(object);
      const typeSignal = `${object.objectType || ''} ${object.label || ''} ${object.reason || ''}`;
      if (!selector || !/\bqr|qrcode|scan\b|二维码|扫码/i.test(typeSignal)) continue;
      return {
        regionId: region.regionId,
        objectId: object.objectId,
        selector,
        width: null,
        height: null,
      };
    }
  }
  return null;
}

function normalizeDataUrl(input: unknown): string | null {
  const value = typeof input === 'string' ? input.trim() : '';
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(value)) return value;
  return null;
}

async function extractAuthQrImageFromDom(
  tabId: number,
  selectors: string[],
): Promise<ExtractedAuthQrImage> {
  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
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

      async function inspectElement(selector: string) {
        let element: Element | null = null;
        try {
          element = document.querySelector(selector);
        } catch {
          return { failureReason: 'invalid_qr_selector' };
        }
        if (!element) return { failureReason: 'qr_element_not_found' };

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

      return (async () => {
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
  windowId: number | null,
  extraction: ExtractedAuthQrImage,
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (!extraction.rect) throw new Error('missing QR element rect for screenshot fallback');
  const dpr =
    typeof extraction.devicePixelRatio === 'number' && extraction.devicePixelRatio > 0
      ? extraction.devicePixelRatio
      : 1;
  const visibleCaptureDataUrl =
    typeof windowId === 'number'
      ? await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
      : await chrome.tabs.captureVisibleTab({ format: 'png' } as any);
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

  const candidate = selectAuthQrArtifactCandidate(params.pageRegions);
  if (!candidate) {
    return {
      requested: true,
      status: 'not_applicable',
      reason: 'auth_scoped_qr_visual_not_found',
      ownerType: gate.ownerType,
      claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
    };
  }

  try {
    const extracted = await extractAuthQrImageFromDom(params.tabId, [candidate.selector]);
    let dataUrl = normalizeDataUrl(extracted.dataUrl);
    let method = extracted.method;
    let width = extracted.width || candidate.width || null;
    let height = extracted.height || candidate.height || null;

    if (!dataUrl && extracted.method === 'element_screenshot') {
      const screenshot = await captureElementScreenshot(params.windowId, extracted);
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
