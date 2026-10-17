import { describe, expect, it } from 'vitest';
import {
  compileKnowledgeRegistry,
  uiMapRuleKey,
} from '@/entrypoints/background/knowledge/registry/knowledge-registry';
import {
  listUIMapRulesForPage,
  listUIMapRulesForSite,
  lookupUIMapRule,
} from '@/entrypoints/background/knowledge/lookup/resolve-ui-map';
import type { KnowledgeSeeds, KnowledgeUIMapRule } from '@/entrypoints/background/knowledge/types';

const GENERIC_KNOWLEDGE_SEEDS: KnowledgeSeeds = {
  siteProfiles: [{ siteId: 'example_site', match: { hosts: ['example.test'] } }],
  pageRoleRules: [],
  objectClassifiers: [
    {
      siteId: 'example_site',
      pageRole: 'search_results',
      match: { hrefPatterns: ['^/items/[a-z0-9_-]+'] },
      objectType: 'card',
      objectSubType: 'result_card',
      region: 'result_list',
    },
  ],
  uiMapRules: [
    {
      siteId: 'example_site',
      pageRole: 'home',
      purpose: 'home.open_search',
      locatorHints: [{ kind: 'aria_name', value: 'Search', role: 'Button' }],
      actionType: 'click',
      confidence: 'medium',
    },
    {
      siteId: 'example_site',
      pageRole: 'search_results',
      purpose: 'search_results.query_input',
      region: 'search_bar',
      locatorHints: [
        { kind: 'label_regex', value: 'search|query', role: 'Textbox' },
        { kind: 'css', value: 'input[type="search"]' },
      ],
      actionType: 'fill',
      confidence: 'high',
    },
    {
      siteId: 'example_site',
      pageRole: 'search_results',
      purpose: 'search_results.open_first_result',
      region: 'result_list',
      locatorHints: [{ kind: 'href_regex', value: '^/items/[a-z0-9_-]+' }],
      actionType: 'click',
      confidence: 'medium',
    },
  ],
};

describe('knowledge UI Map — compile', () => {
  it('loads a generic seed into uiMapRulesBySite + uiMapRuleByKey', () => {
    const compiled = compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS]);
    const rules = compiled.uiMapRulesBySite.get('example_site');
    expect(rules?.length).toBe(3);
    expect(compiled.uiMapRuleByKey.size).toBe(3);
    expect(
      compiled.uiMapRuleByKey.has(uiMapRuleKey('example_site', 'home', 'home.open_search')),
    ).toBe(true);
  });

  it('preserves declaration order within a site', () => {
    const compiled = compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS]);
    const purposes = compiled.uiMapRulesBySite.get('example_site')?.map((r) => r.purpose) ?? [];
    expect(purposes).toEqual([
      'home.open_search',
      'search_results.query_input',
      'search_results.open_first_result',
    ]);
  });

  it('compiles regex hint kinds into RegExp with the i flag, leaves aria_name/css null', () => {
    const compiled = compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS]);
    const rules = compiled.uiMapRulesBySite.get('example_site') ?? [];
    let regexCount = 0;
    let nonRegexCount = 0;
    for (const rule of rules) {
      for (const hint of rule.locatorHints) {
        if (hint.kind === 'label_regex' || hint.kind === 'href_regex') {
          expect(hint.pattern).toBeInstanceOf(RegExp);
          expect(hint.pattern?.flags).toContain('i');
          regexCount += 1;
        } else {
          expect(hint.pattern).toBeNull();
          nonRegexCount += 1;
        }
      }
    }
    expect(regexCount).toBeGreaterThan(0);
    expect(nonRegexCount).toBeGreaterThan(0);
  });

  it('normalizes the optional aria role to lowercase', () => {
    const compiled = compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS]);
    const rule = compiled.uiMapRuleByKey.get(
      uiMapRuleKey('example_site', 'home', 'home.open_search'),
    );
    expect(rule?.locatorHints[0].role).toBe('button');
  });

  it('rejects duplicate (siteId, pageRole, purpose) triples', () => {
    const dupe: KnowledgeUIMapRule = {
      siteId: 'example_site',
      pageRole: 'home',
      purpose: 'home.open_search',
      locatorHints: [{ kind: 'aria_name', value: 'Search' }],
    };
    const extra: KnowledgeSeeds = {
      siteProfiles: [],
      pageRoleRules: [],
      uiMapRules: [dupe],
    };
    expect(() => compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS, extra])).toThrowError(
      /duplicate UI map rule/,
    );
  });

  it('tolerates seeds that do not define uiMapRules', () => {
    const compiled = compileKnowledgeRegistry([
      { siteProfiles: [], pageRoleRules: [], objectClassifiers: [] },
    ]);
    expect(compiled.uiMapRulesBySite.size).toBe(0);
    expect(compiled.uiMapRuleByKey.size).toBe(0);
  });

  it('fills optional fields with documented defaults', () => {
    const minimal: KnowledgeSeeds = {
      siteProfiles: [{ siteId: 'minimal', match: { hosts: ['minimal.test'] } }],
      pageRoleRules: [],
      uiMapRules: [
        {
          siteId: 'minimal',
          pageRole: 'home',
          purpose: 'minimal.noop',
          locatorHints: [{ kind: 'css', value: 'button.x' }],
        },
      ],
    };
    const compiled = compileKnowledgeRegistry([minimal]);
    const rule = compiled.uiMapRuleByKey.get(uiMapRuleKey('minimal', 'home', 'minimal.noop'));
    expect(rule).toBeDefined();
    expect(rule?.region).toBeNull();
    expect(rule?.actionType).toBeNull();
    expect(rule?.confidence).toBeNull();
    expect(rule?.notes).toBeNull();
    expect(rule?.locatorHints[0].role).toBeNull();
    expect(rule?.locatorHints[0].pattern).toBeNull();
  });
});

describe('knowledge UI Map — lookup', () => {
  const registry = compileKnowledgeRegistry([GENERIC_KNOWLEDGE_SEEDS]);

  it('lookupUIMapRule returns the authored rule for a stable triple', () => {
    const rule = lookupUIMapRule({
      siteId: 'example_site',
      pageRole: 'search_results',
      purpose: 'search_results.open_first_result',
      registry,
    });
    expect(rule).not.toBeNull();
    expect(rule?.actionType).toBe('click');
    expect(rule?.region).toBe('result_list');
    expect(rule?.locatorHints[0].kind).toBe('href_regex');
  });

  it('returns null for an unknown (siteId, pageRole, purpose) triple', () => {
    expect(
      lookupUIMapRule({
        siteId: 'example_site',
        pageRole: 'home',
        purpose: 'home.does_not_exist',
        registry,
      }),
    ).toBeNull();
    expect(
      lookupUIMapRule({
        siteId: 'unknown',
        pageRole: 'home',
        purpose: 'home.open_search',
        registry,
      }),
    ).toBeNull();
  });

  it('listUIMapRulesForPage returns every rule on the page in declaration order', () => {
    const rules = listUIMapRulesForPage({
      siteId: 'example_site',
      pageRole: 'search_results',
      registry,
    });
    expect(rules.map((r) => r.purpose)).toEqual([
      'search_results.query_input',
      'search_results.open_first_result',
    ]);
  });

  it('listUIMapRulesForPage returns [] for a page with no authored rules', () => {
    const rules = listUIMapRulesForPage({ siteId: 'example_site', pageRole: 'settings', registry });
    expect(rules).toEqual([]);
  });

  it('listUIMapRulesForSite returns all rules for that site', () => {
    const rules = listUIMapRulesForSite({ siteId: 'example_site', registry });
    expect(rules.length).toBe(3);
    expect(rules[0].siteId).toBe('example_site');
  });

  it('returns null / [] when the registry is explicitly null', () => {
    expect(
      lookupUIMapRule({
        siteId: 'example_site',
        pageRole: 'home',
        purpose: 'home.open_search',
        registry: null,
      }),
    ).toBeNull();
    expect(
      listUIMapRulesForPage({ siteId: 'example_site', pageRole: 'home', registry: null }),
    ).toEqual([]);
    expect(listUIMapRulesForSite({ siteId: 'example_site', registry: null })).toEqual([]);
  });
});

describe('knowledge UI Map — no bundled platform seeds', () => {
  it('default registry axes remain empty until observed knowledge or authored generic seeds are supplied', () => {
    const compiled = compileKnowledgeRegistry([]);
    expect(compiled.siteProfiles.size).toBe(0);
    expect(compiled.pageRoleRulesBySite.size).toBe(0);
    expect(compiled.objectClassifiersBySite.size).toBe(0);
    expect(compiled.uiMapRulesBySite.size).toBe(0);
  });
});
