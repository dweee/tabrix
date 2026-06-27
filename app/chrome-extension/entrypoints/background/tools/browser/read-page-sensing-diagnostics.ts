import type { ReadPagePageContext, ReadPageSensingDiagnostic } from '@tabrix/shared';

const ACCESSIBILITY_TREE_DIAGNOSTIC_LIMIT = 8;

export function normalizeAccessibilityTreeDiagnostics(
  rawDiagnostics: unknown,
  rawStats?: unknown,
): ReadPagePageContext['sensingDiagnostics'] | undefined {
  const partialErrors = (Array.isArray(rawDiagnostics) ? rawDiagnostics : [])
    .map((entry): { source: string; message: string; at?: number } | null => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const source = typeof record.source === 'string' ? record.source.trim() : '';
      const message = typeof record.message === 'string' ? record.message.trim() : '';
      if (!source || !message) return null;
      const safeMessage = message.replace(/\s+/g, ' ').slice(0, 160);
      const at =
        typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : undefined;
      return {
        source: source.slice(0, 96),
        message: safeMessage,
        ...(typeof at === 'number' ? { at } : {}),
      };
    })
    .filter((entry): entry is { source: string; message: string; at?: number } => entry != null)
    .slice(-ACCESSIBILITY_TREE_DIAGNOSTIC_LIMIT);

  const statsRecord =
    rawStats && typeof rawStats === 'object' && !Array.isArray(rawStats)
      ? (rawStats as Record<string, unknown>)
      : null;
  const partialStats: ReadPageSensingDiagnostic[] = [];
  if (statsRecord) {
    if (statsRecord.nodeLimitReached === true) {
      partialStats.push({
        source: 'accessibility_tree_helper.node_limit',
        message: 'object sensing stopped at the node limit before the full page tree was covered',
      });
    }
    if (statsRecord.refMapLimitReached === true) {
      partialStats.push({
        source: 'accessibility_tree_helper.ref_map_limit',
        message: 'object locator map stopped at the ref map limit before all targets were indexed',
      });
    }
    if (statsRecord.depthLimitReached === true) {
      partialStats.push({
        source: 'accessibility_tree_helper.depth_limit',
        message:
          'object sensing stopped at the configured depth limit before deeper objects were covered',
      });
    }
    if (statsRecord.coverageStatus === 'partial' && partialStats.length === 0) {
      partialStats.push({
        source: 'accessibility_tree_helper.partial_coverage',
        message:
          'object sensing reported partial coverage without a more specific truncation reason',
      });
    }
  }

  const diagnostics = [...partialErrors, ...partialStats].slice(
    -ACCESSIBILITY_TREE_DIAGNOSTIC_LIMIT,
  );
  if (diagnostics.length === 0) return undefined;
  return {
    source: 'accessibility_tree_helper',
    coverageStatus: 'partial',
    partialErrors: diagnostics,
    claimBoundary:
      'content-script diagnostics mean some low-level object-sensing probes failed; the snapshot can still be useful but should be treated as partial evidence, not business-success proof',
  };
}
