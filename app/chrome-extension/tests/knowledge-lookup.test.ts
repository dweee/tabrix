import { describe, expect, it } from 'vitest';
import { buildUnderstandingContext } from '@/entrypoints/background/tools/browser/read-page-understanding-core';
import { resolveSiteProfile } from '@/entrypoints/background/knowledge/lookup/resolve-site-profile';
import { resolvePageRole } from '@/entrypoints/background/knowledge/lookup/resolve-page-role';
import { compileKnowledgeRegistry } from '@/entrypoints/background/knowledge/registry/knowledge-registry';
import type { KnowledgeSeeds } from '@/entrypoints/background/knowledge/types';

const GENERIC_KNOWLEDGE_SEEDS: KnowledgeSeeds = {
  siteProfiles: [{ siteId: 'content_site', match: { hosts: ['content.example'] } }],
  pageRoleRules: [
    {
      siteId: 'content_site',
      pageRole: 'search_results',
      match: {
        urlPatterns: ['^https://content\\.example/search'],
        titlePatterns: ['search'],
      },
      primaryRegions: [
        {
          region: 'result_list',
          patterns: ['\\bresults?\\b', '\\bfilters?\\b'],
          confidence: 'high',
        },
      ],
      fallback: { primaryRegion: 'main_content', primaryRegionConfidence: 'low' },
    },
    {
      siteId: 'content_site',
      pageRole: 'content_detail',
      match: {
        urlPatterns: ['^https://content\\.example/items/[a-z0-9_-]+'],
      },
      primaryRegions: [
        {
          region: 'detail_content',
          patterns: ['\\btitle\\b', '\\bcomments?\\b'],
          confidence: 'medium',
        },
      ],
      fallback: { primaryRegion: 'detail_content', primaryRegionConfidence: 'low' },
    },
  ],
};

describe('knowledge-lookup resolveSiteProfile', () => {
  it('does not identify any built-in platform profile by default', () => {
    expect(resolveSiteProfile('https://code.example/example/project')).toBeNull();
    expect(resolveSiteProfile('https://www.media_site.com/')).toBeNull();
    expect(resolveSiteProfile('https://content.example/search?q=ai')).toBeNull();
  });

  it('identifies only caller-provided generic registry profiles', () => {
    const registry = compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS]);
    expect(resolveSiteProfile('https://content.example/search?q=ai', registry)).toBe(
      'content_site',
    );
    expect(resolveSiteProfile('https://other.example/search?q=ai', registry)).toBeNull();
  });

  it('returns null for unparseable urls', () => {
    expect(resolveSiteProfile('not-a-url')).toBeNull();
  });
});

describe('knowledge-lookup resolvePageRole', () => {
  const registry = compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS]);

  function understand(url: string, title: string, content: string) {
    const context = buildUnderstandingContext(url, title, content);
    const siteId = resolveSiteProfile(context.lowerUrl, registry);
    if (!siteId) return null;
    return resolvePageRole({ siteId, context }, registry);
  }

  it('classifies generic search-result pages from an injected registry', () => {
    const hit = understand(
      'https://content.example/search?q=ai',
      'Search results',
      'Filters Results Item cards',
    );

    expect(hit).toMatchObject({
      pageRole: 'search_results',
      primaryRegion: 'result_list',
      primaryRegionConfidence: 'high',
    });
  });

  it('classifies generic detail pages from an injected registry', () => {
    const hit = understand(
      'https://content.example/items/alpha123',
      'Article',
      'Title Comments Related items',
    );

    expect(hit).toMatchObject({
      pageRole: 'content_detail',
      primaryRegion: 'detail_content',
      primaryRegionConfidence: 'medium',
    });
  });

  it('returns null when no page role rule matches', () => {
    const hit = understand('https://content.example/settings/profile', 'Settings', 'Some body');
    expect(hit).toBeNull();
  });
});
