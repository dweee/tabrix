import nativeMessagingHostInstance from '../native-messaging-host';
import { handleToolCall } from './register-tools';
import { sessionManager } from '../execution/session-manager';
import { bridgeRuntimeState } from '../server/bridge-state';
import { bridgeCommandChannel } from '../server/bridge-command-channel';
import { resetDefaultPrimaryTabController } from '../runtime/primary-tab-controller';

describe('handleToolCall execution wrapper', () => {
  const markBridgeReady = () => {
    jest.spyOn(bridgeRuntimeState, 'syncBrowserProcessNow').mockImplementation(() => {
      bridgeRuntimeState.setBrowserProcessRunning(true);
      return true;
    });
    jest.spyOn(bridgeCommandChannel, 'isConnected').mockReturnValue(false);
    bridgeRuntimeState.setBrowserProcessRunning(true);
    bridgeRuntimeState.setCommandChannelConnected(true, {
      type: 'websocket',
      connectionId: 'test-connection',
    });
    bridgeRuntimeState.recordHeartbeat({
      sentAt: Date.now(),
      nativeConnected: true,
      extensionId: 'test-extension',
      connectionId: 'test-connection',
    });
    bridgeRuntimeState.setNativeHostAttached(true);
  };

  afterEach(() => {
    jest.restoreAllMocks();
    bridgeRuntimeState.reset();
    resetDefaultPrimaryTabController();
    sessionManager.reset();
    delete process.env.ENABLE_MCP_TOOLS;
    delete process.env.DISABLE_MCP_TOOLS;
    delete process.env.MCP_DISABLE_SENSITIVE_TOOLS;
    delete process.env.TABRIX_POLICY_ALLOW_P3;
  });

  it('tracks a successful tool call as a completed execution session', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });

    expect(result.isError).toBe(false);
    const sessions = sessionManager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('completed');
    expect(sessions[0].steps).toHaveLength(1);
    expect(sessions[0].steps[0].toolName).toBe('chrome_read_page');
    expect(sessions[0].steps[0].status).toBe('completed');
    expect(sessionManager.listTasks()[0].status).toBe('completed');
  });

  it('returns structured error payload when extension returns a non-recoverable error', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'error',
      error: 'tool execution failed',
    } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });
    const payload = JSON.parse(String(result.content[0].text));

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      code: 'TABRIX_TOOL_CALL_FAILED',
      message: 'tool execution failed',
      recoveryAttempted: false,
    });
  });

  it('returns structured error payload when tool invocation throws', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockRejectedValueOnce(new Error('unhandled tool transport failure'));

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });
    const payload = JSON.parse(String(result.content[0].text));

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      code: 'TABRIX_TOOL_CALL_EXCEPTION',
      message: 'unhandled tool transport failure',
      recoveryAttempted: false,
    });
  });

  it('tracks a rejected tool call as a failed execution session', async () => {
    markBridgeReady();
    process.env.ENABLE_MCP_TOOLS = 'chrome_read_page';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
      status: 'success',
      items: [],
    } as never);

    const result = await handleToolCall('chrome_close_tabs', {});

    expect(result.isError).toBe(true);
    const sessions = sessionManager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('failed');
    expect(sessions[0].steps[0].errorCode).toBe('tool_not_available');
    expect(sessionManager.listTasks()[0].status).toBe('failed');
  });

  it('blocks sensitive tools when MCP_DISABLE_SENSITIVE_TOOLS is set', async () => {
    markBridgeReady();
    process.env.MCP_DISABLE_SENSITIVE_TOOLS = 'true';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
      status: 'success',
      items: [],
    } as never);

    const result = await handleToolCall('chrome_javascript', { code: 'alert(1)' });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('disabled'),
    });
  });

  it('persists a page snapshot and injects historyRef for chrome_read_page', async () => {
    markBridgeReady();
    const readPageBody = {
      mode: 'compact',
      page: {
        url: 'https://github.com/openclaw/openclaw',
        title: 'openclaw/openclaw',
        pageType: 'web_page',
      },
      summary: { pageRole: 'github_repo_home', primaryRegion: 'main', quality: 'usable' },
      interactiveElements: [
        { ref: 'e1', role: 'link', name: 'Code' },
        { ref: 'e2', role: 'link', name: 'Issues' },
      ],
      artifactRefs: [{ kind: 'dom_snapshot', ref: 'artifact://read_page/1/t' }],
      highValueObjects: [],
      historyRef: null,
    };
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: JSON.stringify(readPageBody) }],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });

    expect(result.isError).toBe(false);
    const body = JSON.parse(String((result.content as any[])[0].text));
    expect(body.historyRef).toMatch(/^memory:\/\/snapshot\/[0-9a-f-]+$/);

    const sessions = sessionManager.listSessions();
    const step = sessions[0].steps[0];
    expect(step.artifactRefs).toHaveLength(1);
    expect(step.artifactRefs![0]).toBe(body.historyRef);
  });

  it('persists a memory_actions row and injects historyRef for chrome_click_element', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Clicked e-1',
              elementInfo: { role: 'button', name: 'Submit' },
              navigationOccurred: false,
              clickMethod: 'dom',
            }),
          },
        ],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_click_element', { tabId: 1, ref: 'e-1' });

    expect(result.isError).toBe(false);
    const body = JSON.parse(String((result.content as any[])[0].text));
    expect(body.historyRef).toMatch(/^memory:\/\/action\/[0-9a-f-]+$/);

    const sessions = sessionManager.listSessions();
    const step = sessions[0].steps[0];
    expect(step.artifactRefs).toHaveLength(1);
    expect(step.artifactRefs![0]).toBe(body.historyRef);

    const actions = sessionManager.actions!.listByStep(step.stepId);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionKind).toBe('click');
    expect(actions[0].tabId).toBe(1);
    expect(actions[0].targetRef).toBe('e-1');
    expect(actions[0].status).toBe('success');
  });

  it('redacts fill value and omits result_blob for chrome_fill_or_select', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: 'Filled input#user' }),
          },
        ],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_fill_or_select', {
      tabId: 1,
      ref: 'e-1',
      value: 'hunter2',
    });

    expect(result.isError).toBe(false);
    const sessions = sessionManager.listSessions();
    const step = sessions[0].steps[0];
    const actions = sessionManager.actions!.listByStep(step.stepId);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionKind).toBe('fill');
    expect(actions[0].resultBlob).toBeNull();
    expect(actions[0].argsBlob).not.toContain('hunter2');
    expect(actions[0].argsBlob).toContain('[redacted]');
    const summary = JSON.parse(actions[0].valueSummary!);
    expect(summary.kind).toBe('redacted');
    expect(summary.length).toBe('hunter2'.length);
  });

  it('blocks active user tab impact actions before the extension call', async () => {
    markBridgeReady();
    const bridgeSpy = jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({ status: 'success', items: [] } as never);

    const result = await handleToolCall('chrome_click_element', { ref: 'ref_42' });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.content[0].text));
    expect(payload).toMatchObject({
      ok: false,
      code: 'TABRIX_NON_INTERFERENCE_BLOCKED',
      runtimePolicyAudit: {
        policy: 'non_interference',
        verdict: 'block',
        reason: 'active_user_tab_unprotected',
        targetTabId: null,
      },
    });
    expect(bridgeSpy).toHaveBeenCalledTimes(1);
    const session = sessionManager.listSessions()[0];
    expect(session.steps[0].status).toBe('failed');
    expect(session.steps[0].errorCode).toBe('non_interference_blocked');
  });

  it('allows impact actions on a run-owned tab created by the same task session', async () => {
    markBridgeReady();
    const bridgeSpy = jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({ status: 'success', items: [] } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: JSON.stringify({ tabId: 77 }) }],
          isError: false,
        },
      } as never)
      .mockResolvedValueOnce({ status: 'success', items: [] } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
          isError: false,
        },
      } as never);

    await handleToolCall('chrome_navigate', {
      url: 'https://example.test/run-owned',
      taskSessionId: 'w4b-run-owned',
    });
    const clickResult = await handleToolCall('chrome_click_element', {
      tabId: 77,
      ref: 'ref_77',
      taskSessionId: 'w4b-run-owned',
      nonInterferencePolicy: 'strict',
    });

    expect(clickResult.isError).toBe(false);
    const clickPayload = JSON.parse(String(clickResult.content[0].text));
    expect(clickPayload.actionPreflight).toMatchObject({
      verdict: 'allow',
      reason: 'run_owned_tab',
    });
    expect(clickPayload.runtimePolicyAudit).toMatchObject({
      policy: 'non_interference',
      mode: 'strict',
      verdict: 'allow',
      reason: 'run_owned_tab',
      targetTabId: 77,
    });
    expect(bridgeSpy).toHaveBeenCalledTimes(4);
  });

  it('does not inherit stale primary-tab ownership for new-tab navigation without explicit task key', async () => {
    markBridgeReady();
    jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({ status: 'success', items: [] } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: JSON.stringify({ tabId: 77 }) }],
          isError: false,
        },
      } as never)
      .mockResolvedValueOnce({ status: 'success', items: [] } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: JSON.stringify({ tabId: 88 }) }],
          isError: false,
        },
      } as never);

    await handleToolCall('chrome_navigate', {
      url: 'https://example.test/first',
    });
    const secondNavigateResult = await handleToolCall('chrome_navigate', {
      url: 'https://example.test/second',
    });

    expect(secondNavigateResult.isError).toBe(false);
    const secondNavigatePayload = JSON.parse(String(secondNavigateResult.content[0].text));
    expect(secondNavigatePayload.runtimePolicyAudit).toMatchObject({
      verdict: 'allow',
      reason: 'new_run_owned_tab',
      runOwnedTabIds: [],
    });
  });

  it('releases stale run-owned tab ids reported as invalid by cleanup', async () => {
    markBridgeReady();
    jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({ status: 'success', items: [] } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: JSON.stringify({ tabId: 77 }) }],
          isError: false,
        },
      } as never)
      .mockResolvedValueOnce({ status: 'success', items: [] } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                closedTabIds: [],
                invalidTabIds: [77],
              }),
            },
          ],
          isError: false,
        },
      } as never);

    await handleToolCall('chrome_navigate', {
      url: 'https://example.test/run-owned',
      taskSessionId: 'w4b-stale-run-owned',
    });
    const cleanupResult = await handleToolCall('chrome_close_tabs', {
      tabIds: [77],
      taskSessionId: 'w4b-stale-run-owned',
    });

    expect(cleanupResult.isError).toBe(false);
    const cleanupPayload = JSON.parse(String(cleanupResult.content[0].text));
    expect(cleanupPayload.runtimePolicyAudit).toMatchObject({
      verdict: 'allow',
      reason: 'run_owned_tab',
      runOwnedTabIds: [77],
    });

    const strictClickResult = await handleToolCall('chrome_click_element', {
      tabId: 77,
      ref: 'ref_77',
      taskSessionId: 'w4b-stale-run-owned',
      nonInterferencePolicy: 'strict',
    });
    expect(strictClickResult.isError).toBe(true);
    const strictClickPayload = JSON.parse(String(strictClickResult.content[0].text));
    expect(strictClickPayload.runtimePolicyAudit).toMatchObject({
      verdict: 'block',
      reason: 'non_run_owned_tab',
      runOwnedTabIds: [],
    });
  });

  it('releases run-owned tab ids reported as closed by cleanup', async () => {
    markBridgeReady();
    jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({ status: 'success', items: [] } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: JSON.stringify({ tabId: 88 }) }],
          isError: false,
        },
      } as never)
      .mockResolvedValueOnce({ status: 'success', items: [] } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                closedTabIds: [88],
                invalidTabIds: [],
              }),
            },
          ],
          isError: false,
        },
      } as never)
      .mockResolvedValueOnce({ status: 'success', items: [] } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: JSON.stringify({ tabId: 99 }) }],
          isError: false,
        },
      } as never);

    await handleToolCall('chrome_navigate', {
      url: 'https://example.test/run-owned',
      taskSessionId: 'w4b-closed-run-owned',
    });
    const cleanupResult = await handleToolCall('chrome_close_tabs', {
      tabIds: [88],
      taskSessionId: 'w4b-closed-run-owned',
    });

    expect(cleanupResult.isError).toBe(false);

    const nextNavigateResult = await handleToolCall('chrome_navigate', {
      url: 'https://example.test/next',
      taskSessionId: 'w4b-closed-run-owned',
    });
    const nextNavigatePayload = JSON.parse(String(nextNavigateResult.content[0].text));
    expect(nextNavigatePayload.runtimePolicyAudit).toMatchObject({
      verdict: 'allow',
      reason: 'new_run_owned_tab',
      runOwnedTabIds: [],
    });
    expect(bridgeRuntimeState.getSnapshot().benchmarkOwnedTabCount).toBe(1);
  });

  it('blocks strict impact actions on explicit tabs not owned by the task', async () => {
    markBridgeReady();
    const bridgeSpy = jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({ status: 'success', items: [] } as never);

    const result = await handleToolCall('chrome_keyboard', {
      tabId: 55,
      keys: 'Enter',
      taskSessionId: 'w4b-strict',
      nonInterferencePolicy: 'strict',
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.content[0].text));
    expect(payload.runtimePolicyAudit).toMatchObject({
      mode: 'strict',
      verdict: 'block',
      reason: 'non_run_owned_tab',
      targetTabId: 55,
    });
    expect(bridgeSpy).toHaveBeenCalledTimes(1);
  });

  it('returns collaboration_required preflight without calling the extension', async () => {
    markBridgeReady();
    const bridgeSpy = jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({ status: 'success', items: [] } as never);

    const result = await handleToolCall('chrome_click_element', {
      ref: 'ref_login',
      taskSessionId: 'w5a-collaboration',
      runtimePolicy: { desiredExecutionMode: 'collaboration' },
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.content[0].text));
    expect(payload).toMatchObject({
      ok: false,
      code: 'TABRIX_ACTION_COLLABORATION_REQUIRED',
      actionPreflight: {
        verdict: 'collaboration_required',
        reason: 'collaboration_requested',
      },
      runtimePolicyAudit: {
        verdict: 'collaboration_required',
        reason: 'collaboration_requested',
      },
    });
    expect(bridgeSpy).toHaveBeenCalledTimes(1);
  });

  it('allows non-sensitive tools when MCP_DISABLE_SENSITIVE_TOOLS is set', async () => {
    markBridgeReady();
    process.env.MCP_DISABLE_SENSITIVE_TOOLS = 'true';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 1 });

    expect(result.isError).toBe(false);
  });

  it('denies P3 opt-in tools by default Tabrix policy with TABRIX_POLICY_DENIED_P3', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
      status: 'success',
      items: [],
    } as never);

    const result = await handleToolCall('chrome_javascript', { code: 'noop()' });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.content[0].text));
    expect(payload).toMatchObject({
      code: 'TABRIX_POLICY_DENIED_P3',
      riskTier: 'P3',
      requiresExplicitOptIn: true,
    });
    expect(payload.hint).toContain('TABRIX_POLICY_ALLOW_P3');

    const sessions = sessionManager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('failed');
    expect(sessions[0].steps[0].errorCode).toBe('policy_denied_p3');
  });

  it('allows P3 opt-in tools when TABRIX_POLICY_ALLOW_P3=all', async () => {
    markBridgeReady();
    process.env.TABRIX_POLICY_ALLOW_P3 = 'all';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_javascript', { code: 'noop()' });

    expect(result.isError).toBe(false);
  });

  it('allows a specific P3 tool when listed in TABRIX_POLICY_ALLOW_P3', async () => {
    markBridgeReady();
    process.env.TABRIX_POLICY_ALLOW_P3 = 'chrome_javascript';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_javascript', { code: 'noop()' });

    expect(result.isError).toBe(false);
  });

  it('still denies other P3 tools when TABRIX_POLICY_ALLOW_P3 is narrow', async () => {
    markBridgeReady();
    process.env.TABRIX_POLICY_ALLOW_P3 = 'chrome_javascript';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
      status: 'success',
      items: [],
    } as never);

    const result = await handleToolCall('chrome_computer', { action: 'screenshot' });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.content[0].text));
    expect(payload.code).toBe('TABRIX_POLICY_DENIED_P3');
  });

  describe('experience_suggest_plan does not pollute Experience (B-013 P1 regression)', () => {
    // Stub out the dynamic-flow-list extension call only — the native
    // handler short-circuits the actual tool invocation, so we never
    // need bridge readiness for the experience_suggest_plan call itself.
    const stubDynamicFlowList = () => {
      jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
        status: 'success',
        items: [],
      } as never);
    };

    it('a successful suggest call leaves experience_action_paths empty and marks the session aggregated', async () => {
      stubDynamicFlowList();

      const result = await handleToolCall('experience_suggest_plan', { intent: 'open issues' });
      expect(result.isError).toBe(false);
      const body = JSON.parse(String(result.content[0].text));
      expect(body.status).toBe('no_match');
      expect(body.plans).toEqual([]);

      // Memory audit-trail is preserved.
      const sessions = sessionManager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe('completed');
      expect(sessions[0].steps).toHaveLength(1);
      expect(sessions[0].steps[0].toolName).toBe('experience_suggest_plan');

      const experience = sessionManager.experience;
      expect(experience).not.toBeNull();
      // No bucket for the meaningful intent the caller asked about.
      expect(experience!.suggestActionPaths({ intentSignature: 'open issues', limit: 5 })).toEqual(
        [],
      );
      // No self-pollution bucket either (the task-intent string the
      // wrapper synthesizes for every tool call).
      expect(
        experience!.suggestActionPaths({
          intentSignature: 'run mcp tool experience_suggest_plan',
          limit: 5,
        }),
      ).toEqual([]);

      // Replaying the aggregator must be a no-op — i.e. the skipped
      // session was actually marked, not stuck in pending.
      const replay = await handleToolCall('experience_suggest_plan', { intent: 'open issues' });
      expect(replay.isError).toBe(false);
      expect(
        experience!.suggestActionPaths({
          intentSignature: 'run mcp tool experience_suggest_plan',
          limit: 5,
        }),
      ).toEqual([]);
    });

    it('a bad-input suggest call also does not pollute Experience', async () => {
      stubDynamicFlowList();

      const result = await handleToolCall('experience_suggest_plan', {} as never);
      expect(result.isError).toBe(true);

      const sessions = sessionManager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe('failed');
      expect(sessions[0].steps[0].toolName).toBe('experience_suggest_plan');

      const experience = sessionManager.experience;
      expect(experience).not.toBeNull();
      expect(
        experience!.suggestActionPaths({
          intentSignature: 'run mcp tool experience_suggest_plan',
          limit: 5,
        }),
      ).toEqual([]);
    });
  });

  it('prefers tool_not_available over policy denial when a P3 tool is disabled by MCP_DISABLE_SENSITIVE_TOOLS', async () => {
    markBridgeReady();
    process.env.MCP_DISABLE_SENSITIVE_TOOLS = 'true';
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValue({
      status: 'success',
      items: [],
    } as never);

    const result = await handleToolCall('chrome_javascript', { code: 'noop()' });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('disabled'),
    });
  });

  // -------------------------------------------------------------------
  // V26-05 (B-028) — Task Session Context + Read Budget integration.
  //
  // After the v2.6 S1 last-mile P1 fix, the gate resolves its task
  // context via `resolveTaskContextKey` instead of `getTaskContext`,
  // so we pin behaviour by pre-populating the auto-keyed registry
  // entry the gate will look up. No `getTaskContext` spy is used.
  // -------------------------------------------------------------------
  describe('V26-05 read-budget gate', () => {
    it('chrome_read_page returns a structured warning without a bridge call when budget is exceeded', async () => {
      markBridgeReady();
      // Pre-populate the same auto-key the gate will resolve for
      // `{ tabId: 1 }` (no explicit task key). Budget = 2 with two
      // reads already noted → the next call is over budget.
      const ctx = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      Object.defineProperty(ctx, 'readBudget', { value: 2, writable: false });
      ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
      ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
      const dynamicFlowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });

      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(String(result.content[0].text));
      expect(payload).toEqual({
        warning: 'read_budget_exceeded',
        readPageCount: 2,
        readBudget: 2,
        suggestedLayer: 'L0+L1',
      });
      // Critical contract: the bridge `call_tool` round-trip MUST NOT
      // happen on a budget-blocked read. The dynamic-flow-list call
      // (mocked above) is the only allowed extension call.
      expect(dynamicFlowSpy).toHaveBeenCalledTimes(1);
      expect(dynamicFlowSpy.mock.calls[0]).toBeDefined();
    });

    it('chrome_navigate URL change unblocks a follow-up read in the same task', async () => {
      markBridgeReady();
      // Prime the context as if a previous read exhausted the page's
      // L0+L1 layer at the OLD URL. The gate now resolves this same
      // context via the auto-key for `tabId: 1`, so the navigate
      // call will hit it and `noteUrlChange` will wipe lastReadLayer.
      const ctx = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      Object.defineProperty(ctx, 'readBudget', { value: 6, writable: false });
      ctx.noteUrlChange('https://old.example/foo', 'role_old');
      ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });

      // chrome_navigate to a new URL — the gate must call
      // `noteUrlChange` so the follow-up read is "first on this page".
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text: 'navigated' }], isError: false },
        } as never);
      await handleToolCall('chrome_navigate', { url: 'https://new.example/bar', tabId: 1 });
      expect(ctx.currentUrl).toBe('https://new.example/bar');
      expect(ctx.lastReadLayer).toBeNull();

      // Follow-up chrome_read_page — bridge call must go through.
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text: 'read' }], isError: false },
        } as never);
      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      expect(result.isError).toBeFalsy();
      // The post-success hook should have advanced readPageCount.
      expect(ctx.readPageCount).toBe(2);
      expect(ctx.lastReadLayer).toBe('L0+L1');
    });
  });

  // -------------------------------------------------------------------
  // v2.6 S1 review fixes (P1-1, P1-2). These tests deliberately do
  // NOT spy on `sessionManager.getTaskContext` — they exercise the
  // real production path the agent walks today: `handleToolCall`
  // mints a fresh internal task per call, but the externally-keyed
  // context registry keeps state alive across calls when the args
  // carry a stable `taskSessionId` (or alias).
  // -------------------------------------------------------------------
  describe('v2.6 S1 P1-1 — externally-keyed task context survives across handleToolCall', () => {
    function mockReadPageRoundTrip(text: string): void {
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text }], isError: false },
        } as never);
    }

    function readPagePayloadWithProjection(input: {
      projectionId: string;
      contextChars: number;
      changedRegions: string[];
      reusedRegions?: string[];
      refreshedRefs?: string[];
      selectedDataSource?: string;
      projectionDataSource?: string;
      pageId?: string;
      tabId?: number;
      extraPayload?: Record<string, unknown>;
    }): string {
      const tabId = input.tabId ?? 1;
      return JSON.stringify({
        kind: 'page',
        mode: 'compact',
        page: {
          url: 'https://example.test/search',
          title: 'Search',
          pageType: 'web_page',
        },
        summary: {
          pageRole: 'search_results',
          primaryRegion: 'results',
        },
        interactiveElements: [],
        ...(input.extraPayload ?? {}),
        selectedDataSource: input.selectedDataSource ?? 'dom_json',
        decisionReason:
          typeof input.extraPayload?.decisionReason === 'string'
            ? input.extraPayload.decisionReason
            : 'read_page_snapshot',
        pageProjection: {
          projectionId: input.projectionId,
          projectionKind: 'read_snapshot_projection',
          pageId: input.pageId ?? 'page_test',
          tabId,
          ownerType: 'run_owned',
          projectionCreatedAt: '2026-05-18T00:00:00.000Z',
          sourceObservedAt: '2026-05-18T00:00:00.000Z',
          sourceLineage: 'dom',
          regionEvidenceRefs: ['region:viewport'],
          readiness: 'ready',
          stability: 'stable',
          contextVersion: input.projectionId,
          previousContextVersion: null,
          changedByActionId: null,
          changeCause: 'unknown',
          activeRegion: 'viewport',
          changedRegions: input.changedRegions,
          reusedRegions: input.reusedRegions ?? [],
          invalidatedRefs: [],
          refreshedRefs: input.refreshedRefs ?? [],
          chosenDataSource: input.projectionDataSource ?? input.selectedDataSource ?? 'dom_json',
          sourceConfidence: 0.9,
          sourceFreshness: 'fresh',
          contextChars: input.contextChars,
          contextSavedChars: 0,
          userActivityLevel: 'idle',
          interferenceRisk: 'low',
        },
      });
    }

    it('accumulates readPageCount across consecutive chrome_read_page calls sharing taskSessionId', async () => {
      markBridgeReady();
      // Three calls with budget=2 → first two pass through, third
      // is short-circuited by the gate. Real production path:
      // stable `taskSessionId` only, no `getTaskContext` spy.
      const ctx = sessionManager.getOrCreateExternalTaskContext('shared-task');
      // Override the env-resolved budget on the shared context so
      // the test does not have to mutate process.env.
      Object.defineProperty(ctx, 'readBudget', { value: 2, writable: false });

      mockReadPageRoundTrip('first');
      const r1 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'shared-task',
        requestedLayer: 'L0+L1',
      });
      expect(r1.isError).toBeFalsy();

      mockReadPageRoundTrip('second');
      const r2 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'shared-task',
        requestedLayer: 'L0+L1+L2',
      });
      expect(r2.isError).toBeFalsy();

      // Third call: budget exhausted. NO bridge round-trip; only
      // the dynamic-flow listing is allowed. We `mockClear()` the
      // shared spy so the post-call delta cleanly reflects this
      // invocation only — `jest.spyOn` reuses the existing spy and
      // would otherwise carry the call counts from r1/r2.
      const flowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);
      flowSpy.mockClear();
      flowSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const r3 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'shared-task',
        requestedLayer: 'L0+L1+L2',
      });
      expect(r3.isError).toBeFalsy();
      const payload = JSON.parse(String(r3.content[0].text));
      expect(payload).toMatchObject({
        warning: 'read_budget_exceeded',
        readPageCount: 2,
        readBudget: 2,
      });
      // Only the dynamic-flow probe was called for this third
      // invocation — the bridge `call_tool` request never fired.
      expect(flowSpy).toHaveBeenCalledTimes(1);

      // External registry must reflect the two real reads exactly.
      const persisted = sessionManager.peekExternalTaskContext('shared-task');
      expect(persisted).toBe(ctx);
      expect(persisted!.readPageCount).toBe(2);
    });

    it('attaches AI-facing projection delta across consecutive chrome_read_page calls', async () => {
      markBridgeReady();
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text: 'navigated' }], isError: false },
        } as never);
      await handleToolCall('chrome_navigate', {
        tabId: 1,
        taskSessionId: 'delta-task',
        url: 'https://example.test/search',
      });

      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_initial',
          contextChars: 12000,
          changedRegions: ['viewport'],
        }),
      );
      const r1 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'delta-task',
        requestedLayer: 'L0+L1',
      });
      const firstPayload = JSON.parse(String(r1.content[0].text));
      expect(firstPayload.deltaContext).toMatchObject({
        deltaKind: 'initial_overview',
        fromProjectionId: null,
        toProjectionId: 'projection_initial',
        contextSavedChars: 0,
      });
      expect(firstPayload.deltaContext.evidenceBoundary).toMatchObject({
        evidenceLevel: 'integration',
        realBrowserClaim: false,
      });
      expect(firstPayload.aiContextEnvelope).toMatchObject({
        envelopeKind: 'delta_context',
        selectedDataSource: 'dom_json',
        dataSourceDecision: {
          availableSources: ['dom_json'],
          selectedSource: 'dom_json',
          selectedReason: 'read_page_snapshot',
          rejectedSources: [],
          regionCorrelation: 1,
          privacySafety: 'redacted',
          metadataCompleteness: null,
          sourceConfidence: 0.9,
          sourceFreshness: 'fresh',
          fallbackReason: null,
        },
        taskState: {
          state: 'ready',
          reason: 'page_projection_ready_and_stable',
          recommendedNextAction: 'continue_read',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_post',
          contextChars: 3200,
          changedRegions: ['search_results'],
          reusedRegions: ['global_nav'],
          refreshedRefs: ['ref_result_1'],
        }),
      );
      const r2 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'delta-task',
        requestedLayer: 'L0+L1+L2',
      });
      const secondPayload = JSON.parse(String(r2.content[0].text));
      expect(secondPayload.deltaContext).toMatchObject({
        deltaKind: 'post_action_delta',
        fromProjectionId: 'projection_initial',
        toProjectionId: 'projection_post',
        changedRegions: ['search_results'],
        reusedRegions: ['global_nav'],
        refreshedRefs: ['ref_result_1'],
        contextChars: 3200,
        previousContextChars: 12000,
        contextSavedChars: 8800,
      });
      expect(secondPayload.aiContextEnvelope).toMatchObject({
        contextSource: 'page_projection_delta',
        taskState: {
          state: 'ready',
          recommendedNextAction: 'continue_read',
        },
        selectedDataSource: 'dom_json',
      });
      expect(
        secondPayload.aiContextEnvelope.lifecycleTimeline.map(
          (event: { kind: string }) => event.kind,
        ),
      ).toEqual([
        'navigation',
        'readiness_observed',
        'projection_created',
        'region_changed',
        'delta_created',
        'readiness_observed',
        'projection_created',
        'region_changed',
        'refs_refreshed',
        'delta_created',
      ]);
      expect(secondPayload.aiContextEnvelope.lifecycleTimeline[0]).toMatchObject({
        kind: 'navigation',
        url: 'https://example.test/search',
      });

      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, closedTabIds: [1] }),
              },
            ],
            isError: false,
          },
        } as never);
      const closeResult = await handleToolCall('chrome_close_tabs', {
        taskSessionId: 'delta-task',
        tabIds: [1],
      });
      const closePayload = JSON.parse(String(closeResult.content[0].text));
      expect(
        closePayload.lifecycleTimeline.map((event: { kind: string }) => event.kind).at(-1),
      ).toBe('cleanup');
      expect(closePayload.lifecycleTimeline.at(-1)).toMatchObject({
        cleanupAction: 'chrome_close_tabs',
        cleanupTargetIds: [1],
      });
    });

    it('returns cached AI-facing context for redundant same-layer reads without a bridge read', async () => {
      markBridgeReady();

      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_cached',
          contextChars: 3600,
          changedRegions: ['viewport'],
          refreshedRefs: ['ref_cached'],
          pageId: 'tab:7',
          tabId: 7,
        }),
      );
      const first = await handleToolCall('chrome_read_page', {
        tabId: 7,
        taskSessionId: 'redundant-delta-task',
        requestedLayer: 'L0+L1',
      });
      const firstPayload = JSON.parse(String(first.content[0].text));
      expect(firstPayload.deltaContext).toMatchObject({
        deltaKind: 'initial_overview',
        toProjectionId: 'projection_cached',
      });

      const flowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);
      flowSpy.mockClear();
      flowSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const second = await handleToolCall('chrome_read_page', {
        tabId: 7,
        taskSessionId: 'redundant-delta-task',
        requestedLayer: 'L0+L1',
      });
      const secondPayload = JSON.parse(String(second.content[0].text));

      expect(secondPayload.warning).toBe('read_redundant');
      expect(secondPayload.pageProjection).toMatchObject({
        projectionId: 'projection_cached',
        tabId: 7,
      });
      expect(secondPayload.deltaContext).toMatchObject({
        deltaKind: 'post_action_delta',
        fromProjectionId: 'projection_cached',
        toProjectionId: 'projection_cached',
        changedRegions: [],
        reusedRegions: ['viewport'],
        refreshedRefs: [],
        contextChars: 0,
        previousContextChars: 3600,
        contextSavedChars: 3600,
        contextSavedRatio: 1,
        evidenceBoundary: {
          evidenceLevel: 'real_browser',
          realBrowserClaim: true,
        },
      });
      expect(secondPayload.aiContextEnvelope).toMatchObject({
        contextSource: 'cached_page_projection_delta',
        taskState: {
          state: 'ready',
          recommendedNextAction: 'continue_read',
        },
        selectedDataSource: 'dom_json',
        dataSourceDecision: {
          selectedSource: 'dom_json',
          selectedReason: 'cached_projection_reused_for_redundant_read',
          privacySafety: 'redacted',
        },
      });
      expect(flowSpy).toHaveBeenCalledTimes(1);
      const persisted = sessionManager.listSessions().at(-1);
      expect(persisted?.summary).toBe(
        'AI context: post_action_delta; state=ready; next=continue_read; source=cached_page_projection_delta; data=dom_json; changed=none; reused=viewport; savedChars=3600',
      );
    });

    it('marks AI-facing delta as real-browser evidence only for real tab projections', async () => {
      markBridgeReady();
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_real_tab',
          contextChars: 4200,
          changedRegions: ['viewport'],
          pageId: 'tab:42',
          tabId: 42,
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 42,
        taskSessionId: 'real-browser-evidence-task',
        requestedLayer: 'L0+L1',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.deltaContext.evidenceBoundary).toMatchObject({
        evidenceLevel: 'real_browser',
        realBrowserClaim: true,
      });
      expect(payload.aiContextEnvelope.deltaContext.evidenceBoundary).toMatchObject({
        evidenceLevel: 'real_browser',
        realBrowserClaim: true,
      });
    });

    it('surfaces data source decision truthfulness for DOM fallback rows', async () => {
      markBridgeReady();
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_dom_rows',
          contextChars: 2400,
          changedRegions: ['result_list'],
          refreshedRefs: ['ref_result_1', 'ref_result_2'],
          selectedDataSource: 'dom_region_rows',
          extraPayload: {
            kind: 'dom_region_rows',
            rowCount: 2,
            visibleRegionRowsUsed: true,
            visibleRegionRowCount: 2,
            targetRefCoverageRate: 1,
            apiRowsUnavailableReason: 'observed_api_rows_not_available',
            decisionReason: 'visible_dom_rows_selected',
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'truthfulness-task',
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload).toMatchObject({
        mode: 'compact',
        page: {
          url: 'https://example.test/search',
          title: 'Search',
          pageType: 'web_page',
        },
        summary: {
          pageRole: 'search_results',
          primaryRegion: 'results',
        },
      });
      expect(Array.isArray(payload.interactiveElements)).toBe(true);
      expect(payload.aiContextEnvelope.dataSourceDecision).toMatchObject({
        availableSources: ['dom_region_rows'],
        selectedSource: 'dom_region_rows',
        selectedReason: 'visible_dom_rows_selected',
        rejectedSources: [{ source: 'api_rows', reason: 'observed_api_rows_not_available' }],
        regionCorrelation: 1,
        taskRelevance: null,
        privacySafety: 'redacted',
        metadataCompleteness: 1,
        sourceFreshness: 'fresh',
        sourceConfidence: 0.9,
        fallbackReason: 'observed_api_rows_not_available',
      });
      expect(payload.aiContextEnvelope.taskState).toMatchObject({
        state: 'ready',
        recommendedNextAction: 'continue_read',
      });
    });

    it('surfaces data source decision truthfulness for live observed API rows', async () => {
      markBridgeReady();
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_api_rows',
          contextChars: 2400,
          changedRegions: ['api_rows'],
          selectedDataSource: 'cdp_enhanced_api_rows',
          projectionDataSource: 'cdp_enhanced_api_rows',
          extraPayload: {
            rowCount: 10,
            metadataCompleteness: 1,
            decisionReason: 'live_observed_current_task_api_data',
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'api-rows-truthfulness-task',
        requestedLayer: 'L0+L1',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.aiContextEnvelope.dataSourceDecision).toMatchObject({
        availableSources: ['cdp_enhanced_api_rows'],
        selectedSource: 'cdp_enhanced_api_rows',
        selectedReason: 'live_observed_current_task_api_data',
        rejectedSources: [],
        regionCorrelation: 1,
        taskRelevance: null,
        privacySafety: 'redacted',
        metadataCompleteness: 1,
        sourceFreshness: 'fresh',
        sourceConfidence: 0.9,
        fallbackReason: null,
      });
    });

    it('preserves markdown reading surface instead of replacing it with DOM rows', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('markdown-long-read');
      ctx.noteVisibleRegionRows({
        sourceDataSource: 'dom_region_rows',
        available: true,
        rowCount: 2,
        confidence: 0.95,
        rows: [
          {
            title: 'Article paragraph 1',
            primaryText: 'Visible row summary one',
            secondaryText: null,
            metaText: null,
            targetRef: 'ref_1',
            visibleTextFields: ['title', 'primaryText'],
            qualityReasons: [],
            source: {
              type: 'high_value_object',
              sourceId: 'hvo_1',
              sourceIndex: 0,
            },
            sourceRegion: 'article_body',
            confidence: 0.95,
          },
          {
            title: 'Article paragraph 2',
            primaryText: 'Visible row summary two',
            secondaryText: null,
            metaText: null,
            targetRef: 'ref_2',
            visibleTextFields: ['title', 'primaryText'],
            qualityReasons: [],
            source: {
              type: 'high_value_object',
              sourceId: 'hvo_2',
              sourceIndex: 1,
            },
            sourceRegion: 'article_body',
            confidence: 0.95,
          },
        ],
        visibleRegionRowsUsed: true,
        visibleRegionRowsRejectedReason: null,
        sourceRegion: 'article_body',
        rowExtractionConfidence: 0.95,
        cardExtractorUsed: false,
        cardPatternConfidence: 0,
        cardRowsCount: 0,
        rowOrder: 'visual_order',
        targetRefCoverageRate: 1,
        regionQualityScore: 0.95,
      });
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_markdown',
          contextChars: 9000,
          changedRegions: ['article_body'],
          selectedDataSource: 'markdown',
          extraPayload: {
            markdown: '# Long Article\n\nFull article body that must not be truncated.',
            decisionReason: 'markdown_reading_surface_preferred',
            visibleRegionRows: {
              sourceDataSource: 'dom_region_rows',
              rows: [
                {
                  title: 'Article paragraph 1',
                  primaryText: 'Visible row summary one',
                  secondaryText: null,
                  metaText: null,
                  targetRef: 'ref_1',
                },
                {
                  title: 'Article paragraph 2',
                  primaryText: 'Visible row summary two',
                  secondaryText: null,
                  metaText: null,
                  targetRef: 'ref_2',
                },
              ],
              rowCount: 2,
              visibleRegionRowsUsed: true,
              visibleRegionRowsRejectedReason: null,
              sourceRegion: 'article_body',
              rowExtractionConfidence: 0.95,
              cardExtractorUsed: false,
              cardPatternConfidence: 0,
              cardRowsCount: 0,
              rowOrder: 'visual_order',
              targetRefCoverageRate: 1,
              regionQualityScore: 0.95,
            },
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'markdown-long-read',
        requestedLayer: 'L0+L1+L2',
        render: 'markdown',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.kind).toBe('page');
      expect(payload.rows).toBeUndefined();
      expect(payload.markdown).toContain('Full article body');
      expect(payload.aiContextEnvelope).toMatchObject({
        selectedDataSource: 'markdown',
        dataSourceDecision: {
          selectedSource: 'markdown',
          selectedReason: 'markdown_reading_surface_preferred',
          rejectedSources: [
            { source: 'api_rows', reason: 'api_rows_unavailable_dom_region_rows_available' },
            { source: 'dom_region_rows', reason: 'markdown_reading_surface_preferred' },
          ],
        },
      });
    });

    it('selects reliable DOM rows for AI context even when markdown is rendered', async () => {
      markBridgeReady();
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_search_rows',
          contextChars: 1200,
          changedRegions: ['viewport'],
          refreshedRefs: ['ref_repo_1', 'ref_repo_2'],
          selectedDataSource: 'markdown',
          extraPayload: {
            markdown: '# Repository search results',
            decisionReason: 'markdown_reading_surface_preferred',
            apiRowsUnavailableReason: 'api_rows_unavailable_dom_region_rows_available',
            visibleRegionRows: {
              sourceDataSource: 'dom_region_rows',
              rows: [
                {
                  title: 'Repo result 1',
                  primaryText: 'Repository result one',
                  secondaryText: null,
                  metaText: null,
                  targetRef: 'ref_repo_1',
                  sourceRegion: 'visible_results',
                  confidence: 0.9,
                },
                {
                  title: 'Repo result 2',
                  primaryText: 'Repository result two',
                  secondaryText: null,
                  metaText: null,
                  targetRef: 'ref_repo_2',
                  sourceRegion: 'visible_results',
                  confidence: 0.9,
                },
              ],
              rowCount: 2,
              visibleRegionRowsUsed: true,
              visibleRegionRowsRejectedReason: null,
              sourceRegion: 'visible_results',
              rowExtractionConfidence: 0.9,
              targetRefCoverageRate: 0.99,
              regionQualityScore: 0.96,
              cardExtractorUsed: false,
              cardPatternConfidence: 0,
              cardRowsCount: 0,
            },
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'search-rows-read',
        requestedLayer: 'L0+L1+L2',
        render: 'markdown',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.markdown).toContain('Repository search results');
      expect(payload.rows).toHaveLength(2);
      expect(payload.visibleRegionRowsUsed).toBe(true);
      expect(payload.aiContextEnvelope).toMatchObject({
        selectedDataSource: 'dom_region_rows',
        dataSourceDecision: {
          selectedSource: 'dom_region_rows',
          selectedReason: 'api_rows_unavailable_dom_region_rows_available',
          rejectedSources: [
            { source: 'api_rows', reason: 'api_rows_unavailable_dom_region_rows_available' },
          ],
        },
      });
    });

    it('does NOT cross-contaminate budgets between distinct taskSessionIds', async () => {
      markBridgeReady();
      const ctxA = sessionManager.getOrCreateExternalTaskContext('task-A');
      const ctxB = sessionManager.getOrCreateExternalTaskContext('task-B');
      Object.defineProperty(ctxA, 'readBudget', { value: 1, writable: false });
      Object.defineProperty(ctxB, 'readBudget', { value: 3, writable: false });

      // Burn task-A's budget.
      mockReadPageRoundTrip('a1');
      await handleToolCall('chrome_read_page', { tabId: 1, taskSessionId: 'task-A' });
      expect(ctxA.readPageCount).toBe(1);

      // task-B must still allow a read (budget intact).
      mockReadPageRoundTrip('b1');
      const rb1 = await handleToolCall('chrome_read_page', {
        tabId: 2,
        taskSessionId: 'task-B',
      });
      expect(rb1.isError).toBeFalsy();
      expect(ctxB.readPageCount).toBe(1);
      expect(ctxA.readPageCount).toBe(1);

      // task-A is now over budget; the gate fires WITHOUT a bridge
      // round-trip even though task-B is healthy. `mockClear` so
      // the post-call assertion reflects this invocation only.
      const flowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);
      flowSpy.mockClear();
      flowSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const ra2 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'task-A',
      });
      const payload = JSON.parse(String(ra2.content[0].text));
      expect(payload.warning).toBe('read_budget_exceeded');
      expect(flowSpy).toHaveBeenCalledTimes(1);
    });

    it('alias precedence: taskSessionId beats taskId beats clientTaskId', async () => {
      markBridgeReady();
      const primary = sessionManager.getOrCreateExternalTaskContext('primary-key');

      // taskSessionId wins over taskId/clientTaskId aliases.
      mockReadPageRoundTrip('p1');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'primary-key',
        taskId: 'should-be-ignored',
        clientTaskId: 'also-ignored',
      });
      expect(primary.readPageCount).toBe(1);
      expect(sessionManager.peekExternalTaskContext('should-be-ignored')).toBeNull();
      expect(sessionManager.peekExternalTaskContext('also-ignored')).toBeNull();

      // taskId is honoured when taskSessionId is absent.
      const fromTaskId = sessionManager.getOrCreateExternalTaskContext('legacy-task');
      mockReadPageRoundTrip('p2');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskId: 'legacy-task',
        clientTaskId: 'still-ignored',
      });
      expect(fromTaskId.readPageCount).toBe(1);
      expect(sessionManager.peekExternalTaskContext('still-ignored')).toBeNull();

      // clientTaskId is the last-resort alias.
      const fromClient = sessionManager.getOrCreateExternalTaskContext('client-side');
      mockReadPageRoundTrip('p3');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        clientTaskId: 'client-side',
      });
      expect(fromClient.readPageCount).toBe(1);
    });

    it('absence of any explicit task key now falls into the per-tab auto context (last-mile fix)', async () => {
      markBridgeReady();
      // After the v2.6 S1 last-mile P1 fix, schema-following clients
      // (which cannot pass `taskSessionId / taskId / clientTaskId`
      // because those names are not in the public chrome_read_page
      // schema) get an auto-derived `mcp:auto:tab:<tabId>` key, so
      // the budget accumulates across calls without any caller
      // co-operation. This test pins that contract.
      //
      // We intentionally vary `requestedLayer` between the two reads
      // so the second call is not short-circuited by the
      // `read_redundant` branch — that is exercised by the dedicated
      // navigate-invalidation test below.
      mockReadPageRoundTrip('auto-1');
      await handleToolCall('chrome_read_page', { tabId: 1, requestedLayer: 'L0+L1' });
      mockReadPageRoundTrip('auto-2');
      await handleToolCall('chrome_read_page', { tabId: 1, requestedLayer: 'L0+L1+L2' });

      const auto = sessionManager.peekExternalTaskContext('mcp:auto:tab:1');
      expect(auto).not.toBeNull();
      expect(auto!.readPageCount).toBe(2);

      // Probes that resemble degenerate / pre-fix keys must remain
      // empty — only the documented auto-key shape materialises.
      for (const probe of ['', 'tabId', '1', 'undefined', 'null']) {
        expect(sessionManager.peekExternalTaskContext(probe)).toBeNull();
      }
    });

    it('whitespace-only / non-string task keys fall through to the auto-key path (defensive)', async () => {
      markBridgeReady();
      mockReadPageRoundTrip('ws-1');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: '   ',
        requestedLayer: 'L0+L1',
      });
      mockReadPageRoundTrip('ws-2');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 42 as never,
        requestedLayer: 'L0+L1+L2',
      });
      // The degenerate key names themselves never materialise; the
      // per-tab auto context absorbs both calls instead.
      expect(sessionManager.peekExternalTaskContext('   ')).toBeNull();
      expect(sessionManager.peekExternalTaskContext('42')).toBeNull();
      const auto = sessionManager.peekExternalTaskContext('mcp:auto:tab:1');
      expect(auto).not.toBeNull();
      expect(auto!.readPageCount).toBe(2);
    });
  });

  describe('v2.6 S1 P1-2 — chrome_read_page reads requestedLayer (not legacy `layer`)', () => {
    function mockReadPageRoundTrip(text: string): void {
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text }], isError: false },
        } as never);
    }

    it('routes requestedLayer=L0+L1+L2 into shouldAllowReadPage / noteReadPage', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('layer-test');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip('layer-1');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'layer-test',
        requestedLayer: 'L0+L1+L2',
      });
      expect(ctx.lastReadLayer).toBe('L0+L1+L2');
      expect(ctx.readPageCount).toBe(1);

      // A second call at the same layer on the same page becomes
      // `read_redundant` and short-circuits — proves the gate
      // received the requested layer (not the buggy default).
      // `mockClear` so the assertion isolates this invocation.
      const flowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);
      flowSpy.mockClear();
      flowSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const r2 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'layer-test',
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(r2.content[0].text));
      expect(payload.warning).toBe('read_redundant');
      expect(flowSpy).toHaveBeenCalledTimes(1);
    });

    it('requestedLayer takes precedence over the legacy `layer` field', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('precedence');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip('precedence');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'precedence',
        requestedLayer: 'L0',
        layer: 'L0+L1+L2',
      });
      // Recorded layer must be the one named by the public schema.
      expect(ctx.lastReadLayer).toBe('L0');
    });

    it('legacy `layer`-only callers still flow through (graceful fallback)', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('legacy-layer');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip('legacy-layer');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'legacy-layer',
        layer: 'L0+L1',
      });
      expect(ctx.lastReadLayer).toBe('L0+L1');
    });

    it('omitting both fields defaults to L0+L1+L2 (matches MCP schema)', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('default-layer');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip('default-layer');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'default-layer',
      });
      expect(ctx.lastReadLayer).toBe('L0+L1+L2');
    });

    it('invalid layer string is ignored and falls back to the schema default', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('invalid-layer');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip('invalid-layer');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'invalid-layer',
        requestedLayer: 'NOT_A_REAL_LAYER',
      });
      expect(ctx.lastReadLayer).toBe('L0+L1+L2');
    });
  });

  // -------------------------------------------------------------------
  // v2.6 S1 last-mile P1 fix — auto-derived task-context key for
  // schema-following MCP clients. These tests deliberately do NOT
  // pass `taskSessionId` and they do NOT spy on
  // `sessionManager.getTaskContext`; they exercise the production
  // path that a default Claude Desktop / Cursor / Cline client walks.
  // -------------------------------------------------------------------
  describe('v2.6 S1 last-mile — read budget on the default MCP path (no taskSessionId)', () => {
    function mockReadPageRoundTrip(text: string): void {
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text }], isError: false },
        } as never);
    }

    function mockNavigateRoundTrip(text: string, returnedTabId?: number): void {
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text:
                  typeof returnedTabId === 'number'
                    ? JSON.stringify({ ok: true, tabId: returnedTabId, summary: text })
                    : text,
              },
            ],
            isError: false,
          },
        } as never);
    }

    it('accumulates read budget across consecutive default-shape chrome_read_page calls on the same tab', async () => {
      markBridgeReady();
      // Pre-create the auto-key context with a tight budget so the
      // gate fires deterministically without polluting process.env.
      // The auto key shape is documented as `mcp:auto:tab:<tabId>`.
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:7');
      Object.defineProperty(auto, 'readBudget', { value: 2, writable: false });

      // Vary `requestedLayer` between the two healthy calls so the
      // second is not short-circuited by `read_redundant`. The
      // budget gate (count vs readBudget) is independent of layer
      // and is what we assert below.
      mockReadPageRoundTrip('first');
      const r1 = await handleToolCall('chrome_read_page', {
        tabId: 7,
        requestedLayer: 'L0+L1',
      });
      expect(r1.isError).toBeFalsy();
      expect(auto.readPageCount).toBe(1);

      mockReadPageRoundTrip('second');
      const r2 = await handleToolCall('chrome_read_page', {
        tabId: 7,
        requestedLayer: 'L0+L1+L2',
      });
      expect(r2.isError).toBeFalsy();
      expect(auto.readPageCount).toBe(2);

      // Third call must short-circuit on read_budget_exceeded WITHOUT
      // a bridge round-trip. The dynamic-flow probe is the only call
      // we expect to fire on this third invocation.
      const flowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);
      flowSpy.mockClear();
      flowSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const r3 = await handleToolCall('chrome_read_page', {
        tabId: 7,
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(r3.content[0].text));
      expect(payload).toMatchObject({
        warning: 'read_budget_exceeded',
        readPageCount: 2,
        readBudget: 2,
      });
      expect(flowSpy).toHaveBeenCalledTimes(1);
    });

    it('chrome_navigate on the same tab invalidates redundancy state for the next default-shape read', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:9');
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      // First default-shape read on tab 9 establishes lastReadLayer.
      mockReadPageRoundTrip('before-nav');
      await handleToolCall('chrome_read_page', { tabId: 9, requestedLayer: 'L0+L1' });
      expect(auto.lastReadLayer).toBe('L0+L1');
      expect(auto.currentUrl).toBeNull();

      // Default-shape navigate on tab 9 must hit the SAME auto
      // context (so noteUrlChange wipes lastReadLayer / targetRefs).
      mockNavigateRoundTrip('navigated', 9);
      await handleToolCall('chrome_navigate', { tabId: 9, url: 'https://new.example/page' });
      expect(auto.currentUrl).toBe('https://new.example/page');
      expect(auto.lastReadLayer).toBeNull();

      // Follow-up default-shape read must NOT be flagged
      // read_redundant — the gate sees a fresh page.
      mockReadPageRoundTrip('after-nav');
      const r3 = await handleToolCall('chrome_read_page', {
        tabId: 9,
        requestedLayer: 'L0+L1',
      });
      expect(r3.isError).toBeFalsy();
      // The post-success hook records the new read on the new page.
      expect(auto.lastReadLayer).toBe('L0+L1');
      expect(auto.readPageCount).toBe(2);
    });

    it('page interactions invalidate redundancy state for the next read on the same task', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('interaction-task');
      ctx.noteRunOwnedTab(9);
      Object.defineProperty(ctx, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip('before-keyboard');
      await handleToolCall('chrome_read_page', {
        tabId: 9,
        taskSessionId: 'interaction-task',
        requestedLayer: 'L0+L1',
      });
      expect(ctx.lastReadLayer).toBe('L0+L1');

      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text: 'paged' }], isError: false },
        } as never);
      await handleToolCall('chrome_keyboard', {
        tabId: 9,
        keys: 'PageDown',
        taskSessionId: 'interaction-task',
      });
      expect(ctx.lastReadLayer).toBeNull();

      mockReadPageRoundTrip('after-keyboard');
      const result = await handleToolCall('chrome_read_page', {
        tabId: 9,
        taskSessionId: 'interaction-task',
        requestedLayer: 'L0+L1',
      });
      expect(String(result.content[0].text)).toBe('after-keyboard');
      expect(result.isError).toBeFalsy();
      expect(ctx.lastReadLayer).toBe('L0+L1');
      expect(ctx.readPageCount).toBe(2);
    });

    it('different tabIds do NOT share redundant state on the default MCP path', async () => {
      markBridgeReady();
      const tab1 = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      const tab2 = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:2');
      Object.defineProperty(tab1, 'readBudget', { value: 5, writable: false });
      Object.defineProperty(tab2, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip('tab1-1');
      await handleToolCall('chrome_read_page', { tabId: 1, requestedLayer: 'L0+L1+L2' });
      expect(tab1.lastReadLayer).toBe('L0+L1+L2');
      expect(tab2.lastReadLayer).toBeNull();

      // Same layer on tab 2 must NOT produce read_redundant — that
      // would only happen if both tabs shared the same context.
      // We assert by observing readPageCount: a redundant
      // short-circuit skips `noteReadPage`, leaving count at 0.
      mockReadPageRoundTrip('tab2-1');
      const r2 = await handleToolCall('chrome_read_page', {
        tabId: 2,
        requestedLayer: 'L0+L1+L2',
      });
      expect(r2.isError).toBeFalsy();
      expect(tab2.readPageCount).toBe(1);
      expect(tab2.lastReadLayer).toBe('L0+L1+L2');
      // tab 1's state is untouched.
      expect(tab1.readPageCount).toBe(1);
    });

    it('explicit taskSessionId still beats the auto-derived per-tab key', async () => {
      markBridgeReady();
      const explicit = sessionManager.getOrCreateExternalTaskContext('explicit-task');
      Object.defineProperty(explicit, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip('explicit-1');
      await handleToolCall('chrome_read_page', {
        tabId: 5,
        taskSessionId: 'explicit-task',
        requestedLayer: 'L0+L1',
      });

      // The auto key for tab 5 must NOT have been created — explicit
      // wins. Only the explicit context recorded a read.
      expect(explicit.readPageCount).toBe(1);
      expect(sessionManager.peekExternalTaskContext('mcp:auto:tab:5')).toBeNull();
    });

    it('omitted tabId falls back to the default key and still accumulates across calls', async () => {
      markBridgeReady();
      const fallback = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:default');
      Object.defineProperty(fallback, 'readBudget', { value: 5, writable: false });

      // Vary the layer so the second call is not short-circuited
      // by `read_redundant` on a stable URL.
      mockReadPageRoundTrip('default-1');
      await handleToolCall('chrome_read_page', { requestedLayer: 'L0+L1' });
      mockReadPageRoundTrip('default-2');
      await handleToolCall('chrome_read_page', { requestedLayer: 'L0+L1+L2' });

      expect(fallback.readPageCount).toBe(2);
    });

    it('auto-keying does NOT fire for non-budgeted tools (e.g. chrome_click_element)', async () => {
      markBridgeReady();
      // A click on tab 1 must not pre-create an auto context, since
      // click never visits the budget gate or the URL invalidator.
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text: 'clicked' }], isError: false },
        } as never);
      await handleToolCall('chrome_click_element', { tabId: 1, ref: 'ref_42' });

      expect(sessionManager.peekExternalTaskContext('mcp:auto:tab:1')).toBeNull();
      expect(sessionManager.peekExternalTaskContext('mcp:auto:tab:default')).toBeNull();
    });
  });
});
