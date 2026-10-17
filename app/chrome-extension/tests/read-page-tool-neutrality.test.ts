import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('read_page tool neutrality', () => {
  const readPageToolPath = resolve(
    __dirname,
    '..',
    'entrypoints',
    'background',
    'tools',
    'browser',
    'read-page.ts',
  );
  const readPageToolSource = readFileSync(readPageToolPath, 'utf8');

  it('keeps QR visual scoring free of platform-specific brand vocabulary', () => {
    const forbiddenPlatformTerms = ['内容站', 'specific_social_brand', 'specific_search_brand'];

    for (const forbidden of forbiddenPlatformTerms) {
      expect(readPageToolSource).not.toContain(forbidden);
    }
  });
});
