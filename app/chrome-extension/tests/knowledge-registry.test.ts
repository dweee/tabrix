import { describe, expect, it } from 'vitest';
import {
  compileKnowledgeRegistry,
  getCompiledKnowledgeRegistry,
  __resetCompiledKnowledgeRegistryForTest,
} from '@/entrypoints/background/knowledge/registry/knowledge-registry';
import type { KnowledgeSeeds } from '@/entrypoints/background/knowledge/types';

const GENERIC_KNOWLEDGE_SEEDS: KnowledgeSeeds = {
  siteProfiles: [{ siteId: 'example_site', match: { hosts: ['example.test'] } }],
  pageRoleRules: [
    {
      siteId: 'example_site',
      pageRole: 'content_detail',
      match: { urlPatterns: ['^/items/[a-z0-9_-]+'] },
      primaryRegions: [
        {
          region: 'detail_content',
          patterns: ['\\btitle\\b', '\\bcomments\\b'],
          confidence: 'medium',
        },
      ],
      fallback: { primaryRegion: 'detail_content', primaryRegionConfidence: 'low' },
    },
    {
      siteId: 'example_site',
      pageRole: 'search_results',
      match: { urlPatterns: ['^/search'], titlePatterns: ['search'] },
      primaryRegions: [
        {
          region: 'result_list',
          patterns: ['\\bresults?\\b', '\\bfilter\\b'],
          confidence: 'medium',
        },
      ],
    },
  ],
  objectClassifiers: [
    {
      siteId: 'example_site',
      pageRole: 'search_results',
      match: { hrefPatterns: ['^/items/[a-z0-9_-]+'] },
      objectType: 'card',
      objectSubType: 'result_card',
      region: 'result_list',
    },
    {
      siteId: 'example_site',
      pageRole: 'search_results',
      match: { labelPatterns: ['open detail'] },
      objectType: 'button',
      objectSubType: 'open_detail',
      region: 'result_list',
    },
  ],
};

describe('knowledge-registry compile', () => {
  it('loads with no bundled platform seeds', () => {
    __resetCompiledKnowledgeRegistryForTest();
    const registry = getCompiledKnowledgeRegistry();
    expect(registry).not.toBeNull();
    expect(registry?.siteProfiles.size).toBe(0);
    expect(registry?.pageRoleRulesBySite.size).toBe(0);
  });

  it('exposes authored page role rules in declaration order', () => {
    const compiled = compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS]);
    const rules = compiled.pageRoleRulesBySite.get('example_site');
    expect(rules?.map((r) => r.pageRole)).toEqual(['content_detail', 'search_results']);
  });

  it('compiles every authored pattern to a case-insensitive RegExp', () => {
    const compiled = compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS]);
    const profile = compiled.siteProfiles.get('example_site');
    expect(profile).toBeDefined();
    for (const p of profile?.match.urlPatterns ?? []) {
      expect(p.pattern.flags).toContain('i');
    }
    for (const rule of compiled.pageRoleRulesBySite.get('example_site') ?? []) {
      for (const p of rule.match.urlPatterns) expect(p.pattern.flags).toContain('i');
      for (const p of rule.match.titlePatterns) expect(p.pattern.flags).toContain('i');
      for (const region of rule.primaryRegions) {
        for (const pat of region.patterns) expect(pat.pattern.flags).toContain('i');
      }
    }
  });

  it('tolerates intentionally empty seed sets', () => {
    const compiled = compileKnowledgeRegistry([{ siteProfiles: [], pageRoleRules: [] }]);
    expect(compiled.siteProfiles.size).toBe(0);
    expect(compiled.pageRoleRulesBySite.size).toBe(0);
    expect(compiled.objectClassifiersBySite.size).toBe(0);
  });

  it('rejects duplicate siteId across seed sets', () => {
    const duplicate: KnowledgeSeeds = {
      siteProfiles: [{ siteId: 'example_site', match: { hosts: ['mirror.example.test'] } }],
      pageRoleRules: [],
    };
    expect(() => compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS, duplicate])).toThrowError(
      /duplicate siteId/,
    );
  });

  describe('stage 2 object classifiers', () => {
    it('compiles object classifiers without relying on a built-in site adapter', () => {
      const compiled = compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS]);
      const list = compiled.objectClassifiersBySite.get('example_site');
      expect(list?.length).toBe(2);
      expect(list?.[0].match.hrefPatterns[0].pattern).toBeInstanceOf(RegExp);
      expect(list?.[1].match.labelPatterns[0].pattern).toBeInstanceOf(RegExp);
    });

    it('applies the i flag to every object classifier pattern', () => {
      const compiled = compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS]);
      const list = compiled.objectClassifiersBySite.get('example_site') ?? [];
      for (const rule of list) {
        for (const p of rule.match.hrefPatterns) expect(p.pattern.flags).toContain('i');
        for (const p of rule.match.labelPatterns) expect(p.pattern.flags).toContain('i');
      }
    });
  });
});
