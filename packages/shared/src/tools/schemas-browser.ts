import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from './names';

export const TASK_SESSION_ID_PROPERTY = {
  type: 'string',
  description:
    'Optional caller-provided task session key. Reuse the same value across choose_context/navigate/read/switch/fetch/click/fill/keyboard/close_tabs so Tabrix can keep current-page validation, run-owned tabs, read budgets, action verification, and cleanup tied to one AI task.',
};

const RUNTIME_POLICY_PROPERTY = {
  type: 'object',
  description:
    'Optional browser runtime policy for task-owned operation. Use desiredExecutionMode=background or run_owned with focusPolicy=no_steal when Tabrix should work in the background without taking over the user-visible Chrome tab.',
  properties: {
    desiredExecutionMode: {
      type: 'string',
      enum: ['run_owned', 'background', 'current_tab_readonly', 'collaboration'],
      description:
        'run_owned/background asks Tabrix to prefer task-owned tabs and avoid disturbing the user. collaboration means user-visible operation is expected.',
    },
    focusPolicy: {
      type: 'string',
      enum: ['no_steal', 'allow_foreground_when_required', 'user_confirmed'],
      description:
        'no_steal means do not focus windows or activate newly-created tabs unless a later explicit action requires it.',
    },
    cleanupPolicy: {
      type: 'string',
      enum: ['close_run_owned', 'keep_handoff', 'keep_deliverable'],
      description:
        'close_run_owned means the caller expects task-owned tabs to be cleaned up with chrome_close_tabs when the task is done.',
    },
    nonInterference: {
      type: 'string',
      enum: ['strict'],
      description:
        'strict blocks mutating actions on tabs that are not proven run-owned or explicitly user-confirmed.',
    },
  },
};

const TASK_RUNTIME_PROPERTIES = {
  taskSessionId: TASK_SESSION_ID_PROPERTY,
  runtimePolicy: RUNTIME_POLICY_PROPERTY,
};

export const BROWSER_SCHEMAS: Tool[] = [
  {
    name: TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
    description: 'Get all currently open browser windows and tabs',
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        includeDiagnostics: {
          type: 'boolean',
          description:
            'Return full BrowserWorld diagnostics. Default false keeps the response compact for AI browser control.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.PERFORMANCE_START_TRACE,
    description:
      'Starts a performance trace recording on the selected page. Optionally reloads the page and/or auto-stops after a short duration.',
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        reload: {
          type: 'boolean',
          description:
            'Determines if, once tracing has started, the page should be automatically reloaded (ignore cache).',
        },
        autoStop: {
          type: 'boolean',
          description: 'Determines if the trace should be automatically stopped (default false).',
        },
        durationMs: {
          type: 'number',
          description: 'Auto-stop duration in milliseconds when autoStop is true (default 5000).',
        },
        tabId: {
          type: 'number',
          description:
            'Record the trace on this tab. Defaults to the active tab in the current or specified window.',
        },
        windowId: {
          type: 'number',
          description: 'When tabId is omitted, use the active tab in this Chrome window.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.PERFORMANCE_STOP_TRACE,
    description: 'Stops the active performance trace recording on the selected page.',
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        saveToDownloads: {
          type: 'boolean',
          description: 'Whether to save the trace as a JSON file in Downloads (default true).',
        },
        filenamePrefix: {
          type: 'string',
          description: 'Optional filename prefix for the downloaded trace JSON.',
        },
        tabId: {
          type: 'number',
          description:
            'Stop the trace on this tab (must match where recording started). Defaults to active tab.',
        },
        windowId: {
          type: 'number',
          description: 'When tabId is omitted, use the active tab in this window.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.PERFORMANCE_ANALYZE_INSIGHT,
    description:
      'Provides a lightweight summary of the last recorded trace. For deep insights (CWV, breakdowns), integrate native-side DevTools trace engine.',
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        insightName: {
          type: 'string',
          description:
            'Optional insight name for future deep analysis (e.g., "DocumentLatency"). Currently informational only.',
        },
        tabId: {
          type: 'number',
          description:
            'Optional tab ID whose last recorded trace result should be analyzed. If omitted, uses the active tab (or windowId) and falls back to the most recent recorded trace.',
        },
        windowId: {
          type: 'number',
          description:
            'When tabId is omitted, prefer the active tab in this window for last-result lookup.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Timeout for deep analysis via native host (milliseconds). Default 60000. Increase for large traces.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.READ_PAGE,
    description:
      'Read the current web page so the AI can decide what to do next. Returns the page summary, important page objects, and executable candidateActions with targetRef values for click/fill tools.\nDefault output is the standard read (internal value L0+L1) to keep token use low; request the detailed read (internal value L0+L1+L2) only when the AI needs detailed object refs. Use candidateActions/targetRef for browser control, not markdown text.\nAfter any click/fill/navigation, call chrome_read_page again when the AI needs to verify the page result before continuing.\nLimitation: Does not work on chrome:// or browser-internal pages; sparse or highly dynamic pages may need a screenshot fallback.',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        ...TASK_RUNTIME_PROPERTIES,
        filter: {
          type: 'string',
          description:
            'Filter elements: "interactive" for such as  buttons/links/inputs only (default: all visible elements)',
        },
        mode: {
          type: 'string',
          enum: ['compact', 'normal', 'full'],
          description:
            'Output mode for read_page snapshot. compact (default): execution-oriented summary; normal: richer debugging view; full: include complete snapshot details.',
        },
        render: {
          type: 'string',
          enum: ['json', 'markdown'],
          description:
            "'json' (default) emits the structured DOM-semantic snapshot whose HVOs/candidateActions/targetRef are the click/fill execution truth. 'markdown' adds a low-token Markdown projection (`markdown` field) of the top objects + interactive labels for text-heavy reading; the JSON HVOs/candidateActions/targetRef are still emitted unchanged so locator resolution is unaffected. Markdown is a READING surface, NOT an execution surface — never use it for click targeting.",
        },
        requestedLayer: {
          type: 'string',
          enum: ['L0', 'L0+L1', 'L0+L1+L2'],
          description:
            "Optional internal detail envelope for advanced clients. Prefer the product meanings: 'L0' = light read, 'L0+L1' = standard read/default, 'L0+L1+L2' = detailed read. Light read returns only the summary task layer plus stable HVO targetRef registry; standard read adds high-value object and candidate-action ids while suppressing detailed refs; detailed read returns the full controlled expansion and must be requested explicitly. Stable HVO targetRef registry is always written even at 'L0' so chrome_click_element resolution stays deterministic.",
        },
        depth: {
          type: 'number',
          description:
            'Maximum DOM depth to traverse (integer >= 0). Lower values reduce output size and can improve performance.',
        },
        refId: {
          type: 'string',
          description:
            'Focus on the subtree rooted at this element refId (e.g., "ref_12"). The refId must come from a recent chrome_read_page response in the same tab (refs may expire).',
        },
        tabId: {
          type: 'number',
          description: 'Target an existing tab by ID (default: active tab).',
        },
        windowId: {
          type: 'number',
          description: 'Target window ID to pick active tab when tabId is omitted.',
        },
        frameId: {
          type: 'number',
          description:
            'Optional Chrome frame ID for a targeted iframe/subframe read. Use only when Tabrix previously surfaced a concrete frameId; omitted means read the default responding frame. Candidate actions and targetRefs returned from a frame-targeted read are bound to that frame for later click/fill execution.',
        },
        includeAuthArtifacts: {
          type: 'boolean',
          description:
            'Default false. When true, and only for an auth-scoped QR surface in an AI-operable tab, include a temporary auth_qr_image artifact reference for remote user login collaboration.',
        },
        assistantGuidance: {
          type: 'object',
          description:
            'Optional AI-provided observation guidance for chrome_read_page. Tabrix uses it only to prioritize/filter what it observes (for example QR login over OTP controls); it is not Tabrix-side planning, not a success claim, and not permission to operate protected tabs.',
          properties: {
            taskKind: {
              type: 'string',
              enum: ['auth', 'search', 'extract_content', 'unknown'],
              description: 'High-level task kind used only as an observation hint.',
            },
            authPreference: {
              type: 'string',
              enum: ['qr', 'otp', 'manual', 'auto'],
              description:
                "Preferred auth challenge to observe first. For example, use 'qr' when the user explicitly asked for扫码/scan login so OTP controls remain alternatives instead of the main path.",
            },
            requestedObjects: {
              type: 'array',
              items: {
                type: 'string',
                enum: [
                  'auth_surface',
                  'qr_image',
                  'phone_input',
                  'otp_input',
                  'search_input',
                  'result_cards',
                  'detail_metrics',
                ],
              },
              description:
                'Observation targets the AI wants Tabrix to surface. These are filters/priorities only, not execution instructions.',
            },
            assistantProvidedTarget: {
              type: 'object',
              description:
                'Optional target chosen by the AI after inspecting prior candidates. Tabrix may use selector/targetRef/frameId to retry scoped observation or artifact extraction, then return the updated page result.',
              properties: {
                purpose: {
                  type: 'string',
                  enum: ['auth_qr_image', 'click', 'fill', 'observe'],
                },
                targetRef: {
                  type: 'string',
                  description: 'Target ref from a recent read_page response in the same tab.',
                },
                selector: {
                  type: 'string',
                  description:
                    'CSS selector selected by the AI from Tabrix-provided candidates; used only for scoped observation/extraction.',
                },
                frameId: {
                  type: 'number',
                  description: 'Optional frame id when the chosen target belongs to a subframe.',
                },
              },
            },
          },
        },
        forceRefresh: {
          type: 'boolean',
          description:
            'Default false. When true, bypass read_page cached-read reuse and force a fresh browser read. Use after user-side login collaboration, QR scans, OTP/captcha/manual confirmation, or any external browser change that Tabrix did not perform through an MCP action.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS,
    description:
      'Collect result-card objects across the current page by repeatedly reading the visible viewport, scrolling, merging, and de-duplicating cards until a requested Top N is reached or the page is exhausted. Use this when a search/feed/list page needs a stable top-N card set; do not use chrome_read_page alone to claim completeness on virtualized or infinite-scroll pages.',
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target an existing tab by ID (default: active tab).',
        },
        windowId: {
          type: 'number',
          description: 'Target window ID to pick active tab when tabId is omitted.',
        },
        minResults: {
          type: 'number',
          description: 'Minimum card count to collect before stopping. Default 10, max 50.',
        },
        maxScrolls: {
          type: 'number',
          description:
            'Maximum number of downward scroll steps after the first viewport read. Default 4, max 10.',
        },
        scrollStepPx: {
          type: 'number',
          description:
            'Pixels to scroll per step. Defaults to about 85% of the current viewport height.',
        },
        settleMs: {
          type: 'number',
          description:
            'Milliseconds to wait after each scroll for lazy-loaded cards to appear. Default 700, max 5000.',
        },
        startFromTop: {
          type: 'boolean',
          description:
            'Default true. Scroll to the top before collecting so Top N means the first results on the page. Set false to collect from the current viewport.',
        },
        outputMode: {
          type: 'string',
          enum: ['full', 'compact'],
          description:
            'Default full. Use compact for an AI-facing top-N card summary without verbose actionTarget/region payloads; use full when object projection or detailed debugging needs the complete structure.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.COMPUTER,
    description:
      'High-risk fallback tool for mouse/keyboard/drag/scroll interactions and screenshots.\nUse this only after ref-based or DOM-based tools (chrome_read_page, chrome_get_interactive_elements, chrome_click_element, chrome_fill_or_select, chrome_keyboard, chrome_navigate, chrome_switch_tab) are insufficient.\nDo not use chrome_computer for routine page-settle waits, simple tab switching, or basic DOM discovery. When you must use it, prefer precise refs over raw coordinates and keep actions minimal.',
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Target tab ID (default: active tab)' },
        background: {
          type: 'boolean',
          description:
            'Avoid focusing/activating tab/window for certain operations (best-effort). Default: false',
        },
        action: {
          type: 'string',
          description:
            'Action to perform: left_click | right_click | double_click | triple_click | left_click_drag | scroll | scroll_to | type | key | fill | fill_form | hover | wait | resize_page | zoom | screenshot',
        },
        ref: {
          type: 'string',
          description:
            'Element ref from chrome_read_page. For click/scroll/scroll_to/key/type and drag end when provided; takes precedence over coordinates.',
        },
        candidateAction: {
          type: 'object',
          description:
            'Optional action seed from chrome_read_page.candidateActions. Resolution order: explicit ref > candidateAction.targetRef > explicit selector > candidateAction.locatorChain(xpath/css/ref). aria locators are currently informational only.',
          properties: {
            targetRef: {
              type: 'string',
              description: 'Preferred element ref from read_page candidateActions[*].targetRef.',
            },
            executionTargetKind: {
              type: 'string',
              enum: ['page_ref', 'snapshot_locator', 'stable_ref'],
              description:
                'Preserve read_page candidateActions[*].executionTargetKind. snapshot_locator tells Tabrix to execute through the current XPath/CSS locator chain instead of treating the synthetic targetRef as a page-local ref.',
            },
            label: {
              type: 'string',
              description:
                'Optional AI-facing read_page candidateActions[*].label. It is descriptive text only; execution still uses targetRef or locatorChain.',
            },
            intent: {
              type: 'string',
              description:
                'Optional read_page candidateActions[*].intent, used to choose post-action verification such as auth.request_otp, search.submit, or content.open_detail.',
            },
            locatorChain: {
              type: 'array',
              description:
                'Fallback locator list from read_page candidateActions[*].locatorChain. xpath/css/ref are executable fallbacks; aria is informational.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  value: { type: 'string' },
                },
                required: ['type', 'value'],
              },
            },
          },
        },
        coordinates: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate' },
            y: { type: 'number', description: 'Y coordinate' },
          },
          description:
            'Coordinates for actions (in screenshot space if a recent screenshot was taken, otherwise viewport). Required for click/scroll and as end point for drag.',
        },
        startCoordinates: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          description: 'Starting coordinates for drag action',
        },
        startRef: {
          type: 'string',
          description: 'Drag start ref from chrome_read_page (alternative to startCoordinates).',
        },
        scrollDirection: {
          type: 'string',
          description: 'Scroll direction: up | down | left | right',
        },
        scrollAmount: {
          type: 'number',
          description: 'Scroll ticks (1-10), default 3',
        },
        text: {
          type: 'string',
          description:
            'Text to type (for action=type) or keys/chords separated by space (for action=key, e.g. "Backspace Enter" or "cmd+a")',
        },
        repeat: {
          type: 'number',
          description:
            'For action=key: number of times to repeat the key sequence (integer 1-100, default 1).',
        },
        modifiers: {
          type: 'object',
          description:
            'Modifier keys for click actions (left_click/right_click/double_click/triple_click).',
          properties: {
            altKey: { type: 'boolean' },
            ctrlKey: { type: 'boolean' },
            metaKey: { type: 'boolean' },
            shiftKey: { type: 'boolean' },
          },
        },
        region: {
          type: 'object',
          description:
            'For action=zoom: rectangular region to capture (x0,y0)-(x1,y1) in viewport pixels (or screenshot-space if a recent screenshot context exists).',
          properties: {
            x0: { type: 'number' },
            y0: { type: 'number' },
            x1: { type: 'number' },
            y1: { type: 'number' },
          },
          required: ['x0', 'y0', 'x1', 'y1'],
        },
        // For action=fill
        selector: {
          type: 'string',
          description: 'CSS selector for fill (alternative to ref).',
        },
        value: {
          oneOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'number' }],
          description: 'Value to set for action=fill (string | boolean | number)',
        },
        elements: {
          type: 'array',
          description: 'For action=fill_form: list of elements to fill (ref + value)',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'Element ref from chrome_read_page' },
              value: { type: 'string', description: 'Value to set (stringified if non-string)' },
            },
            required: ['ref', 'value'],
          },
        },
        width: { type: 'number', description: 'For action=resize_page: viewport width' },
        height: { type: 'number', description: 'For action=resize_page: viewport height' },
        appear: {
          type: 'boolean',
          description:
            'For action=wait with text: whether to wait for the text to appear (true, default) or disappear (false)',
        },
        timeout: {
          type: 'number',
          description:
            'For action=wait with text: timeout in milliseconds (default 10000, max 120000)',
        },
        duration: {
          type: 'number',
          description: 'Seconds to wait for action=wait (max 30s)',
        },
        saveToDownloads: {
          type: 'boolean',
          description:
            'For action=screenshot: save the screenshot as a PNG file to the browser downloads folder (default: false — returns base64 only).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.NAVIGATE,
    description:
      'Navigate to a URL, refresh the current tab, or move browser history (back/forward). Returns navigation/settle details including final URL and page status, so prefer this over using chrome_computer wait after normal navigation.',
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        ...TASK_RUNTIME_PROPERTIES,
        url: {
          type: 'string',
          description:
            'URL to navigate to. Special values: "back" or "forward" to navigate browser history in the target tab.',
        },
        newWindow: {
          type: 'boolean',
          description: 'Create a new window to navigate to the URL or not. Defaults to false',
        },
        tabId: {
          type: 'number',
          description:
            'Target an existing tab by ID (if provided, navigate/refresh/back/forward that tab instead of the active tab).',
        },
        windowId: {
          type: 'number',
          description:
            'Target an existing window by ID (when creating a new tab in existing window, or picking active tab if tabId is not provided).',
        },
        background: {
          type: 'boolean',
          description:
            'Perform the operation without stealing focus (do not activate the tab or focus the window). Default: false',
        },
        width: {
          type: 'number',
          description:
            'Window width in pixels (default: 1280). When width or height is provided, a new window will be created.',
        },
        height: {
          type: 'number',
          description:
            'Window height in pixels (default: 720). When width or height is provided, a new window will be created.',
        },
        refresh: {
          type: 'boolean',
          description:
            'Refresh the current active tab instead of navigating to a URL. When true, the url parameter is ignored. Defaults to false',
        },
        settleTimeoutMs: {
          type: 'number',
          description:
            'Optional navigation settle timeout in milliseconds. Defaults to the runtime standard timeout; use a larger value only for slow pages where a document must become readable. Clamped to 1000-60000.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.SCREENSHOT,
    description:
      'Take a screenshot of the current page or a specific element. Prefer chrome_read_page before using screenshots for routine discovery, and use this tool for visual confirmation or coordinate fallback when the DOM/ref path is insufficient.\nLimitation: Full-page or large-viewport captures may time out on complex pages. If capture fails, try a smaller viewport before escalating to chrome_computer.',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the screenshot, if saving as PNG' },
        selector: { type: 'string', description: 'CSS selector for element to screenshot' },
        tabId: {
          type: 'number',
          description: 'Target tab ID to capture from (default: active tab).',
        },
        windowId: {
          type: 'number',
          description: 'Target window ID to pick active tab from when tabId is not provided.',
        },
        background: {
          type: 'boolean',
          description:
            'Attempt capture without bringing tab/window to foreground. CDP-based capture is used for simple viewport captures. For element/full-page capture, the tab may still be made active in its window without focusing the window. Default: false',
        },
        width: { type: 'number', description: 'Width in pixels (default: 800)' },
        height: { type: 'number', description: 'Height in pixels (default: 600)' },
        storeBase64: {
          type: 'boolean',
          description:
            'return screenshot in base64 format (default: false) if you want to see the page, recommend set this to be true',
        },
        fullPage: {
          type: 'boolean',
          description: 'Store screenshot of the entire page (default: false)',
        },
        savePng: {
          type: 'boolean',
          description:
            'Save screenshot as PNG file (default: true)，if you want to see the page, recommend set this to be false, and set storeBase64 to be true',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.CLOSE_TABS,
    description: 'Close one or more browser tabs',
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        ...TASK_RUNTIME_PROPERTIES,
        tabIds: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Array of explicit tab IDs to close. Use this for run-owned tabs; active-tab close without tabIds is refused.',
        },
        url: {
          type: 'string',
          description:
            'Close tabs matching this URL. Prefer explicit tabIds for cleanup; broad URL close can affect user tabs.',
        },
        windowId: {
          type: 'number',
          description: 'Optional window scope for URL-based close operations.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.SWITCH_TAB,
    description:
      'Switch to a specific browser tab and confirm activation/focus state. Returns the active tab URL and page status so callers can avoid extra wait or debugger-only fallback for simple tab changes.',
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        ...TASK_RUNTIME_PROPERTIES,
        tabId: {
          type: 'number',
          description: 'The ID of the tab to switch to.',
        },
        windowId: {
          type: 'number',
          description: 'The ID of the window where the tab is located.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.TAB_GROUP_CREATE,
    description:
      'Create a new Chrome tab group from a list of tabs. Optionally set the group title, color, or target window. Returns the new groupId. Requires Chrome 89+ and the "tabGroups" permission.',
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tabIds: {
          type: 'array',
          items: { type: 'number' },
          minItems: 1,
          description:
            'Tab IDs to include in the new group. All tabs must belong to the same window (Chrome moves them together when grouping).',
        },
        title: {
          type: 'string',
          description: 'Optional title displayed on the group label.',
        },
        color: {
          type: 'string',
          enum: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'],
          description: 'Optional color for the group label. Defaults to a Chrome-assigned color.',
        },
        windowId: {
          type: 'number',
          description:
            'Optional window ID for the new group. Tabs must already live in this window; otherwise Chrome ignores this hint.',
        },
      },
      required: ['tabIds'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.TAB_GROUP_UPDATE,
    description:
      'Update an existing Chrome tab group: rename it, change its color, or expand/collapse it. At least one of title, color, or collapsed must be provided. Note: Chrome cannot collapse a group whose tab is currently active — open automation tabs with background: true before collapsing.',
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        groupId: {
          type: 'number',
          description: 'The ID of the group to update (from chrome_tab_group_create or _list).',
        },
        title: {
          type: 'string',
          description: 'New title for the group label. Pass an empty string to clear the title.',
        },
        color: {
          type: 'string',
          enum: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'],
          description: 'New color for the group label.',
        },
        collapsed: {
          type: 'boolean',
          description:
            'Collapse (true) or expand (false) the group. Note: Chrome cannot collapse a group whose tab is currently active.',
        },
      },
      required: ['groupId'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.TAB_GROUP_ADD_TABS,
    description:
      'Add one or more existing tabs to an existing Chrome tab group. Tabs must be in the same window as the group; otherwise Chrome rejects the call.',
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        groupId: {
          type: 'number',
          description: 'The ID of the existing group to add tabs to.',
        },
        tabIds: {
          type: 'array',
          items: { type: 'number' },
          minItems: 1,
          description: 'Tab IDs to add to the group.',
        },
      },
      required: ['groupId', 'tabIds'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.TAB_GROUP_CLOSE,
    description:
      'Close all tabs that belong to a Chrome tab group. The group itself disappears once empty. Use chrome_tab_group_update with collapsed=true if you only want to hide the group.',
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        groupId: {
          type: 'number',
          description: 'The ID of the group whose tabs should be closed.',
        },
      },
      required: ['groupId'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.TAB_GROUP_LIST,
    description:
      'List all Chrome tab groups, optionally filtered by window, color, title, or collapsed state. Each entry includes the tab IDs that currently belong to the group.',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        windowId: {
          type: 'number',
          description: 'Restrict results to groups in a specific window.',
        },
        color: {
          type: 'string',
          enum: ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'],
          description: 'Restrict results to groups with this color.',
        },
        title: {
          type: 'string',
          description: 'Restrict results to groups with this exact title.',
        },
        collapsed: {
          type: 'boolean',
          description: 'Restrict results to collapsed (true) or expanded (false) groups.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.MOVE_TAB,
    description:
      'Move an existing tab to another window or detach it into a new window without reloading. Preserves scroll position, form state, and navigation history. Provide exactly one of windowId or newWindow=true.',
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'The ID of the tab to move.',
        },
        windowId: {
          type: 'number',
          description: 'Destination window ID. Mutually exclusive with newWindow=true.',
        },
        newWindow: {
          type: 'boolean',
          description:
            'When true, detach the tab into a new window. Mutually exclusive with windowId. Default: false.',
        },
        index: {
          type: 'number',
          description:
            'Position within the destination window. Default: -1 (append). Ignored when newWindow=true.',
        },
        focused: {
          type: 'boolean',
          description: 'Focus the destination window after the move. Default: true.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.WEB_FETCHER,
    description:
      'Fetch visible text or HTML content from a web page. Returns content-quality hints when a route is text-sparse, so prefer chrome_read_page before escalating to javascript on highly interactive pages.',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        ...TASK_RUNTIME_PROPERTIES,
        url: {
          type: 'string',
          description: 'URL to fetch content from. If not provided, uses the current active tab',
        },
        tabId: {
          type: 'number',
          description: 'Target an existing tab by ID (default: active tab).',
        },
        windowId: {
          type: 'number',
          description:
            'When tabId is omitted: use the active tab in this window (default: current window). When url is opened in a new tab, create the tab in this window.',
        },
        background: {
          type: 'boolean',
          description: 'Do not activate tab/focus window while fetching (default: false)',
        },
        htmlContent: {
          type: 'boolean',
          description:
            'Get the visible HTML content of the page. If true, textContent will be ignored (default: false)',
        },
        textContent: {
          type: 'boolean',
          description:
            'Get the visible text content of the page with metadata. Ignored if htmlContent is true (default: true)',
        },
        textMode: {
          type: 'string',
          enum: ['body', 'full-visible'],
          description:
            'Text extraction mode when textContent is true. body (default) extracts the main article/body text to reduce noise; full-visible returns page-level visible text similar to document.body.innerText for coverage comparisons.',
        },
        settleTimeoutMs: {
          type: 'number',
          description:
            'Optional timeout in milliseconds to wait for a newly opened URL tab to settle before extracting content. Defaults to a bounded web-content timeout; clamped to 1000-60000.',
        },

        selector: {
          type: 'string',
          description:
            'CSS selector to get content from a specific element. If provided, only content from this element will be returned',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.NETWORK_REQUEST,
    description: 'Send a network request from the browser with cookies and other browser context',
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to send the request to',
        },
        method: {
          type: 'string',
          description: 'HTTP method to use (default: GET)',
        },
        headers: {
          type: 'object',
          description: 'Headers to include in the request',
        },
        body: {
          type: 'string',
          description: 'Body of the request (for POST, PUT, etc.)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
        formData: {
          type: 'object',
          description:
            'Multipart/form-data descriptor. If provided, overrides body and builds FormData with optional file attachments. Shape: { fields?: Record<string,string|number|boolean>, files?: Array<{ name: string, fileUrl?: string, filePath?: string, base64Data?: string, filename?: string, contentType?: string }> }. Also supports a compact array form: [ [name, fileSpec, filename?], ... ] where fileSpec may be url:, file:, or base64:.',
        },
        tabId: {
          type: 'number',
          description:
            'Inject the helper into this tab and run the request from its content-script context (cookies/session). Defaults to active tab when omitted.',
        },
        windowId: {
          type: 'number',
          description:
            'When tabId is omitted, use the active tab in this window (default: current window).',
        },
      },
      required: ['url'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
    description:
      'Unified network capture tool. Use action="start" to begin capturing, action="stop" to end and retrieve results. Set needResponseBody=true to capture response bodies (uses Debugger API, may conflict with DevTools). Default mode uses webRequest API (lightweight, no debugger conflict, but no response body).',
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'stop'],
          description: 'Action to perform: "start" begins capture, "stop" ends and returns results',
        },
        needResponseBody: {
          type: 'boolean',
          description:
            'When true, captures response body using Debugger API (default: false). Only use when you need to inspect response content.',
        },
        url: {
          type: 'string',
          description:
            'URL to capture network requests from. For action="start". If not provided, uses the current active tab.',
        },
        maxCaptureTime: {
          type: 'number',
          description: 'Maximum capture time in milliseconds (default: 180000)',
        },
        inactivityTimeout: {
          type: 'number',
          description: 'Stop after inactivity in milliseconds (default: 60000). Set 0 to disable.',
        },
        includeStatic: {
          type: 'boolean',
          description: 'Include static resources like images/scripts/styles (default: false)',
        },
        tabId: {
          type: 'number',
          description:
            'For action=start without url: capture on this tab. For action=stop: stop capture on this tab when it matches an active capture.',
        },
        windowId: {
          type: 'number',
          description:
            'When tabId is omitted: for start without url, use active tab in this window; for stop, prefer stopping capture on that window active tab if it is capturing.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD,
    description: 'Wait for a browser download and return details (id, filename, url, state, size)',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        filenameContains: { type: 'string', description: 'Filter by substring in filename or URL' },
        url: {
          type: 'string',
          description:
            'Optional URL to trigger a download first, then wait for its completion in the browser.',
        },
        filename: {
          type: 'string',
          description:
            'Optional target filename when url is provided. Saved under Downloads/tabrix by default.',
        },
        saveAs: {
          type: 'boolean',
          description:
            'When url is provided, whether to force Save As dialog (default: false for silent save).',
        },
        allowBrowserFallback: {
          type: 'boolean',
          description:
            'Debug-only escape hatch. When true and native bridge is unavailable, allow fallback to browser download path (may trigger Save As depending on browser settings). Default: false.',
        },
        timeoutMs: { type: 'number', description: 'Timeout in ms (default 60000, max 300000)' },
        waitForComplete: { type: 'boolean', description: 'Wait until completed (default true)' },
        sessionId: {
          type: 'string',
          description:
            'Optional session scope id for download dedupe. When provided, duplicate downloads are deduped inside this session.',
        },
        taskId: {
          type: 'string',
          description:
            'Optional task scope id for download dedupe (higher priority than sessionId). Duplicate downloads are deduped inside this task.',
        },
        dedupeWindowSec: {
          type: 'number',
          description:
            'Duplicate-join window in seconds (default 60, range 1-300). Within this window, same scoped request can reuse an existing job.',
        },
        dedupePolicy: {
          type: 'string',
          enum: ['join', 'force'],
          description:
            'Duplicate handling policy (default join). join: reuse existing in-window job; force: always create a new download job.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.HISTORY,
    description: 'Retrieve and search browsing history from Chrome',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'Text to search for in history URLs and titles. Leave empty to retrieve all history entries within the time range.',
        },
        startTime: {
          type: 'string',
          description:
            'Start time as a date string. Supports ISO format (e.g., "2023-10-01", "2023-10-01T14:30:00"), relative times (e.g., "1 day ago", "2 weeks ago", "3 months ago", "1 year ago"), and special keywords ("now", "today", "yesterday"). Default: 24 hours ago',
        },
        endTime: {
          type: 'string',
          description:
            'End time as a date string. Supports ISO format (e.g., "2023-10-31", "2023-10-31T14:30:00"), relative times (e.g., "1 day ago", "2 weeks ago", "3 months ago", "1 year ago"), and special keywords ("now", "today", "yesterday"). Default: current time',
        },
        maxResults: {
          type: 'number',
          description:
            'Maximum number of history entries to return. Use this to limit results for performance or to focus on the most relevant entries. (default: 100)',
        },
        excludeCurrentTabs: {
          type: 'boolean',
          description:
            "When set to true, filters out URLs that are currently open in any browser tab. Useful for finding pages you've visited but don't have open anymore. (default: false)",
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.BOOKMARK_SEARCH,
    description: 'Search Chrome bookmarks by title and URL',
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query to match against bookmark titles and URLs. Leave empty to retrieve all bookmarks.',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of bookmarks to return (default: 50)',
        },
        folderPath: {
          type: 'string',
          description:
            'Optional folder path or ID to limit search to a specific bookmark folder. Can be a path string (e.g., "Work/Projects") or a folder ID.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.BOOKMARK_ADD,
    description: 'Add a new bookmark to Chrome',
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'URL to bookmark. If not provided, uses the URL from the tab given by tabId/windowId, or the active tab.',
        },
        title: {
          type: 'string',
          description: 'Title for the bookmark. If not provided, uses the page title from the URL.',
        },
        parentId: {
          type: 'string',
          description:
            'Parent folder path or ID to add the bookmark to. Can be a path string (e.g., "Work/Projects") or a folder ID. If not provided, adds to the "Bookmarks Bar" folder.',
        },
        createFolder: {
          type: 'boolean',
          description: 'Whether to create the parent folder if it does not exist (default: false)',
        },
        tabId: {
          type: 'number',
          description:
            'When url is omitted, bookmark this tab (default: active tab in current or specified window).',
        },
        windowId: {
          type: 'number',
          description:
            'When url is omitted and tabId is omitted, use the active tab in this window.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.BOOKMARK_DELETE,
    description: 'Delete a bookmark from Chrome',
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId: {
          type: 'string',
          description: 'ID of the bookmark to delete. Either bookmarkId or url must be provided.',
        },
        url: {
          type: 'string',
          description: 'URL of the bookmark to delete. Used if bookmarkId is not provided.',
        },
        title: {
          type: 'string',
          description: 'Title of the bookmark to help with matching when deleting by URL.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS,
    description:
      'Get interactive elements (buttons, links, inputs, selects, etc.) from the current page. Returns element details including text, type, coordinates, and attributes. Useful for discovering actionable UI elements before interacting with them.',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        textQuery: {
          type: 'string',
          description:
            'Text to search for within interactive elements (fuzzy match on visible text or aria-label).',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to filter interactive elements.',
        },
        includeCoordinates: {
          type: 'boolean',
          description: 'Include element coordinates in the response (default: true).',
        },
        types: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Types of interactive elements to include (e.g., "button", "link", "input", "select"). Default: all types.',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
      },
      required: [],
    },
  },
  // {
  //   name: TOOL_NAMES.BROWSER.INJECT_SCRIPT,
  //   description:
  //     'inject the user-specified content script into the webpage. By default, inject into the currently active tab',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       url: {
  //         type: 'string',
  //         description:
  //           'If a URL is specified, inject the script into the webpage corresponding to the URL.',
  //       },
  //       tabId: {
  //         type: 'number',
  //         description:
  //           'Target an existing tab by ID to inject into. Overrides url/active tab selection when provided.',
  //       },
  //       windowId: {
  //         type: 'number',
  //         description:
  //           'Target window ID for selecting active tab or creating new tab when url is provided and tabId is omitted.',
  //       },
  //       background: {
  //         type: 'boolean',
  //         description:
  //           'Do not activate tab/focus window during injection when true (default: false).',
  //       },
  //       type: {
  //         type: 'string',
  //         description:
  //           'the javaScript world for a script to execute within. must be ISOLATED or MAIN',
  //       },
  //       jsScript: {
  //         type: 'string',
  //         description: 'the content script to inject',
  //       },
  //     },
  //     required: ['type', 'jsScript'],
  //   },
  // },
  // {
  //   name: TOOL_NAMES.BROWSER.SEND_COMMAND_TO_INJECT_SCRIPT,
  //   description:
  //     'if the script injected using chrome_inject_script listens for user-defined events, this tool can be used to trigger those events',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       tabId: {
  //         type: 'number',
  //         description:
  //           'the tab where you previously injected the script(if not provided,  use the currently active tab)',
  //       },
  //       eventName: {
  //         type: 'string',
  //         description: 'the eventName your injected content script listen for',
  //       },
  //       payload: {
  //         type: 'string',
  //         description: 'the payload passed to event, must be a json string',
  //       },
  //     },
  //     required: ['eventName'],
  //   },
  // },
  {
    name: TOOL_NAMES.BROWSER.JAVASCRIPT,
    description:
      'Execute JavaScript code in a browser tab and return the result. This is an advanced fallback for cases where normal Tabrix tools cannot read or operate the page. Do not use it for routine tab discovery, navigation waits, or simple content extraction when chrome_read_page, chrome_get_web_content, chrome_get_interactive_elements, chrome_click_element, or chrome_fill_or_select can do the job. The calling AI/client must review the script intent, data access, and side effects before sending it. Uses CDP Runtime.evaluate with awaitPromise and returnByValue; automatically falls back to chrome.scripting.executeScript if the debugger is busy. Output is redacted and truncated by default.',
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'JavaScript code to execute. Runs inside an async function body, so top-level await and "return ..." are supported. Before passing this code to Tabrix, the calling AI/client is responsible for checking whether the script reads sensitive data, changes page state, navigates, submits forms, deletes data, or has other user-visible side effects.',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description:
            'When tabId is omitted, use the active tab in this window (default: current window).',
        },
        timeoutMs: {
          type: 'number',
          description: 'Execution timeout in milliseconds (default: 15000).',
        },
        maxOutputBytes: {
          type: 'number',
          description:
            'Maximum output size in bytes after sanitization (default: 51200). Output exceeding this limit will be truncated.',
        },
      },
      required: ['code'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.CLICK,
    description:
      'Click on or safely hover a known element in a web page. Supports multiple targeting methods: CSS selector, XPath, element ref (from chrome_read_page), or viewport coordinates for clicks. Hover is limited to ref/selector/candidateAction targets and must be followed by chrome_read_page verification. More focused than chrome_computer for simple element operations.',
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        ...TASK_RUNTIME_PROPERTIES,
        selector: {
          type: 'string',
          description: 'CSS selector or XPath for the element to click.',
        },
        selectorType: {
          type: 'string',
          enum: ['css', 'xpath'],
          description: 'Type of selector (default: "css").',
        },
        interaction: {
          type: 'string',
          enum: ['click', 'hover'],
          description:
            'Element interaction to perform. Default is "click". "hover" is a safe discovery action for known refs/selectors/candidateActions only; coordinate-only hover is intentionally rejected and should remain a chrome_computer fallback.',
        },
        ref: {
          type: 'string',
          description: 'Element ref from chrome_read_page (takes precedence over selector).',
        },
        candidateAction: {
          type: 'object',
          description:
            'Optional action seed from chrome_read_page.candidateActions. Resolution order: explicit ref > candidateAction.targetRef > explicit selector > candidateAction.locatorChain(xpath/css/ref).',
          properties: {
            targetRef: {
              type: 'string',
              description: 'Preferred element ref from read_page candidateActions[*].targetRef.',
            },
            executionTargetKind: {
              type: 'string',
              enum: ['page_ref', 'snapshot_locator', 'stable_ref'],
              description:
                'Preserve read_page candidateActions[*].executionTargetKind. snapshot_locator tells Tabrix to execute through the current XPath/CSS locator chain instead of treating the synthetic targetRef as a page-local ref.',
            },
            label: {
              type: 'string',
              description:
                'Optional AI-facing read_page candidateActions[*].label. It is descriptive text only; execution still uses targetRef or locatorChain.',
            },
            intent: {
              type: 'string',
              description:
                'Optional read_page candidateActions[*].intent, used to choose post-action verification such as auth.request_otp, search.submit, or content.open_detail.',
            },
            locatorChain: {
              type: 'array',
              description:
                'Fallback locator list from read_page candidateActions[*].locatorChain. xpath/css/ref are executable fallbacks; aria is informational.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  value: { type: 'string' },
                },
                required: ['type', 'value'],
              },
            },
          },
        },
        coordinates: {
          type: 'object',
          description: 'Viewport coordinates to click at.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
        },
        double: {
          type: 'boolean',
          description: 'Perform double click when true (default: false).',
        },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: 'Mouse button to click (default: "left").',
        },
        modifiers: {
          type: 'object',
          description: 'Modifier keys to hold during click.',
          properties: {
            altKey: { type: 'boolean' },
            ctrlKey: { type: 'boolean' },
            metaKey: { type: 'boolean' },
            shiftKey: { type: 'boolean' },
          },
        },
        allowDownloadClick: {
          type: 'boolean',
          description:
            'When false (default), clicks on likely download links are intercepted and routed through extension-side download flow to avoid Save As dialogs.',
        },
        waitForNavigation: {
          type: 'boolean',
          description: 'Wait for navigation to complete after click (default: false).',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds for waiting (default: 5000).',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
        frameId: {
          type: 'number',
          description: 'Target frame ID for iframe support.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.FILL,
    description:
      'Fill or select a form element on a web page. Supports input, textarea, select, checkbox, and radio elements. Use CSS selector, XPath, or element ref to target the element.',
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        ...TASK_RUNTIME_PROPERTIES,
        selector: {
          type: 'string',
          description: 'CSS selector or XPath for the form element.',
        },
        selectorType: {
          type: 'string',
          enum: ['css', 'xpath'],
          description: 'Type of selector (default: "css").',
        },
        ref: {
          type: 'string',
          description: 'Element ref from chrome_read_page (takes precedence over selector).',
        },
        candidateAction: {
          type: 'object',
          description:
            'Optional action seed from chrome_read_page.candidateActions. Resolution order: explicit ref > candidateAction.targetRef > explicit selector > candidateAction.locatorChain(xpath/css/ref).',
          properties: {
            targetRef: {
              type: 'string',
              description: 'Preferred element ref from read_page candidateActions[*].targetRef.',
            },
            executionTargetKind: {
              type: 'string',
              enum: ['page_ref', 'snapshot_locator', 'stable_ref'],
              description:
                'Preserve read_page candidateActions[*].executionTargetKind. snapshot_locator tells Tabrix to execute through the current XPath/CSS locator chain instead of treating the synthetic targetRef as a page-local ref.',
            },
            label: {
              type: 'string',
              description:
                'Optional AI-facing read_page candidateActions[*].label. It is descriptive text only; execution still uses targetRef or locatorChain.',
            },
            intent: {
              type: 'string',
              description:
                'Optional read_page candidateActions[*].intent, used as execution context. Fill can carry search.enter_query, but search success still requires a fresh post-action read.',
            },
            locatorChain: {
              type: 'array',
              description:
                'Fallback locator list from read_page candidateActions[*].locatorChain. xpath/css/ref are executable fallbacks; aria is informational.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  value: { type: 'string' },
                },
                required: ['type', 'value'],
              },
            },
          },
        },
        value: {
          type: ['string', 'number', 'boolean'],
          description:
            'Value to fill. For text inputs: string. For checkboxes/radios: boolean. For selects: option value or text.',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
        frameId: {
          type: 'number',
          description: 'Target frame ID for iframe support.',
        },
      },
      required: ['value'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.KEYBOARD,
    description:
      'Simulate keyboard input on a web page. Sends key events (Enter, Tab, Escape, Ctrl+C, etc.) or key combinations. For typing text into form fields, prefer chrome_fill_or_select; this tool is best for keyboard shortcuts and special keys.',
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        ...TASK_RUNTIME_PROPERTIES,
        keys: {
          type: 'string',
          description:
            'Keys or key combinations to simulate. Examples: "Enter", "Tab", "Ctrl+C", "Shift+Tab", "Ctrl+A, Backspace". For plain text typing, use chrome_fill_or_select instead.',
        },
        key: {
          type: 'string',
          description:
            'Alias for keys when sending a single key such as "Enter". Prefer keys for chords or multiple key events. Either keys or key must be provided.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector or XPath for target element to receive keyboard events.',
        },
        ref: {
          type: 'string',
          description:
            'Element ref from the latest chrome_read_page result. Prefer this over relying on the current browser focus when pressing Enter on a searchbox or focused control.',
        },
        candidateAction: {
          type: 'object',
          description:
            'Candidate action returned by chrome_read_page. When targetRef is present, chrome_keyboard focuses that exact element before dispatching keys.',
          additionalProperties: true,
        },
        selectorType: {
          type: 'string',
          enum: ['css', 'xpath'],
          description: 'Type of selector (default: "css").',
        },
        delay: {
          type: 'number',
          description: 'Delay between keystrokes in milliseconds (default: 50).',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
        frameId: {
          type: 'number',
          description: 'Target frame ID for iframe support.',
        },
      },
    },
  },
  {
    name: TOOL_NAMES.BROWSER.CONSOLE,
    description:
      'Capture console output from a browser tab. Supports snapshot mode (default; one-time capture with ~2s wait) and buffer mode (persistent per-tab buffer you can read/clear instantly without waiting).',
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'URL to navigate to and capture console from. If not provided, uses the current active tab',
        },
        tabId: {
          type: 'number',
          description: 'Target an existing tab by ID (default: active tab).',
        },
        windowId: {
          type: 'number',
          description: 'Target window ID to pick active tab when tabId is omitted.',
        },
        background: {
          type: 'boolean',
          description: 'Do not activate tab/focus window when capturing via CDP. Default: false',
        },
        includeExceptions: {
          type: 'boolean',
          description: 'Include uncaught exceptions in the output (default: true)',
        },
        maxMessages: {
          type: 'number',
          description:
            'Maximum number of console messages to capture in snapshot mode (default: 100). If limit is provided, it takes precedence.',
        },
        mode: {
          type: 'string',
          enum: ['snapshot', 'buffer'],
          description:
            'Console capture mode: snapshot (default; waits ~2s for messages) or buffer (persistent per-tab buffer; reads from memory instantly).',
        },
        buffer: {
          type: 'boolean',
          description: 'Alias for mode="buffer" (default: false).',
        },
        clear: {
          type: 'boolean',
          description:
            'Buffer mode only: clear the buffered logs for this tab before reading (default: false). Use clearAfterRead instead to clear after reading (mcp-tools.js style).',
        },
        clearAfterRead: {
          type: 'boolean',
          description:
            'Buffer mode only: clear the buffered logs for this tab AFTER reading, to avoid duplicate messages on subsequent calls (default: false). This matches mcp-tools.js behavior.',
        },
        pattern: {
          type: 'string',
          description:
            'Optional regex filter applied to message/exception text. Supports /pattern/flags syntax.',
        },
        onlyErrors: {
          type: 'boolean',
          description:
            'Only return error-level console messages (and exceptions when includeExceptions=true). Default: false.',
        },
        limit: {
          type: 'number',
          description:
            'Limit returned console messages. In snapshot mode this is an alias for maxMessages; in buffer mode it limits returned messages from the buffer.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.FILE_UPLOAD,
    description:
      'Upload files to web forms with file input elements using Chrome DevTools Protocol',
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Target tab ID (default: active tab)' },
        windowId: {
          type: 'number',
          description: 'Target window ID to pick active tab when tabId is omitted',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the file input element (input[type="file"])',
        },
        filePath: {
          type: 'string',
          description: 'Local file path to upload',
        },
        fileUrl: {
          type: 'string',
          description: 'URL to download file from before uploading',
        },
        base64Data: {
          type: 'string',
          description: 'Base64 encoded file data to upload',
        },
        fileName: {
          type: 'string',
          description: 'Optional filename when using base64 or URL (default: "uploaded-file")',
        },
        multiple: {
          type: 'boolean',
          description: 'Whether the input accepts multiple files (default: false)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.HANDLE_DIALOG,
    description:
      'Handle JavaScript dialogs (alert/confirm/prompt) via CDP on the target tab. Defaults to the active tab when tabId is omitted. Only works when a dialog is currently showing; returns an error otherwise.',
    annotations: {
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'accept | dismiss' },
        promptText: {
          type: 'string',
          description: 'Optional prompt text when accepting a prompt',
        },
        tabId: {
          type: 'number',
          description:
            'Tab where the dialog is shown (default: active tab in current or specified window)',
        },
        windowId: {
          type: 'number',
          description: 'When tabId is omitted, use the active tab in this window',
        },
      },
      required: ['action'],
    },
  },
];
