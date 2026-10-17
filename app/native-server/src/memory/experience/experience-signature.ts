import { createHash } from 'node:crypto';

export function normalizeIntentSignature(intent: string): string {
  return intent.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 256);
}

export function buildActionPathId(input: {
  siteFamily: string;
  pageRole: string;
  intentSignature: string;
  stepSequence: unknown;
}): string {
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        siteFamily: input.siteFamily,
        pageRole: input.pageRole,
        intentSignature: input.intentSignature,
        stepSequence: input.stepSequence,
      }),
    )
    .digest('hex');
  return `action_path_${hash}`;
}
