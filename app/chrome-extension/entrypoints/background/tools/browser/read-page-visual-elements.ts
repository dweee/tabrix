import type { ReadPageVisualElementHint } from './read-page-task-protocol';

export const QR_VISUAL_ELEMENT_SELECTOR = [
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
  'canvas',
  'img',
].join(', ');

interface FiniteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface QrCandidateElement {
  selector?: unknown;
  coordinates?: { rect?: unknown };
  tagName?: unknown;
  type?: unknown;
  role?: unknown;
  text?: unknown;
  alt?: unknown;
  title?: unknown;
  className?: unknown;
  visualSignature?: unknown;
}

type ScoredVisualElementHint = ReadPageVisualElementHint & { score: number };
type QrVisualElementFallbackResult =
  | {
      elements?: unknown;
    }
  | null
  | undefined;

export type QrVisualElementFallbackCollector = (options: {
  selector: string;
  includeCoordinates: true;
  frameId?: number;
}) => Promise<QrVisualElementFallbackResult>;

export function hasQrVisibleContext(
  pageContent: string,
  visibleTextContent?: string | null,
): boolean {
  const text = `${pageContent || ''}\n${visibleTextContent || ''}`;
  if (!text.trim()) return false;
  const hasQrSignal = /\b(qr|qrcode|scan code)\b|二维码|扫码|扫一扫/i.test(text);
  const authHidden = /"?(?:showLogin|loginModalVisible|authModalVisible)"?\s*:\s*false/i.test(text);
  return hasQrSignal && !authHidden;
}

export function selectQrVisualElementHints(elements: unknown[]): ReadPageVisualElementHint[] {
  return elements
    .map((element: unknown, index: number) => scoreQrVisualElementHint(element, index))
    .filter((item: ScoredVisualElementHint | null): item is ScoredVisualElementHint =>
      Boolean(item),
    )
    .sort(
      (left: ScoredVisualElementHint, right: ScoredVisualElementHint) => right.score - left.score,
    )
    .slice(0, 3)
    .map(({ score: _score, ...item }: ScoredVisualElementHint) => item);
}

export async function collectQrVisualElementHints(params: {
  pageContent: string;
  visibleTextContent?: string | null;
  frameId?: number;
  collectFallback: QrVisualElementFallbackCollector;
}): Promise<ReadPageVisualElementHint[]> {
  if (!hasQrVisibleContext(params.pageContent, params.visibleTextContent)) return [];
  const fallback = await params.collectFallback({
    selector: QR_VISUAL_ELEMENT_SELECTOR,
    includeCoordinates: true,
    frameId: params.frameId,
  });
  const elements = Array.isArray(fallback?.elements) ? fallback.elements : [];
  return selectQrVisualElementHints(elements);
}

function finiteRect(rect: unknown): FiniteRect | null {
  if (
    rect &&
    typeof rect === 'object' &&
    Number.isFinite((rect as Partial<FiniteRect>).x) &&
    Number.isFinite((rect as Partial<FiniteRect>).y) &&
    Number.isFinite((rect as Partial<FiniteRect>).width) &&
    Number.isFinite((rect as Partial<FiniteRect>).height)
  ) {
    const typedRect = rect as FiniteRect;
    return {
      x: Number(typedRect.x),
      y: Number(typedRect.y),
      width: Number(typedRect.width),
      height: Number(typedRect.height),
    };
  }
  return null;
}

function scoreQrVisualElementHint(element: unknown, index: number): ScoredVisualElementHint | null {
  const candidate = element as QrCandidateElement | null;
  const selector = typeof candidate?.selector === 'string' ? candidate.selector.trim() : '';
  if (!selector) return null;
  const rect = finiteRect(candidate?.coordinates?.rect);
  if (!rect || rect.width < 40 || rect.height < 40) return null;
  const area = rect.width * rect.height;
  if (area < 2_000 || area > 160_000) return null;
  const aspectRatio = rect.width / Math.max(1, rect.height);
  if (aspectRatio < 0.65 || aspectRatio > 1.55) return null;

  const role = String(
    candidate?.tagName || candidate?.type || candidate?.role || 'img',
  ).toLowerCase();
  const attributeSignal = [
    candidate?.text,
    candidate?.alt,
    candidate?.title,
    candidate?.className,
    candidate?.role,
    role,
  ]
    .filter(Boolean)
    .join(' ');
  const scoringSignal = [attributeSignal, selector].filter(Boolean).join(' ');

  const hasExplicitQrSignal = /\b(qr|qrcode|scan code)\b|二维码|扫码|扫一扫/i.test(attributeSignal);
  if (!hasExplicitQrSignal) return null;

  let score = 0;
  score += 120;
  if (/\b(canvas|img|svg|selected)\b/i.test(role)) score += 24;
  if (rect.width >= 100 && rect.width <= 360 && rect.height >= 100 && rect.height <= 360)
    score += 36;
  if (String(candidate?.text || '').trim().length === 0) score += 18;
  if (/\b(logo|brand|wordmark|avatar|icon|profile)\b/i.test(scoringSignal)) score -= 80;
  score -= Math.min(20, index * 2);

  if (score < 40) return null;
  return {
    id: `qr_visual_${index + 1}`,
    label: 'QR visual element candidate',
    selector,
    role,
    rect,
    visualSignature:
      typeof candidate?.visualSignature === 'string' &&
      /^visual_[a-f0-9]{8}$/i.test(candidate.visualSignature)
        ? candidate.visualSignature.toLowerCase()
        : undefined,
    qrSignal: true,
    reason: 'qr_visual_element_signal',
    confidence: Math.min(0.92, Math.max(0.54, score / 180)),
    score,
  };
}
