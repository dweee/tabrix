export const TOOL_NAMES = {
  BROWSER: {
    GET_WINDOWS_AND_TABS: 'get_windows_and_tabs',
    NAVIGATE: 'chrome_navigate',
    SCREENSHOT: 'chrome_screenshot',
    CLOSE_TABS: 'chrome_close_tabs',
    SWITCH_TAB: 'chrome_switch_tab',
    WEB_FETCHER: 'chrome_get_web_content',
    CLICK: 'chrome_click_element',
    FILL: 'chrome_fill_or_select',
    REQUEST_ELEMENT_SELECTION: 'chrome_request_element_selection',
    GET_INTERACTIVE_ELEMENTS: 'chrome_get_interactive_elements',
    NETWORK_CAPTURE: 'chrome_network_capture',
    // Legacy/retired tool names kept for policy guards, not exposed in TOOL_SCHEMAS.
    NETWORK_CAPTURE_START: 'chrome_network_capture_start',
    NETWORK_CAPTURE_STOP: 'chrome_network_capture_stop',
    NETWORK_REQUEST: 'chrome_network_request',
    NETWORK_DEBUGGER_START: 'chrome_network_debugger_start',
    NETWORK_DEBUGGER_STOP: 'chrome_network_debugger_stop',
    KEYBOARD: 'chrome_keyboard',
    HISTORY: 'chrome_history',
    BOOKMARK_SEARCH: 'chrome_bookmark_search',
    BOOKMARK_ADD: 'chrome_bookmark_add',
    BOOKMARK_DELETE: 'chrome_bookmark_delete',
    INJECT_SCRIPT: 'chrome_inject_script',
    SEND_COMMAND_TO_INJECT_SCRIPT: 'chrome_send_command_to_inject_script',
    JAVASCRIPT: 'chrome_javascript',
    CONSOLE: 'chrome_console',
    FILE_UPLOAD: 'chrome_upload_file',
    READ_PAGE: 'chrome_read_page',
    COLLECT_RESULT_CARDS: 'chrome_collect_result_cards',
    COMPUTER: 'chrome_computer',
    HANDLE_DIALOG: 'chrome_handle_dialog',
    HANDLE_DOWNLOAD: 'chrome_handle_download',
    PERFORMANCE_START_TRACE: 'performance_start_trace',
    PERFORMANCE_STOP_TRACE: 'performance_stop_trace',
    PERFORMANCE_ANALYZE_INSIGHT: 'performance_analyze_insight',
  },
  /**
   * MKEP context selector.
   * Native-handled. See `app/native-server/src/mcp/choose-context.ts`.
   */
  CONTEXT: {
    CHOOSE: 'tabrix_choose_context',
    /**
     * Outcome write-back. Pure-INSERT P0 tool that
     * lets the upstream caller close the loop on "did the strategy
     * `tabrix_choose_context` returned actually save us a `read_page`?".
     */
    RECORD_OUTCOME: 'tabrix_choose_context_record_outcome',
  },
  /**
   * MKEP Memory write-back layer.
   * Native-handled. Lets the upstream AI attach business feedback to
   * a concrete Memory trace id returned in the `_tabrix.traceId`
   * envelope, without waiting for a later browser tool call.
   */
  MEMORY: {
    RECORD_AI_FEEDBACK: 'memory_record_ai_feedback',
  },
};
