import {
  P3_EXPLICIT_OPT_IN_TOOLS,
  TOOL_NAMES,
  TOOL_RISK_TIERS,
  TOOL_SCHEMAS,
  getToolRiskTier,
  isExplicitOptInTool,
} from '@tabrix/shared';

function flattenToolNames(): Set<string> {
  const names = new Set<string>();
  for (const group of Object.values(TOOL_NAMES)) {
    for (const name of Object.values(group)) {
      names.add(name);
    }
  }
  return names;
}

describe('TOOL_RISK_TIERS coverage invariants', () => {
  it('every tool in TOOL_SCHEMAS has an entry in TOOL_RISK_TIERS', () => {
    const missing: string[] = [];
    for (const tool of TOOL_SCHEMAS) {
      if (!getToolRiskTier(tool.name)) missing.push(tool.name);
    }
    expect(missing).toEqual([]);
  });

  it('every entry in TOOL_RISK_TIERS matches a known tool name in TOOL_NAMES', () => {
    const allKnownNames = flattenToolNames();
    const orphaned: string[] = [];
    for (const name of Object.keys(TOOL_RISK_TIERS)) {
      if (!allKnownNames.has(name)) orphaned.push(name);
    }
    expect(orphaned).toEqual([]);
  });

  it('every tool in P3_EXPLICIT_OPT_IN_TOOLS is tagged P3', () => {
    const misclassified: string[] = [];
    for (const name of P3_EXPLICIT_OPT_IN_TOOLS) {
      if (TOOL_RISK_TIERS[name] !== 'P3') misclassified.push(name);
    }
    expect(misclassified).toEqual([]);
  });

  it('tool classified P3 and in P3_EXPLICIT_OPT_IN_TOOLS is flagged explicit opt-in', () => {
    for (const name of P3_EXPLICIT_OPT_IN_TOOLS) {
      expect(isExplicitOptInTool(name)).toBe(true);
    }
  });

  it('no P0 / P1 / P2 tool is accidentally in the opt-in set', () => {
    const leaks: string[] = [];
    for (const name of P3_EXPLICIT_OPT_IN_TOOLS) {
      const tier = TOOL_RISK_TIERS[name];
      if (tier !== 'P3') leaks.push(`${name}=${tier}`);
    }
    expect(leaks).toEqual([]);
  });

  it('known-risky tools are classified P3 (regression guard)', () => {
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.JAVASCRIPT]).toBe('P3');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.COMPUTER]).toBe('P3');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.FILE_UPLOAD]).toBe('P3');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.BOOKMARK_DELETE]).toBe('P3');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.INJECT_SCRIPT]).toBe('P3');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.SEND_COMMAND_TO_INJECT_SCRIPT]).toBe('P3');
  });

  it('chrome_javascript schema makes caller-side script review responsibility explicit', () => {
    const javascriptTool = TOOL_SCHEMAS.find((tool) => tool.name === TOOL_NAMES.BROWSER.JAVASCRIPT);
    expect(javascriptTool).toBeDefined();
    expect(javascriptTool?.description).toContain('advanced fallback');
    expect(javascriptTool?.description).toContain('The calling AI/client must review');

    const inputSchema = javascriptTool?.inputSchema as
      | { properties?: Record<string, { description?: string }> }
      | undefined;
    expect(inputSchema?.properties?.code?.description).toContain(
      'calling AI/client is responsible',
    );
    expect(inputSchema?.properties?.code?.description).toContain('user-visible side effects');
  });

  it('known-safe tools are classified P0 (regression guard)', () => {
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.READ_PAGE]).toBe('P0');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.SCREENSHOT]).toBe('P0');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS]).toBe('P0');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.CONSOLE]).toBe('P0');
    expect(TOOL_RISK_TIERS[TOOL_NAMES.BROWSER.HISTORY]).toBe('P0');
  });

  // -- Commit 1: pre-split contract guards --

  it('every TOOL_SCHEMAS name is unique', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name);
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const name of names) {
      if (seen.has(name)) duplicates.push(name);
      seen.add(name);
    }
    expect(duplicates).toEqual([]);
  });

  it('every TOOL_SCHEMAS name exists in flattened TOOL_NAMES', () => {
    const allKnownNames = flattenToolNames();
    const missing: string[] = [];
    for (const tool of TOOL_SCHEMAS) {
      if (!allKnownNames.has(tool.name)) missing.push(tool.name);
    }
    expect(missing).toEqual([]);
  });

  it('TOOL_SCHEMAS name order is locked (deterministic listTools ordering)', () => {
    const order = TOOL_SCHEMAS.map((t) => t.name);
    expect(order).toEqual([
      'get_windows_and_tabs',
      'performance_start_trace',
      'performance_stop_trace',
      'performance_analyze_insight',
      'chrome_read_page',
      'chrome_collect_result_cards',
      'chrome_computer',
      'chrome_navigate',
      'chrome_screenshot',
      'chrome_close_tabs',
      'chrome_switch_tab',
      'chrome_tab_group_create',
      'chrome_tab_group_update',
      'chrome_tab_group_add_tabs',
      'chrome_tab_group_close',
      'chrome_tab_group_list',
      'chrome_move_tab',
      'chrome_get_web_content',
      'chrome_network_request',
      'chrome_network_capture',
      'chrome_handle_download',
      'chrome_history',
      'chrome_bookmark_search',
      'chrome_bookmark_add',
      'chrome_bookmark_delete',
      'chrome_get_interactive_elements',
      'chrome_javascript',
      'chrome_click_element',
      'chrome_fill_or_select',
      'chrome_keyboard',
      'chrome_console',
      'chrome_upload_file',
      'chrome_handle_dialog',
      'tabrix_choose_context',
      'tabrix_choose_context_record_outcome',
      'memory_record_ai_feedback',
    ]);
  });

  it('getToolRiskTier is consistent with TOOL_RISK_TIERS', () => {
    for (const name of Object.keys(TOOL_RISK_TIERS)) {
      expect(getToolRiskTier(name)).toBe(TOOL_RISK_TIERS[name]);
    }
  });

  it('isExplicitOptInTool is consistent with P3_EXPLICIT_OPT_IN_TOOLS', () => {
    for (const name of P3_EXPLICIT_OPT_IN_TOOLS) {
      expect(isExplicitOptInTool(name)).toBe(true);
    }
    expect(isExplicitOptInTool(TOOL_NAMES.BROWSER.READ_PAGE)).toBe(false);
    expect(isExplicitOptInTool(TOOL_NAMES.BROWSER.NAVIGATE)).toBe(false);
  });
});
