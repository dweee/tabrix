import nativeMessagingHostInstance from '../native-messaging-host';
import { handleToolCall } from './register-tools';
import { sessionManager } from '../execution/session-manager';
import { bridgeRuntimeState } from '../server/bridge-state';
import { bridgeCommandChannel } from '../server/bridge-command-channel';
import { resetDefaultPrimaryTabController } from '../runtime/primary-tab-controller';
import {
  getLifecycleEvidenceArtifactStoreSnapshot,
  listLifecycleEvidenceArtifacts,
  resetLifecycleEvidenceArtifactStoreForTests,
} from '../runtime/lifecycle-evidence-artifact-store';

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
    resetLifecycleEvidenceArtifactStoreForTests();
    sessionManager.reset();
    delete process.env.ENABLE_MCP_TOOLS;
    delete process.env.DISABLE_MCP_TOOLS;
    delete process.env.MCP_DISABLE_SENSITIVE_TOOLS;
    delete process.env.TABRIX_POLICY_ALLOW_P3;
    delete process.env.TABRIX_POLICY_CAPABILITIES;
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
    const traces = sessionManager.memoryTraces!.listByTask(sessions[0].taskId);
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      toolName: 'chrome_read_page',
      toolCallId: sessions[0].steps[0].stepId,
      sequenceIndex: 1,
      tabId: 1,
      toolSuccess: true,
      businessSuccess: 'unknown',
      redactionState: 'redacted',
    });
  });

  it('uses _tabrix intent metadata for Memory trace titles and result trace envelopes', async () => {
    markBridgeReady();
    const bridgeSpy = jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({
        status: 'success',
        items: [],
      } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: JSON.stringify({ message: 'page read' }) }],
          isError: false,
        },
      } as never);

    const result = await handleToolCall('chrome_read_page', {
      tabId: 1,
      _tabrix: {
        intentTitle: '读取搜索结果',
        intentSummary: '读取当前页面内容用于汇总',
        nextIntent: '筛选收藏最多内容',
        ignoredFutureField: 'kept additive',
      },
    });
    const payload = JSON.parse(String(result.content[0].text));

    expect(payload._tabrix).toMatchObject({
      intentTitle: '读取搜索结果',
      intentSummary: '读取当前页面内容用于汇总',
      nextIntent: '筛选收藏最多内容',
      toolName: 'chrome_read_page',
      toolSuccess: true,
      businessStatus: 'unknown',
      businessFeedbackRequired: true,
      businessFeedbackGuideVersion: 'tabrix-ai-business-feedback-v1',
    });
    expect(payload._tabrix.businessFeedbackScoreGuide).toContain('0.90-1.00');
    expect(payload._tabrix.businessFeedbackScoreGuide).toContain(
      'clear page evidence and intent achieved',
    );
    expect(payload._tabrix.businessFeedbackScoreGuide).toContain(
      'partial progress, needs follow-up read/confirmation',
    );
    expect(payload._tabrix.traceId).toEqual(expect.any(String));
    expect((bridgeSpy.mock.calls[1][0] as any).args).toEqual({ tabId: 1 });

    const sessions = sessionManager.listSessions();
    const traces = sessionManager.memoryTraces!.listByTask(sessions[0].taskId);
    expect(traces[0]).toMatchObject({
      taskIntent: '读取搜索结果',
      toolName: 'chrome_read_page',
      requestParams: { tabId: 1 },
    });
  });

  it('returns the tool result before async Browser Object trace projection runs', async () => {
    markBridgeReady();
    jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({
        status: 'success',
        items: [],
      } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                page: { url: 'https://example.test/workspaces/123' },
                summary: { pageRole: 'workspace' },
                tabId: 1,
                pageRegions: [{ regionId: 'main', regionType: 'content' }],
              }),
            },
          ],
          isError: false,
        },
      } as never);
    const traceWriter = sessionManager.memoryTraces;
    if (!traceWriter) throw new Error('MKE trace service is not available in tests');
    const objectProjectionSpy = jest.spyOn(
      traceWriter as unknown as {
        recordBrowserObjectsFromToolResult(input: unknown): void;
      },
      'recordBrowserObjectsFromToolResult',
    );

    const result = await handleToolCall('chrome_read_page', {
      tabId: 1,
      _tabrix: { intentTitle: '读取页面对象' },
    });
    const payload = JSON.parse(String(result.content[0].text));

    expect(payload._tabrix.traceId).toEqual(expect.any(String));
    expect(objectProjectionSpy).not.toHaveBeenCalled();

    await traceWriter.flushAsyncWrites();

    expect(objectProjectionSpy).toHaveBeenCalledTimes(1);
  });

  it('applies _tabrix previousFeedback to an earlier Memory trace on the next tool call', async () => {
    markBridgeReady();
    jest
      .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
      .mockResolvedValueOnce({
        status: 'success',
        items: [],
      } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: JSON.stringify({ message: 'opened' }) }],
          isError: false,
        },
      } as never)
      .mockResolvedValueOnce({
        status: 'success',
        items: [],
      } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          content: [{ type: 'text', text: JSON.stringify({ message: 'next read' }) }],
          isError: false,
        },
      } as never);

    const first = await handleToolCall('chrome_read_page', {
      tabId: 1,
      _tabrix: { intentTitle: '打开发布页' },
    });
    const firstPayload = JSON.parse(String(first.content[0].text));
    const traceId = firstPayload._tabrix.traceId as string;
    const feedbackTarget = firstPayload._tabrix.feedbackTarget;

    await handleToolCall('chrome_read_page', {
      tabId: 1,
      _tabrix: {
        intentTitle: '读取发布状态',
        previousFeedback: [
          {
            traceId,
            taskId: feedbackTarget.taskId,
            toolName: feedbackTarget.toolName,
            toolCallId: feedbackTarget.toolCallId,
            sequenceIndex: feedbackTarget.sequenceIndex,
            traceBindingHash: feedbackTarget.traceBindingHash,
            businessStatus: 'achieved',
            confidence: 0.85,
            reasonCode: 'target_page_opened',
            summary: '目标页面已打开',
            ignoredFutureField: 'safe additive',
          },
        ],
      },
    });

    const updated = sessionManager.memoryTraces!.get(traceId);
    expect(updated).toMatchObject({
      traceId,
      businessSuccess: 'unknown',
      aiFeedbackScore: 0.85,
      aiFeedback: {
        businessStatus: 'achieved',
        confidence: 0.85,
        reasonCode: 'target_page_opened',
        summary: '目标页面已打开',
        sourceToolName: 'chrome_read_page',
      },
    });
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

  it('does not expose retired historyRef artifacts for chrome_read_page', async () => {
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
    expect(body.historyRef).toBeUndefined();

    const sessions = sessionManager.listSessions();
    const step = sessions[0].steps[0];
    expect(step.artifactRefs).toEqual([]);
  });

  it('fails chrome_read_page when returned tab-bound evidence mismatches explicit tabId', async () => {
    markBridgeReady();
    const readPageBody = {
      mode: 'compact',
      tabId: 2,
      page: {
        url: 'https://example.com/wrong-tab',
        title: 'Wrong tab',
        pageType: 'web_page',
      },
      pageProjection: {
        tabId: 2,
      },
      ownershipRuntime: {
        currentTabId: 2,
      },
      artifactRefs: [{ kind: 'dom_snapshot', ref: 'artifact://read_page/tab-2/normal' }],
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

    expect(result.isError).toBe(true);
    const body = JSON.parse(String((result.content as any[])[0].text));
    expect(body).toMatchObject({
      code: 'TABRIX_READ_PAGE_TARGET_MISMATCH',
      targetBinding: {
        verdict: 'mismatch',
        requestedTabId: 1,
        observedTabIds: [2],
      },
    });
    expect(sessionManager.listSessions()[0].steps[0]).toMatchObject({
      status: 'failed',
      errorCode: 'read_page_target_mismatch',
    });
  });

  it('emits a lifecycle artifact for a failed page-unreadable read result', async () => {
    markBridgeReady();
    const failedReadBody = {
      success: false,
      reason: 'page_unreadable',
      pageType: 'browser_error_page',
      pageContent: 'PRIVATE_PAGE_BODY_SHOULD_NOT_APPEAR',
      Authorization: 'Bearer secret-token',
    };
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: JSON.stringify(failedReadBody) }],
        isError: true,
      },
    } as never);

    expect(getLifecycleEvidenceArtifactStoreSnapshot().bufferedArtifacts).toBe(0);

    const result = await handleToolCall('chrome_read_page', { tabId: 42 });

    expect(result.isError).toBe(true);
    expect(getLifecycleEvidenceArtifactStoreSnapshot()).toMatchObject({
      bufferedArtifacts: 1,
      lastFinalVerdict: 'task_failed',
    });
    const artifacts = listLifecycleEvidenceArtifacts();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      scenarioClass: 'postcondition_failure_v1',
      signalSequence: {
        available: true,
        totalSignals: 1,
        signalsByKind: { error_page_detected: 1 },
      },
      actionLog: { available: true, totalActions: 1, failed: 1 },
      finalVerdict: { verdict: 'task_failed', reason: 'postcondition_failed' },
    });
    expect(artifacts[0].signalSequence.signals[0]).toMatchObject({
      kind: 'error_page_detected',
      confidence: 0.9,
      tabId: 42,
      sourceOrigins: ['runtime_inference'],
    });
    expect(artifacts[0].actionLog.entries[0]).toMatchObject({
      actionKind: 'read',
      tabId: 42,
      verdict: 'failed',
      reason: 'page_unreadable',
    });
    const serializedArtifact = JSON.stringify(artifacts[0]);
    expect(serializedArtifact).not.toContain('PRIVATE_PAGE_BODY_SHOULD_NOT_APPEAR');
    expect(serializedArtifact).not.toContain('secret-token');
    expect(serializedArtifact).not.toContain('Authorization');
    expect(serializedArtifact).not.toContain('sourcePayload');
  });

  it('emits a lifecycle artifact when a failed read payload is not marked as an MCP transport error', async () => {
    markBridgeReady();
    const failedReadBody = {
      success: false,
      reason: 'page_unreadable',
      pageType: 'browser_error_page',
      historyRef: 'memory://snapshot/public-ref',
      pageContent: 'PRIVATE_PAGE_BODY_SHOULD_NOT_APPEAR',
      Authorization: 'Bearer secret-token',
    };
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: JSON.stringify(failedReadBody) }],
        isError: false,
      },
    } as never);

    expect(getLifecycleEvidenceArtifactStoreSnapshot().bufferedArtifacts).toBe(0);

    const result = await handleToolCall('chrome_read_page', { tabId: 43 });

    expect(result.isError).toBe(false);
    const returnedBody = JSON.parse(String((result.content as any[])[0].text));
    expect(returnedBody).toMatchObject({
      success: false,
      reason: 'page_unreadable',
      pageType: 'browser_error_page',
      pageContent: 'PRIVATE_PAGE_BODY_SHOULD_NOT_APPEAR',
    });
    expect(returnedBody.historyRef).toBeUndefined();
    expect(returnedBody.lifecycleEvidenceArtifacts).toBeUndefined();
    expect(getLifecycleEvidenceArtifactStoreSnapshot()).toMatchObject({
      bufferedArtifacts: 1,
      lastFinalVerdict: 'task_failed',
    });
    const artifacts = listLifecycleEvidenceArtifacts();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      scenarioClass: 'postcondition_failure_v1',
      signalSequence: {
        available: true,
        totalSignals: 1,
        signalsByKind: { error_page_detected: 1 },
      },
      actionLog: { available: true, totalActions: 1, failed: 1 },
      finalVerdict: { verdict: 'task_failed', reason: 'postcondition_failed' },
    });
    expect(artifacts[0].signalSequence.signals[0]).toMatchObject({
      kind: 'error_page_detected',
      confidence: 0.9,
      tabId: 43,
      sourceOrigins: ['runtime_inference'],
    });
    expect(artifacts[0].actionLog.entries[0]).toMatchObject({
      actionKind: 'read',
      tabId: 43,
      verdict: 'failed',
      reason: 'page_unreadable',
    });
    const serializedArtifact = JSON.stringify(artifacts[0]);
    expect(serializedArtifact).not.toContain('PRIVATE_PAGE_BODY_SHOULD_NOT_APPEAR');
    expect(serializedArtifact).not.toContain('secret-token');
    expect(serializedArtifact).not.toContain('Authorization');
    expect(serializedArtifact).not.toContain('sourcePayload');
  });

  it('does not emit error_page_detected for non-browser-error read failures', async () => {
    markBridgeReady();
    const failedReadBody = {
      success: false,
      reason: 'page_unreadable',
      pageType: 'normal_page',
      pageContent: 'PRIVATE_PAGE_BODY_SHOULD_NOT_APPEAR',
      Authorization: 'Bearer secret-token',
    };
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: JSON.stringify(failedReadBody) }],
        isError: true,
      },
    } as never);

    const result = await handleToolCall('chrome_read_page', { tabId: 44 });

    expect(result.isError).toBe(true);
    expect(getLifecycleEvidenceArtifactStoreSnapshot().bufferedArtifacts).toBe(0);
    expect(listLifecycleEvidenceArtifacts()).toHaveLength(0);
  });

  it('does not expose retired memory_actions historyRef for chrome_click_element', async () => {
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
    expect(body.historyRef).toBeUndefined();

    const sessions = sessionManager.listSessions();
    const step = sessions[0].steps[0];
    expect(step.artifactRefs).toEqual([]);
  });

  it('normalizes legacy text chrome_click_element results as unproven structured outcomes', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: 'clicked' }],
        isError: false,
      },
    } as never);

    const result = await handleToolCall('chrome_click_element', { tabId: 1, ref: 'e-1' });

    expect(result.isError).toBe(false);
    const body = JSON.parse(String((result.content as any[])[0].text));
    expect(body).toMatchObject({
      success: false,
      dispatchSucceeded: true,
      observedOutcome: 'verification_unavailable',
      resultShape: 'legacy_text_normalized',
      rawTextLength: 7,
      actionEvidenceResult: {
        actionKind: 'click',
        tabId: 1,
        toolSuccess: true,
        targetBinding: {
          requestedTargetRef: 'e-1',
          targetBindingProven: false,
        },
        dispatch: {
          dispatched: true,
          acceptedByBrowser: true,
        },
        business: {
          businessSuccessVerdict: 'not_proven',
          businessSuccessProven: false,
          nextRequiredCheck: 'fresh_read_page',
        },
        postAction: {
          postActionReadbackStatus: 'required',
          freshReadRequired: true,
        },
      },
    });
    expect(body.message).toContain('post-action state is not proven');
    expect(JSON.stringify(body)).not.toContain('clicked');
  });

  it('normalizes legacy text chrome_click_element errors without claiming dispatch success', async () => {
    markBridgeReady();
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      items: [],
    } as never);
    jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait').mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: 'Element ref not found' }],
        isError: true,
      },
    } as never);

    const result = await handleToolCall('chrome_click_element', { tabId: 1, ref: 'missing-ref' });

    expect(result.isError).toBe(true);
    const body = JSON.parse(String((result.content as any[])[0].text));
    expect(body).toMatchObject({
      success: false,
      dispatchSucceeded: false,
      observedOutcome: 'no_observed_change',
      resultShape: 'legacy_text_error_normalized',
      rawTextLength: 21,
      actionEvidenceResult: {
        actionKind: 'click',
        tabId: 1,
        toolSuccess: false,
        targetBinding: {
          requestedTargetRef: 'missing-ref',
          targetBindingProven: false,
        },
        dispatch: {
          dispatched: false,
          acceptedByBrowser: false,
          errorCode: 'legacy_text_error_normalized',
        },
        business: {
          businessSuccessVerdict: 'not_proven',
          businessSuccessProven: false,
          nextRequiredCheck: 'fix_target_or_retry_with_fresh_refs',
        },
        postAction: {
          postActionReadbackStatus: 'not_available',
          freshReadRequired: false,
        },
      },
    });
    expect(body.message).toContain('click dispatch and post-action state are not proven');
    expect(JSON.stringify(body)).not.toContain('Element ref not found');
  });

  it('enriches structured legacy chrome_click_element errors with action evidence', async () => {
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
              success: false,
              dispatchSucceeded: false,
              observedOutcome: 'no_observed_change',
              verification: {
                navigationOccurred: false,
                urlChanged: false,
                newTabOpened: false,
                domChanged: false,
                stateChanged: false,
                focusChanged: false,
              },
              clickDiff: { kind: 'unknown' },
              navigationOccurred: false,
              lane: 'tabrix_owned',
              message:
                'Legacy text click error was normalized; click dispatch and post-action state are not proven',
              clickMethod: 'unknown',
              resultShape: 'legacy_text_error_normalized',
              rawTextLength: 108,
            }),
          },
        ],
        isError: true,
      },
    } as never);

    const result = await handleToolCall('chrome_click_element', {
      tabId: 1,
      ref: 'stale-ref',
      interaction: 'hover',
    });

    expect(result.isError).toBe(true);
    const body = JSON.parse(String((result.content as any[])[0].text));
    expect(body).toMatchObject({
      success: false,
      dispatchSucceeded: false,
      resultShape: 'legacy_text_error_normalized',
      rawTextLength: 108,
      actionEvidenceResult: {
        actionKind: 'hover',
        tabId: 1,
        toolSuccess: false,
        targetBinding: {
          requestedTargetRef: 'stale-ref',
          targetBindingProven: false,
        },
        dispatch: {
          dispatched: false,
          acceptedByBrowser: false,
          errorCode: 'legacy_text_error_normalized',
        },
        business: {
          businessSuccessVerdict: 'not_proven',
          businessSuccessProven: false,
          nextRequiredCheck: 'fix_target_or_retry_with_fresh_refs',
        },
        postAction: {
          postActionReadbackStatus: 'not_available',
          freshReadRequired: false,
        },
      },
    });
  });

  it('attaches runtime preflight evidence to structured chrome_click_element errors', async () => {
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
              success: false,
              dispatchSucceeded: false,
              observedOutcome: 'no_observed_change',
              verification: {
                navigationOccurred: false,
                urlChanged: false,
                newTabOpened: false,
                domChanged: false,
                stateChanged: false,
                focusChanged: false,
              },
              clickDiff: { kind: 'no_change' },
              navigationOccurred: false,
              lane: 'tabrix_owned',
              message:
                'Click helper returned an error; click dispatch and post-action state are not proven',
              clickMethod: 'selector',
              resultShape: 'structured_click_error',
            }),
          },
        ],
        isError: true,
      },
    } as never);

    const result = await handleToolCall('chrome_click_element', {
      tabId: 1,
      selector: '#missing',
    });

    expect(result.isError).toBe(true);
    const body = JSON.parse(String((result.content as any[])[0].text));
    expect(body).toMatchObject({
      success: false,
      dispatchSucceeded: false,
      resultShape: 'structured_click_error',
      clickMethod: 'selector',
      actionPreflight: {
        verdict: 'allow',
      },
      runtimePolicyAudit: {
        policy: 'non_interference',
        toolName: 'chrome_click_element',
        verdict: 'allow',
      },
    });
    expect(body.historyRef).toBeUndefined();
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
    const traces = sessionManager.memoryTraces!.listByTask(sessions[0].taskId);
    expect(traces).toHaveLength(1);
    expect(traces[0].requestParams).toMatchObject({
      tabId: 1,
      ref: 'e-1',
      value: '[redacted]',
    });
    expect(JSON.stringify(traces[0].requestParams)).not.toContain('hunter2');
    expect(JSON.stringify(traces[0].response)).not.toContain('hunter2');
    expect(traces[0]).toMatchObject({
      toolName: 'chrome_fill_or_select',
      tabId: 1,
      toolSuccess: true,
      businessSuccess: 'unknown',
      redactionState: 'redacted',
    });
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
    expect(payload.taskContextEnvelope).toMatchObject({
      status: 'attached',
      source: 'task_session_context',
      taskContextKey: 'w5a-collaboration',
      taskContextKeySource: 'external_task_key',
      toolName: 'chrome_click_element',
      evidenceBoundary: {
        deterministicOnly: true,
        realBrowserProven: false,
        commercialDeliveryProven: false,
      },
    });
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
    it('chrome_read_page returns a structured warning with cached page state when budget is exceeded', async () => {
      markBridgeReady();
      // Pre-populate the same auto-key the gate will resolve for
      // `{ tabId: 1 }` (no explicit task key). Budget = 2 with two
      // reads already noted → the next call is over budget.
      const ctx = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      Object.defineProperty(ctx, 'readBudget', { value: 2, writable: false });
      ctx.notePageProjectionAndBuildDelta({
        projectionId: 'projection_before_budget',
        projectionKind: 'read_snapshot_projection',
        projectionCreatedAt: '2026-05-18T00:00:00.000Z',
        sourceObservedAt: '2026-05-18T00:00:00.000Z',
        sourceLineage: 'dom',
        regionEvidenceRefs: ['region:viewport'],
        pageId: 'page_before_budget',
        tabId: 1,
        ownerType: 'run_owned',
        readiness: 'ready',
        stability: 'stable',
        contextVersion: 'read://example.test/before/ctx',
        previousContextVersion: null,
        changedByActionId: null,
        changeCause: 'unknown',
        activeRegion: 'viewport',
        changedRegions: ['viewport'],
        reusedRegions: [],
        invalidatedRefs: [],
        refreshedRefs: [],
        chosenDataSource: 'dom_json',
        sourceConfidence: 0.9,
        sourceFreshness: 'fresh',
        contextChars: 1200,
        contextSavedChars: 0,
        userActivityLevel: 'unknown',
        interferenceRisk: 'medium',
      });
      ctx.noteUrlChange('https://new.example/bar');
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
      expect(payload).toMatchObject({
        warning: 'read_budget_exceeded',
        readPageCount: 2,
        readBudget: 2,
        suggestedLayer: 'L0+L1',
        taskContextEnvelope: {
          status: 'attached',
          source: 'task_session_context',
          taskContextKey: 'mcp:auto:tab:1',
          taskContextKeySource: 'external_task_key',
          toolName: 'chrome_read_page',
          readPageRemainingBudget: 0,
          evidenceBoundary: {
            deterministicOnly: true,
            realBrowserProven: false,
            commercialDeliveryProven: false,
          },
        },
      });
      expect(payload.pageProjection).toMatchObject({
        projectionId: 'projection_before_budget',
        pageId: 'page_before_budget',
        tabId: 1,
        ownerType: 'user_owned',
      });
      expect(payload.tabId).toBe(1);
      expect(payload.cachedPageStateSummary).toMatchObject({
        summaryKind: 'cached_page_state',
        freshness: 'cached_not_fresh',
        warning: 'read_budget_exceeded',
        readiness: 'ready',
        stability: 'stable',
        activeRegion: 'viewport',
        contextSavedRatio: 1,
        currentWindowId: null,
        isCurrentTabActive: null,
        isCurrentWindowFocused: null,
        nextStepHint: 'cached_state_only_start_new_task_or_navigate_for_fresh_read',
      });
      expect(payload.deltaContext).toMatchObject({
        deltaKind: 'read_refresh_delta',
        contextSavedRatio: 1,
      });
      expect(payload.aiContextEnvelope).toMatchObject({
        envelopeKind: 'delta_context',
        contextSource: 'cached_page_projection_delta',
        selectedDataSource: 'dom_json',
      });
      expect(payload.ownershipRuntime).toMatchObject({
        currentTabId: 1,
        currentOwnerType: 'user_owned',
      });
      expect(payload.currentWindowId).toBeNull();
      expect(payload.isCurrentTabActive).toBeNull();
      expect(payload.isCurrentWindowFocused).toBeNull();
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
      ownerType?: 'run_owned' | 'user_owned' | 'baseline' | 'unknown';
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
        currentWindowId: 3,
        isCurrentTabActive: true,
        isCurrentWindowFocused: true,
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
          ownerType: input.ownerType ?? 'run_owned',
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

    function objectLifecycleFixture(
      ids: readonly string[],
      status: 'single_snapshot' | 'compared_snapshot' = 'single_snapshot',
    ): Record<string, unknown> {
      return {
        source: 'read_page_regions',
        status,
        objectCount: ids.length,
        changedObjectCount: 0,
        items: ids.map((id) => ({
          objectKey: `object:menu:${id}`,
          regionId: 'region_menu',
          regionType: 'menu',
          objectId: id,
          objectFamily: 'menu_item',
          state: 'visible_candidate',
          targetability: 'target_ref',
          actionTypes: ['click'],
          candidateActionIds: [`ca_${id}`],
          evidenceRefs: [id],
          confidence: 0.8,
          claimBoundary: 'test redacted lifecycle item',
        })),
        changes: [],
        claimBoundary: 'single snapshot in extension payload',
      };
    }

    it('surfaces compared objectLifecycle in the AI-facing chrome_read_page payload', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('object-lifecycle-task');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'object-before',
          contextChars: 100,
          changedRegions: ['menu'],
          extraPayload: {
            objectLifecycle: objectLifecycleFixture(['ref_menu_button']),
          },
        }),
      );
      const before = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'object-lifecycle-task',
        requestedLayer: 'L0+L1',
      });
      expect(before.isError).toBeFalsy();

      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'object-after',
          contextChars: 120,
          changedRegions: ['menu'],
          refreshedRefs: ['ref_menu_button', 'ref_action_1'],
          extraPayload: {
            objectLifecycle: objectLifecycleFixture(['ref_menu_button', 'ref_action_1']),
            ownershipRuntime: {
              currentTabUrl: 'https://example.test/runtime',
              currentTabPendingUrl: '',
              currentTabTitle: 'Runtime page',
              currentTabStatus: 'complete',
              currentTabDiscarded: false,
              currentTabAudible: false,
              currentTabMuted: false,
              currentTabPinned: true,
              currentTabOpenerTabId: 8,
              currentTabOpenedBy: 'ai',
              currentTabOpenedBySource: 'ai_tool',
              currentTabOpenedByConfidence: 0.95,
              currentTabOpenedByReason: 'marked_by_tabrix_navigation_result',
              currentTabAiOperationState: 'recently_operated',
              currentTabLastAiOperation: 'read_page',
              currentTabLastAiOperationAtMs: 1770000000000,
              currentTabLastAiOperationConfidence: 0.95,
              currentTabLastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
              currentTabCanTabrixOperate: true,
              currentTabOperabilityReason: 'regular_web_page',
              currentTabRuntimeStateSource: 'browser_world_inventory',
              browserWorldObjectChangeSummary:
                'Object change summary: active tab was read; no page content claim.',
              browserWorldActionableObjectChangeSummary:
                'Actionable object change: latest AI-operated tab is active and operable.',
              browserWorldCurrentOperationConclusion:
                'Current operation: read_page marked the tab as recently operated.',
              browserWorldRoutingDecisionSummary:
                'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
            },
          },
        }),
      );
      const after = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'object-lifecycle-task',
        requestedLayer: 'L0+L1+L2',
      });
      expect(after.isError).toBeFalsy();
      const payload = JSON.parse(String(after.content[0].text));

      expect(payload.objectLifecycle).toMatchObject({
        status: 'compared_snapshot',
        changedObjectCount: 1,
      });
      expect(payload.objectLifecycle.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            objectKey: 'object:menu:ref_action_1',
            changeKind: 'appeared',
          }),
        ]),
      );
      expect(payload.aiContextEnvelope.objectLifecycle).toMatchObject({
        status: 'compared_snapshot',
        changedObjectCount: 1,
      });
      expect(payload.aiContextEnvelope.pageObjectDetailPolicy).toMatchObject({
        readMode: 'compact',
        summaryField: 'pageObjectSummary',
        fullObjectField: 'browserPageObject',
        fullObjectInAiEnvelope: false,
        reason: 'compact_or_normal_read_mode_prefers_summary_first',
      });
      expect(payload.aiContextEnvelope.browserPageObject).toBeUndefined();
      expect(payload.aiContextEnvelope.pageObjectSummary).toMatchObject({
        source: 'read_page_browser_page_object_compact',
        status: 'compared_snapshot',
        watchStatus: expect.stringContaining('candidate'),
        primaryConclusion: expect.stringContaining('Menu expanded candidate'),
        changedGroups: expect.arrayContaining(['menu_state']),
        facts: {
          tab: {
            currentTabUrl: 'https://example.test/runtime',
            currentTabStatus: 'complete',
            currentTabPinned: true,
            openedBy: 'ai',
            openedBySource: 'ai_tool',
            openedByConfidence: 0.95,
            lastAiOperation: 'read_page',
            lastAiOperationConfidence: 0.95,
            lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
            browserWorldObjectChangeSummary:
              'Object change summary: active tab was read; no page content claim.',
            browserWorldActionableObjectChangeSummary:
              'Actionable object change: latest AI-operated tab is active and operable.',
            browserWorldCurrentOperationConclusion:
              'Current operation: read_page marked the tab as recently operated.',
            browserWorldRoutingDecisionSummary:
              'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
            canTabrixOperate: true,
            operabilityReason: 'regular_web_page',
            runtimeStateSource: 'browser_world_inventory',
          },
        },
      });
      expect(payload.ownershipRuntime).toMatchObject({
        currentTabUrl: 'https://example.test/runtime',
        currentTabStatus: 'complete',
        currentTabPinned: true,
        currentTabOpenedBy: 'ai',
        currentTabOpenedBySource: 'ai_tool',
        currentTabOpenedByConfidence: 0.95,
        currentTabLastAiOperation: 'read_page',
        currentTabLastAiOperationConfidence: 0.95,
        currentTabLastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
        currentTabCanTabrixOperate: true,
        currentTabRuntimeStateSource: 'browser_world_inventory',
        browserWorldObjectChangeSummary:
          'Object change summary: active tab was read; no page content claim.',
        browserWorldActionableObjectChangeSummary:
          'Actionable object change: latest AI-operated tab is active and operable.',
        browserWorldCurrentOperationConclusion:
          'Current operation: read_page marked the tab as recently operated.',
        browserWorldRoutingDecisionSummary:
          'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
      });
      expect(payload.aiContextEnvelope.primaryConclusion).toContain('Menu expanded candidate');
      expect(payload.aiContextEnvelope.watchStatus).toEqual(
        payload.aiContextEnvelope.pageObjectSummary.watchStatus,
      );
      expect(payload.aiContextEnvelope.changedGroups).toEqual(
        payload.aiContextEnvelope.pageObjectSummary.changedGroups,
      );
    });

    it('surfaces auth resume gate in AI context and preserves it on cached redundant reads', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('auth-resume-gate-task');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'auth-resume-before',
          contextChars: 140,
          changedRegions: ['auth'],
          extraPayload: {
            authCollaboration: {
              status: 'succeeded_candidate',
              challengeType: 'otp',
              userAction: {
                required: false,
                instruction: 'User action candidate complete; verify before resume.',
              },
              evidence: {
                pageFreshness: 'single_snapshot',
                operationBinding: 'ai_operable_tab',
                semanticEventTypes: ['auth_succeeded_candidate'],
                postconditionStatus: 'candidate_only',
                resumeVerification: {
                  status: 'fresh_read_required',
                  nextTool: 'chrome_read_page',
                  forceRefreshRequired: true,
                  sameTabRequired: true,
                  targetTabId: 1,
                  postconditionRequired: true,
                  requiredSignals: ['auth_prompt_absent', 'account_region_present'],
                  claimBoundary: 'deterministic auth resume fixture only',
                },
                claimBoundary: 'candidate auth evidence only',
              },
            },
          },
        }),
      );

      const first = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'auth-resume-gate-task',
        requestedLayer: 'L0+L1',
      });
      expect(first.isError).toBeFalsy();
      const firstPayload = JSON.parse(String(first.content[0].text));
      expect(firstPayload.authResumeGate).toMatchObject({
        status: 'fresh_read_required',
        forceRefreshRequired: true,
        sameTabRequired: true,
        targetTabId: 1,
        postconditionRequired: true,
        blocksTaskResume: true,
        nextStepHint: 'fresh_read_same_tab_then_postcondition',
      });
      expect(firstPayload.taskResumeReadiness).toMatchObject({
        status: 'blocked_by_auth_verification',
        canResumeOriginalTask: false,
        nextStep: 'force_fresh_read_same_tab',
        tabId: 1,
        reason: 'cached_or_candidate_auth_state_cannot_resume_task_without_fresh_read',
      });
      expect(firstPayload.aiContextEnvelope).toMatchObject({
        authResumeGate: {
          reason: 'cached_or_candidate_auth_state_cannot_resume_task_without_fresh_read',
        },
        taskResumeReadiness: {
          status: 'blocked_by_auth_verification',
          canResumeOriginalTask: false,
        },
        taskState: {
          state: 'login_required',
          recommendedNextAction: 'user_collaboration',
        },
      });

      const dynamicFlowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);
      dynamicFlowSpy.mockClear();
      const cached = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'auth-resume-gate-task',
        requestedLayer: 'L0+L1',
      });
      expect(cached.isError).toBeFalsy();
      const cachedPayload = JSON.parse(String(cached.content[0].text));
      expect(cachedPayload).toMatchObject({
        warning: 'read_redundant',
        authResumeGate: {
          status: 'fresh_read_required',
          blocksTaskResume: true,
          nextStepHint: 'fresh_read_same_tab_then_postcondition',
        },
        taskResumeReadiness: {
          status: 'blocked_by_auth_verification',
          canResumeOriginalTask: false,
          nextStep: 'force_fresh_read_same_tab',
        },
        aiContextEnvelope: {
          authResumeGate: {
            reason: 'cached_or_candidate_auth_state_cannot_resume_task_without_fresh_read',
          },
          taskResumeReadiness: {
            status: 'blocked_by_auth_verification',
            canResumeOriginalTask: false,
          },
          taskState: {
            state: 'login_required',
            recommendedNextAction: 'user_collaboration',
          },
        },
      });
      expect(dynamicFlowSpy).toHaveBeenCalledTimes(1);
    });

    it('blocks impact tools until auth resume gate is freshly verified', async () => {
      markBridgeReady();
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'auth-resume-preflight-before',
          contextChars: 140,
          changedRegions: ['auth'],
          extraPayload: {
            authCollaboration: {
              status: 'succeeded_candidate',
              challengeType: 'otp',
              userAction: {
                required: false,
                instruction: 'User action candidate complete; verify before resume.',
              },
              evidence: {
                pageFreshness: 'single_snapshot',
                operationBinding: 'ai_operable_tab',
                semanticEventTypes: ['auth_succeeded_candidate'],
                postconditionStatus: 'candidate_only',
                resumeVerification: {
                  status: 'fresh_read_required',
                  nextTool: 'chrome_read_page',
                  forceRefreshRequired: true,
                  sameTabRequired: true,
                  targetTabId: 1,
                  postconditionRequired: true,
                  requiredSignals: ['auth_prompt_absent', 'account_region_present'],
                  claimBoundary: 'deterministic auth resume fixture only',
                },
                claimBoundary: 'candidate auth evidence only',
              },
            },
          },
        }),
      );

      const first = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'auth-resume-preflight-task',
        requestedLayer: 'L0+L1',
      });
      expect(first.isError).toBeFalsy();

      const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');
      bridgeSpy.mockClear();
      const blocked = await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_after_login',
        taskSessionId: 'auth-resume-preflight-task',
        userConfirmed: true,
      });

      expect(blocked.isError).toBe(true);
      const payload = JSON.parse(String(blocked.content[0].text));
      expect(payload).toMatchObject({
        ok: false,
        code: 'TABRIX_ACTION_COLLABORATION_REQUIRED',
        actionPreflight: {
          verdict: 'collaboration_required',
          reason: 'auth_resume_verification_required',
          taskResumeHandoffStatus: 'needs_fresh_read',
          taskResumeHandoffNextAction: 'run_chrome_read_page_force_refresh',
          taskResumeCanContinue: false,
        },
        taskResumeHandoff: {
          summaryKind: 'task_resume_handoff_v1',
          status: 'needs_fresh_read',
          canContinue: false,
          nextAction: 'run_chrome_read_page_force_refresh',
        },
        runtimePolicyAudit: {
          verdict: 'collaboration_required',
          reason: 'auth_resume_verification_required',
          authResumeGate: {
            status: 'fresh_read_required',
            targetTabId: 1,
            blocksTaskResume: true,
          },
          taskResumeReadiness: {
            handoffSummary: {
              status: 'needs_fresh_read',
              nextAction: 'run_chrome_read_page_force_refresh',
            },
          },
        },
      });
      expect(payload.message).toContain('chrome_read_page');
      expect(payload.message).toContain('forceRefresh=true');
      expect(payload.message).toBe(payload.taskResumeHandoff.message);
      expect(bridgeSpy).toHaveBeenCalledTimes(1);
    });

    it('auto-runs a fresh readback for implicit task context before page interaction', async () => {
      markBridgeReady();
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'auth-resume-auto-before',
          contextChars: 140,
          changedRegions: ['auth'],
          extraPayload: {
            authCollaboration: {
              status: 'succeeded_candidate',
              challengeType: 'qr',
              userAction: {
                required: false,
                instruction: 'User scanned; verify before continuing.',
              },
              evidence: {
                pageFreshness: 'single_snapshot',
                operationBinding: 'ai_operable_tab',
                semanticEventTypes: ['auth_succeeded_candidate'],
                postconditionStatus: 'candidate_only',
                resumeVerification: {
                  status: 'fresh_read_required',
                  nextTool: 'chrome_read_page',
                  forceRefreshRequired: true,
                  sameTabRequired: true,
                  targetTabId: 1,
                  postconditionRequired: true,
                  requiredSignals: ['auth_prompt_absent', 'account_region_present'],
                  claimBoundary: 'deterministic auth resume fixture only',
                },
                claimBoundary: 'candidate auth evidence only',
              },
            },
          },
        }),
      );

      const first = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      expect(first.isError).toBeFalsy();

      const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');
      bridgeSpy.mockClear();
      bridgeSpy
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: readPagePayloadWithProjection({
                  projectionId: 'auth-resume-auto-after',
                  contextChars: 180,
                  changedRegions: ['results'],
                  extraPayload: {
                    authCollaboration: {
                      status: 'not_required',
                      evidence: {
                        resumeVerification: {
                          status: 'not_required',
                          nextTool: 'chrome_read_page',
                          forceRefreshRequired: false,
                          sameTabRequired: true,
                          targetTabId: 1,
                          postconditionRequired: false,
                          requiredSignals: [],
                          claimBoundary: 'deterministic auth resume fixture cleared',
                        },
                      },
                    },
                  },
                }),
              },
            ],
            isError: false,
          },
        } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  dispatchSucceeded: true,
                  observedOutcome: 'dom_changed',
                  verification: {
                    navigationOccurred: false,
                    urlChanged: false,
                    newTabOpened: false,
                    domChanged: true,
                    stateChanged: true,
                    focusChanged: false,
                  },
                  clickDiff: { kind: 'dom_changed' },
                  navigationOccurred: false,
                  lane: 'tabrix_owned',
                  message: 'Click observed outcome: dom_changed',
                  clickMethod: 'selector',
                  resultShape: 'structured_click_result',
                }),
              },
            ],
            isError: false,
          },
        } as never);

      const result = await handleToolCall('chrome_click_element', {
        tabId: 1,
        selector: '#filter',
      });

      expect(result.isError).toBe(false);
      const payload = JSON.parse(String(result.content[0].text));
      expect(payload).toMatchObject({
        success: true,
        dispatchSucceeded: true,
        observedOutcome: 'dom_changed',
        actionPreflight: {
          verdict: 'allow',
        },
        runtimePolicyAudit: {
          verdict: 'allow',
        },
      });
      expect(bridgeSpy).toHaveBeenCalledTimes(4);
    });

    it('keeps the full browserPageObject in the AI envelope for full-mode chrome_read_page', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('object-lifecycle-full-task');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'object-full-before',
          contextChars: 100,
          changedRegions: ['menu'],
          extraPayload: {
            objectLifecycle: objectLifecycleFixture(['ref_menu_button']),
          },
        }),
      );
      const before = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'object-lifecycle-full-task',
        requestedLayer: 'L0+L1',
      });
      expect(before.isError).toBeFalsy();

      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'object-full-after',
          contextChars: 120,
          changedRegions: ['menu'],
          refreshedRefs: ['ref_menu_button', 'ref_action_1'],
          extraPayload: {
            mode: 'full',
            objectLifecycle: objectLifecycleFixture(['ref_menu_button', 'ref_action_1']),
          },
        }),
      );
      const after = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'object-lifecycle-full-task',
        requestedLayer: 'L0+L1+L2',
        mode: 'full',
      });
      expect(after.isError).toBeFalsy();
      const payload = JSON.parse(String(after.content[0].text));

      expect(payload.aiContextEnvelope.pageObjectDetailPolicy).toMatchObject({
        readMode: 'full',
        summaryField: 'pageObjectSummary',
        fullObjectField: 'browserPageObject',
        fullObjectInAiEnvelope: true,
        reason: 'full_read_mode_requested',
      });
      expect(payload.aiContextEnvelope.pageObjectSummary).toMatchObject({
        source: 'read_page_browser_page_object_compact',
        status: 'compared_snapshot',
        primaryConclusion: expect.stringContaining('Menu expanded candidate'),
      });
      expect(payload.aiContextEnvelope.browserPageObject).toMatchObject({
        source: 'read_page_browser_page_object',
        status: 'compared_snapshot',
        rawLifecycleStats: {
          changedObjectCount: 1,
        },
      });
      expect(payload.aiContextEnvelope.browserPageObject.semanticEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: 'menu_expanded',
            targetGroup: 'menu_state',
            postconditionStatus: 'candidate_only',
          }),
        ]),
      );
    });

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

    it('does not short-circuit same-layer reads when mode or depth changes', async () => {
      markBridgeReady();

      mockReadPageRoundTrip('first compact read');
      const r1 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'same-layer-shape-task',
        requestedLayer: 'L0+L1+L2',
        mode: 'compact',
        depth: 4,
      });
      expect(r1.isError).toBeFalsy();

      mockReadPageRoundTrip('second normal read');
      const r2 = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'same-layer-shape-task',
        requestedLayer: 'L0+L1+L2',
        mode: 'normal',
        depth: 8,
      });

      expect(r2.isError).toBeFalsy();
      expect(String(r2.content[0].text)).toBe('second normal read');
      const ctx = sessionManager.peekExternalTaskContext('same-layer-shape-task');
      expect(ctx!.readPageCount).toBe(2);
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
        taskContext: {
          envelopeKind: 'task_context',
          status: 'attached',
          source: 'task_session_context',
          taskContextKey: 'delta-task',
          taskContextKeySource: 'external_task_key',
          toolName: 'chrome_read_page',
          readPageCount: 1,
          readBudget: expect.any(Number),
          lifecycleEventCount: 5,
          runOwnedTabCount: 0,
          evidenceBoundary: {
            deterministicOnly: true,
            realBrowserProven: false,
            commercialDeliveryProven: false,
          },
        },
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
      expect(firstPayload.taskContextEnvelope).toMatchObject({
        status: 'attached',
        source: 'task_session_context',
        taskContextKey: 'delta-task',
        taskContextKeySource: 'external_task_key',
        toolName: 'chrome_read_page',
        evidenceBoundary: {
          deterministicOnly: true,
          realBrowserProven: false,
          commercialDeliveryProven: false,
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
        deltaKind: 'read_refresh_delta',
        fromProjectionId: 'projection_initial',
        toProjectionId: 'projection_post',
        changedRegions: ['search_results'],
        reusedRegions: ['global_nav'],
        refreshedRefs: ['ref_result_1'],
        contextChars: 3200,
        previousContextChars: 12000,
        contextSavedChars: 8800,
      });
      expect(secondPayload.postActionDeltaEvidence ?? null).toBeNull();
      expect(secondPayload.aiContextEnvelope).toMatchObject({
        contextSource: 'page_projection_delta',
        taskState: {
          state: 'ready',
          recommendedNextAction: 'continue_read',
        },
        selectedDataSource: 'dom_json',
        sourceRouteHonesty: {
          verdict: 'dom_fallback',
          selectedDataSource: 'dom_json',
          apiCdpReuseProven: false,
        },
        apiCdpProofBoundary: {
          proofStatus: 'not_proven_dom_fallback',
          apiCdpReuseProven: false,
          selectedDataSource: 'dom_json',
          safeClaim: 'This read used a DOM/text fallback route only.',
          notSafeClaim: 'DOM fallback success must not be claimed as API/CDP reuse proof.',
        },
      });
      expect(secondPayload.sourceRouteHonesty).toMatchObject({
        verdict: 'dom_fallback',
        selectedDataSource: 'dom_json',
        apiCdpReuseProven: false,
      });
      expect(secondPayload.apiCdpProofBoundary).toMatchObject({
        proofStatus: 'not_proven_dom_fallback',
        apiCdpReuseProven: false,
        selectedDataSource: 'dom_json',
        notSafeClaim: 'DOM fallback success must not be claimed as API/CDP reuse proof.',
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
                text: JSON.stringify({
                  success: true,
                  closedTabIds: [1],
                  browserHygieneEvidence: {
                    kind: 'close_tabs_hygiene_v1',
                    before: {
                      tabCount: 3,
                      windowCount: 1,
                      focusedWindowId: 10,
                      activeTabId: 1,
                    },
                    after: {
                      tabCount: 2,
                      windowCount: 1,
                      focusedWindowId: 10,
                      activeTabId: 2,
                    },
                    closedTabIds: [1],
                    invalidTabIds: [],
                    tabWindowBaselineUnchanged: true,
                    activeTabRestored: true,
                    activeTabRestoreReason: 'active_tab_restored_to_surviving_tab',
                  },
                }),
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
      expect(closePayload.taskContextEnvelope).toMatchObject({
        status: 'attached',
        source: 'task_session_context',
        taskContextKey: 'delta-task',
        taskContextKeySource: 'external_task_key',
        toolName: 'chrome_close_tabs',
        lifecycleEventCount: 11,
        runOwnedTabCount: 0,
        evidenceBoundary: {
          deterministicOnly: true,
          realBrowserProven: false,
          commercialDeliveryProven: false,
        },
      });
      expect(
        closePayload.lifecycleTimeline.map((event: { kind: string }) => event.kind).at(-1),
      ).toBe('cleanup');
      expect(closePayload.lifecycleTimeline.at(-1)).toMatchObject({
        cleanupAction: 'chrome_close_tabs',
        cleanupTargetIds: [1],
      });
      expect(closePayload.actionEvidenceResult).toMatchObject({
        actionKind: 'close_tabs',
        tabId: 1,
        toolSuccess: true,
        dispatch: {
          dispatched: true,
          acceptedByBrowser: true,
          errorCode: null,
        },
        targetBinding: {
          locatorChainSummary: ['tabId:1'],
          dispatchTarget: 'tab_ids',
          targetBindingProven: true,
        },
        postAction: {
          postActionReadbackStatus: 'browser_hygiene_observed',
          postconditionVerdict: 'passed',
          freshReadRequired: false,
          readbackSource: 'browser_hygiene_evidence',
        },
        business: {
          businessSuccessVerdict: 'proven',
          businessSuccessProven: true,
          nextRequiredCheck: 'none',
        },
        browserHygiene: {
          required: true,
          status: 'pass',
          leakedTabsOrWindows: 0,
        },
      });
      expect(closePayload.actionEvidenceResult.claimBoundary).toContain(
        'Browser hygiene evidence does not prove the original business task succeeded.',
      );
      expect(getLifecycleEvidenceArtifactStoreSnapshot()).toMatchObject({
        bufferedArtifacts: 1,
        lastFinalVerdict: 'task_success',
      });
      const artifacts = listLifecycleEvidenceArtifacts();
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        scenarioId: 'mcp:chrome_close_tabs:cleanup_success',
        scenarioClass: 'browser_hygiene_closeout_v1',
        eventTimeline: {
          available: true,
          totalEvents: 11,
        },
        signalSequence: {
          available: true,
          signalsByKind: {
            ready_to_act: 4,
            results_changed: 4,
          },
        },
        scopeTransitions: {
          available: true,
          totalTransitions: 1,
        },
        actionLog: {
          available: true,
          totalActions: 2,
          passed: 2,
          failed: 0,
          unknown: 0,
        },
        sourceTruthChain: {
          primaryOrigin: 'dom',
        },
        browserHygiene: {
          available: true,
          baselineTabs: 2,
          runOwnedTabsClosed: 1,
          baselineChanged: false,
          checks: [
            {
              kind: 'tab_window_baseline',
              verdict: 'pass',
              reason: 'pre_post_tab_window_baseline_unchanged',
            },
            {
              kind: 'active_tab_restore',
              verdict: 'pass',
              reason: 'active_tab_restored',
            },
            {
              kind: 'run_owned_cleanup',
              verdict: 'pass',
              reason: 'run_owned_tabs_cleaned',
            },
            {
              kind: 'user_owned_protection',
              verdict: 'pass',
              reason: 'user_owned_tabs_protected',
            },
            {
              kind: 'failure_cleanup',
              verdict: 'pass',
              reason: 'failure_cleanup_not_needed',
            },
          ],
        },
        finalVerdict: { verdict: 'task_success', reason: 'postconditions_passed' },
        claimBoundary: {
          deterministicArtifactOnly: true,
          realBrowserProven: false,
          commercialGradeProven: false,
          competitorSuperiorityProven: false,
        },
      });
      expect(artifacts[0].actionLog.entries[0]).toMatchObject({
        actionKind: 'read',
        tabId: 1,
        verdict: 'passed',
        reason: 'read_page_projection_available',
      });
      expect(artifacts[0].actionLog.entries[1]).toMatchObject({
        actionKind: 'close',
        tabId: 1,
        verdict: 'passed',
        reason: 'close_tabs_cleanup_succeeded',
      });
      expect(artifacts[0].claimBoundary.sourceRouteProven).toBe(false);
      expect(artifacts[0].browserHygiene.notes).toContain(
        'browserHygieneEvidenceCompleteness=complete',
      );
      expect(artifacts[0].browserHygiene.notes).toContain('tabWindowBaselineUnchanged=true');
      expect(artifacts[0].browserHygiene.notes).toContain(
        'activeTabRestoreReason=active_tab_restored_to_surviving_tab',
      );
      expect(artifacts[0].browserHygiene.notes).toContain('sourceRouteHonestyVerdict=dom_fallback');
      expect(artifacts[0].browserHygiene.notes).toContain('sourceRouteSelectedDataSource=dom_json');
      expect(artifacts[0].browserHygiene.notes).toContain(
        'sourceRouteHonestyBoundary=runtime_visible_api_cdp_not_proven',
      );
      expect(artifacts[0].browserHygiene.notes).toContain('apiCdpReuseProven=false');
      expect(artifacts[0].browserHygiene.notes).toContain('v3RequiredAction=close');
      const serializedArtifact = JSON.stringify(artifacts[0]);
      expect(serializedArtifact).not.toContain('PRIVATE_PAGE_BODY_SHOULD_NOT_APPEAR');
      expect(serializedArtifact).not.toContain('Authorization');
      expect(serializedArtifact).not.toContain('sourcePayload');
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
      expect(secondPayload.currentWindowId).toBe(3);
      expect(secondPayload.isCurrentTabActive).toBe(true);
      expect(secondPayload.isCurrentWindowFocused).toBe(true);
      expect(secondPayload.ownershipRuntime).toMatchObject({
        currentTabId: 7,
        currentWindowId: 3,
        isCurrentTabActive: true,
        isCurrentWindowFocused: true,
        currentOwnerType: 'user_owned',
        isCurrentTabRunOwnedByTask: false,
        runOwnedTabIds: [],
        runOwnedTabCount: 0,
        defaultProtection: 'protect_unknown_and_user_owned',
      });
      expect(secondPayload.deltaContext).toMatchObject({
        deltaKind: 'read_refresh_delta',
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
      expect(secondPayload.postActionDeltaEvidence ?? null).toBeNull();
      expect(secondPayload.aiContextEnvelope).toMatchObject({
        contextSource: 'cached_page_projection_delta',
        pageObjectSummary: {
          source: 'read_page_browser_page_object_compact',
          rootObjectId: 'browser_page:tab:7',
          watchStatus: 'stable_or_unknown',
          primaryConclusion:
            'Cached page state reused for read_redundant; Window/Tab runtime facts are attached, but page content was not freshly read.',
          changedGroups: ['evidence_state'],
          facts: {
            window: {
              objectKind: 'BrowserWindowObject',
              currentWindowId: 3,
              readTargetTabId: 7,
              currentActiveTabId: 7,
              currentActiveTabIdAliasOf: 'readTargetTabId',
              currentWindowState: null,
              isFocused: true,
              isCurrentWindowFocused: true,
              isMinimized: false,
              isVisible: true,
            },
            tab: {
              objectKind: 'BrowserTabObject',
              readTargetTabId: 7,
              currentTabId: 7,
              isActive: true,
              ownerType: 'user_owned',
              openedBy: null,
              openedBySource: null,
              cleanupEligibility: 'not_eligible',
              protectedScopeVerdict: 'protected',
              runtimeStateSource: 'unknown',
              runOwnedTabCount: 0,
            },
            page: {
              objectKind: 'BrowserPageObject',
              pageId: 'tab:7',
              tabId: 7,
              selectedDataSource: 'dom_json',
            },
            visualReliability: {
              objectKind: 'BrowserVisualReliability',
              isCurrentWindowFocused: true,
              isCurrentTabActive: true,
              isWindowMinimized: false,
              visualReliabilityCandidate: true,
            },
          },
          evidenceSummary:
            'cached_read_warning: pageProjection is reused; Window/Tab facts come from the latest runtime fields; no fresh DOM/API/CDP read happened.',
          claimBoundary:
            'Cached pageObjectSummary is AI-facing runtime context only. It does not prove page content freshness, login/logout success, API/CDP reuse, or task completion.',
        },
        taskContext: {
          status: 'attached',
          source: 'task_session_context',
          taskContextKey: 'redundant-delta-task',
          taskContextKeySource: 'external_task_key',
          toolName: 'chrome_read_page',
        },
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
      expect(secondPayload.taskContextEnvelope).toMatchObject({
        status: 'attached',
        source: 'task_session_context',
        taskContextKey: 'redundant-delta-task',
        taskContextKeySource: 'external_task_key',
        toolName: 'chrome_read_page',
      });
      expect(flowSpy).toHaveBeenCalledTimes(1);
      const persisted = sessionManager.listSessions().at(-1);
      expect(persisted?.summary).toBe(
        'AI context: read_refresh_delta; state=ready; next=continue_read; source=cached_page_projection_delta; data=dom_json; reason=cached_projection_reused_for_redundant_read; fallback=none; rejected=none; metadata=1; confidence=0.9; changed=none; reused=viewport; savedChars=3600',
      );
    });

    it('marks cached pageObjectSummary as runtime_degraded when the cached window is minimized', async () => {
      markBridgeReady();

      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_cached_minimized',
          contextChars: 1800,
          changedRegions: ['viewport'],
          pageId: 'tab:17',
          tabId: 17,
          extraPayload: {
            currentWindowId: 33,
            currentWindowState: 'minimized',
            currentWindowWidth: 900,
            currentWindowHeight: 640,
            currentWindowLeft: 12,
            currentWindowTop: 34,
            isCurrentTabActive: true,
            isCurrentWindowFocused: false,
          },
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 17,
        taskSessionId: 'redundant-minimized-window-task',
        requestedLayer: 'L0+L1',
      });

      const flowSpy = jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never);
      flowSpy.mockClear();
      flowSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const second = await handleToolCall('chrome_read_page', {
        tabId: 17,
        taskSessionId: 'redundant-minimized-window-task',
        requestedLayer: 'L0+L1',
      });
      const payload = JSON.parse(String(second.content[0].text));

      expect(payload.warning).toBe('read_redundant');
      expect(payload.currentWindowState).toBe('minimized');
      expect(payload.isCurrentWindowFocused).toBe(false);
      expect(payload.cachedPageStateSummary).toMatchObject({
        currentWindowState: 'minimized',
        isCurrentTabActive: true,
        isCurrentWindowFocused: false,
      });
      expect(payload.aiContextEnvelope.pageObjectSummary).toMatchObject({
        watchStatus: 'runtime_degraded',
        changedGroups: ['window_state', 'tab_state', 'visual_reliability', 'evidence_state'],
        facts: {
          window: {
            objectKind: 'BrowserWindowObject',
            currentWindowId: 33,
            currentWindowState: 'minimized',
            isFocused: false,
            isCurrentWindowFocused: false,
            isMinimized: true,
            isVisible: false,
            width: 900,
            height: 640,
          },
          visualReliability: {
            objectKind: 'BrowserVisualReliability',
            isCurrentWindowFocused: false,
            isCurrentTabActive: true,
            isWindowMinimized: true,
            visualReliabilityCandidate: false,
          },
        },
      });
      expect(payload.aiContextEnvelope.pageObjectSummary.primaryConclusion).toContain(
        'current runtime is visually degraded',
      );
      expect(payload.aiContextEnvelope.pageObjectSummary.facts.window).toMatchObject({
        readTargetTabId: 17,
        currentActiveTabId: 17,
        currentActiveTabIdAliasOf: 'readTargetTabId',
      });
      expect(
        payload.aiContextEnvelope.pageObjectSummary.facts.window.currentActiveTabIdClaimBoundary,
      ).toContain('not browser-active-tab proof');
      expect(flowSpy).toHaveBeenCalledTimes(1);
    });

    it('exposes structured-read gate verdict in chrome_read_page AI-facing output', async () => {
      markBridgeReady();
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_long_content_full',
          contextChars: 6800,
          changedRegions: ['article_body'],
          refreshedRefs: ['ref_section_1', 'ref_section_2', 'ref_section_3'],
          extraPayload: {
            mode: 'full',
            taskMode: 'read',
            complexityLevel: 'complex',
            summary: {
              pageRole: 'article',
              primaryRegion: 'content',
              quality: 'usable',
            },
            completeTextRegion: {
              completeTextAvailable: true,
              charCount: 6800,
              lineCount: 48,
              structureSparse: false,
              contentSparse: false,
            },
            visibleRegionRows: {
              rowCount: 6,
              rows: [],
              targetRefCoverageRate: 0.92,
              regionQualityScore: 0.91,
            },
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'long-content-gate',
        mode: 'full',
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_full',
        verdict: 'complete',
        reasonCode: 'complete_read_metadata_satisfied',
        gapDescription: null,
        recommendedAction: null,
        metrics: {
          readMode: 'full',
          taskMode: 'read',
          complexityLevel: 'complex',
          pageRole: 'article',
          primaryRegion: 'content',
          completeTextAvailable: true,
          structureSparse: false,
          contentSparse: false,
        },
        boundary: {
          metadataOnly: true,
          rawContentInspected: false,
          browserIoPerformed: false,
          llmUsed: false,
          publicContractChanged: false,
          realBrowserProven: false,
          commercialGradeProven: false,
        },
      });
      expect(payload.structuredReadGate.metrics.bodyCharCount).toBe(6800);
      expect(payload.structuredReadGate.metrics.lineCount).toBe(48);
      expect(payload.structuredReadGate.metrics.coverageRatio).toBe(1);
      expect(payload.structuredReadGate.evidenceBasis).toEqual(
        expect.arrayContaining(['summary', 'taskMode', 'complexityLevel', 'completeTextRegion']),
      );
      expect(payload.structuredReadGate.producedAtMs).toEqual(expect.any(Number));
      expect(payload.aiContextEnvelope.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_full',
        verdict: 'complete',
        reasonCode: 'complete_read_metadata_satisfied',
      });
    });

    it('exposes summary-only structured-read reason in chrome_read_page AI-facing output', async () => {
      markBridgeReady();
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_long_content_summary_only',
          contextChars: 420,
          changedRegions: ['article_body'],
          refreshedRefs: ['ref_article_title'],
          extraPayload: {
            mode: 'normal',
            taskMode: 'read',
            complexityLevel: 'complex',
            summary: {
              pageRole: 'article',
              primaryRegion: 'content',
              quality: 'usable',
            },
            completeTextRegion: {
              completeTextAvailable: false,
              charCount: 420,
              lineCount: 4,
              structureSparse: false,
              contentSparse: true,
            },
            sourcePayload: 'PRIVATE_SOURCE_PAYLOAD_SHOULD_NOT_APPEAR',
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        taskSessionId: 'long-content-summary-only-gate',
        mode: 'normal',
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_summary_only',
        verdict: 'summary_only',
        reasonCode: 'summary_only_body_missing',
        recommendedAction:
          'request full or normal mode and verify body coverage before summarizing',
        metrics: {
          readMode: 'normal',
          taskMode: 'read',
          complexityLevel: 'complex',
          pageRole: 'article',
          primaryRegion: 'content',
          completeTextAvailable: false,
          contentSparse: true,
        },
        boundary: {
          metadataOnly: true,
          rawContentInspected: false,
          browserIoPerformed: false,
          publicContractChanged: false,
          commercialGradeProven: false,
        },
      });
      expect(payload.structuredReadGate.gapDescription).toContain('body content');
      expect(payload.structuredReadGate.metrics.bodyCharCount).toBe(420);
      expect(payload.aiContextEnvelope.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_summary_only',
        verdict: 'summary_only',
        reasonCode: 'summary_only_body_missing',
        recommendedAction:
          'request full or normal mode and verify body coverage before summarizing',
      });
      expect(getLifecycleEvidenceArtifactStoreSnapshot()).toMatchObject({
        bufferedArtifacts: 1,
        lastFinalVerdict: 'task_failed',
      });
      const artifacts = listLifecycleEvidenceArtifacts();
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        scenarioId: 'mcp:chrome_read_page:structured_read_gate',
        scenarioClass: 'long_content_structured_read_gate_v1',
        actionLog: {
          available: true,
          totalActions: 1,
          failed: 1,
        },
        claimBoundary: {
          deterministicArtifactOnly: true,
          realBrowserProven: false,
          commercialGradeProven: false,
        },
      });
      expect(artifacts[0].actionLog.entries[0]).toMatchObject({
        actionKind: 'read',
        tabId: 1,
        verdict: 'failed',
        reason: 'structured_read_incomplete:summary_only_body_missing',
      });
      const serializedArtifact = JSON.stringify(artifacts[0]);
      expect(serializedArtifact).toContain('summary_only_body_missing');
      expect(serializedArtifact).not.toContain('PRIVATE_SOURCE_PAYLOAD_SHOULD_NOT_APPEAR');
      expect(serializedArtifact).not.toContain('sourcePayload');
    });

    it('exposes coverage-insufficient structured-read reason in chrome_read_page AI-facing output', async () => {
      markBridgeReady();
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_long_content_low_coverage',
          contextChars: 1400,
          changedRegions: ['article_body'],
          refreshedRefs: ['ref_article_section'],
          extraPayload: {
            mode: 'normal',
            taskMode: 'read',
            complexityLevel: 'complex',
            summary: {
              pageRole: 'article',
              primaryRegion: 'content',
              quality: 'usable',
            },
            completeTextRegion: {
              completeTextAvailable: false,
              charCount: 1400,
              lineCount: 14,
              structureSparse: false,
              contentSparse: false,
            },
            visibleRegionRows: {
              rowCount: 3,
              rows: [],
              targetRefCoverageRate: 0.42,
              regionQualityScore: 0.4,
            },
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'long-content-low-coverage-gate',
        mode: 'normal',
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_low_coverage',
        verdict: 'coverage_insufficient',
        reasonCode: 'coverage_insufficient_content_region',
        gapDescription: 'captured metadata does not prove enough content-region coverage',
        recommendedAction: 'expand content-region coverage before treating the read as complete',
        metrics: {
          readMode: 'normal',
          taskMode: 'read',
          complexityLevel: 'complex',
          pageRole: 'article',
          primaryRegion: 'content',
          completeTextAvailable: false,
          structureSparse: false,
          contentSparse: false,
        },
        boundary: {
          metadataOnly: true,
          rawContentInspected: false,
          browserIoPerformed: false,
          publicContractChanged: false,
          commercialGradeProven: false,
        },
      });
      expect(payload.structuredReadGate.metrics.bodyCharCount).toBe(1400);
      expect(payload.structuredReadGate.metrics.coverageRatio).toBe(0.42);
      expect(payload.aiContextEnvelope.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_low_coverage',
        verdict: 'coverage_insufficient',
        reasonCode: 'coverage_insufficient_content_region',
        recommendedAction: 'expand content-region coverage before treating the read as complete',
      });
    });

    it('exposes mode-insufficient structured-read reason in chrome_read_page AI-facing output', async () => {
      markBridgeReady();
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_long_content_compact_shallow',
          contextChars: 1200,
          changedRegions: ['article_body'],
          refreshedRefs: ['ref_article_heading'],
          extraPayload: {
            mode: 'compact',
            taskMode: 'read',
            complexityLevel: 'complex',
            summary: {
              pageRole: 'article',
              primaryRegion: 'content',
              quality: 'usable',
            },
            completeTextRegion: {
              completeTextAvailable: false,
              charCount: 1200,
              lineCount: 12,
              structureSparse: false,
              contentSparse: false,
            },
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'long-content-compact-shallow-gate',
        mode: 'compact',
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_compact_shallow',
        verdict: 'mode_insufficient',
        reasonCode: 'mode_insufficient_shallow_read',
        gapDescription: 'current read mode is too shallow for a long-content candidate',
        recommendedAction: 'request normal or full mode for long-content reading',
        metrics: {
          readMode: 'compact',
          taskMode: 'read',
          complexityLevel: 'complex',
          pageRole: 'article',
          primaryRegion: 'content',
          completeTextAvailable: false,
          contentSparse: false,
        },
        boundary: {
          metadataOnly: true,
          rawContentInspected: false,
          browserIoPerformed: false,
          publicContractChanged: false,
          commercialGradeProven: false,
        },
      });
      expect(payload.structuredReadGate.metrics.bodyCharCount).toBe(1200);
      expect(payload.aiContextEnvelope.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_compact_shallow',
        verdict: 'mode_insufficient',
        reasonCode: 'mode_insufficient_shallow_read',
        recommendedAction: 'request normal or full mode for long-content reading',
      });
    });

    it('exposes metadata-insufficient structured-read reason in chrome_read_page AI-facing output', async () => {
      markBridgeReady();
      const metadataInsufficientPayload = readPagePayloadWithProjection({
        projectionId: 'projection_long_content_metadata_insufficient',
        contextChars: 0,
        changedRegions: ['content_region'],
        refreshedRefs: ['ref_content_region'],
        extraPayload: {
          mode: 'normal',
          taskMode: 'read',
          complexityLevel: 'complex',
          summary: {
            pageRole: '',
            primaryRegion: null,
          },
        },
      });
      const sourcePayload = JSON.parse(metadataInsufficientPayload);
      expect(sourcePayload.completeTextRegion).toBeUndefined();
      expect(sourcePayload.visibleRegionRows).toBeUndefined();
      mockReadPageRoundTrip(metadataInsufficientPayload);

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'long-content-metadata-insufficient-gate',
        mode: 'normal',
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.completeTextRegion).toBeUndefined();
      expect(payload.visibleRegionRows).toBeUndefined();
      expect(payload.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_metadata_insufficient',
        verdict: 'unknown',
        reasonCode: 'metadata_insufficient',
        gapDescription: 'insufficient metadata to prove structured read completeness',
        recommendedAction: 'collect stronger read_page metadata before making a completion claim',
        metrics: {
          readMode: 'normal',
          taskMode: 'read',
          complexityLevel: 'complex',
          pageRole: '',
          primaryRegion: null,
          completeTextAvailable: null,
          structureSparse: null,
          contentSparse: null,
        },
        boundary: {
          metadataOnly: true,
          rawContentInspected: false,
          browserIoPerformed: false,
          publicContractChanged: false,
          commercialGradeProven: false,
        },
      });
      expect(payload.structuredReadGate.evidenceBasis).not.toContain('completeTextRegion');
      expect(payload.structuredReadGate.evidenceBasis).not.toContain('visibleRegionRows');
      expect(payload.aiContextEnvelope.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_metadata_insufficient',
        verdict: 'unknown',
        reasonCode: 'metadata_insufficient',
        recommendedAction: 'collect stronger read_page metadata before making a completion claim',
      });
      expect(getLifecycleEvidenceArtifactStoreSnapshot().bufferedArtifacts).toBe(0);
      expect(listLifecycleEvidenceArtifacts()).toHaveLength(0);
    });

    it('does not emit a lifecycle artifact for unknown structured-read verdicts', async () => {
      markBridgeReady();
      const unknownGatePayload = readPagePayloadWithProjection({
        projectionId: 'projection_long_content_unknown_gate',
        contextChars: 1000,
        changedRegions: ['content_region'],
        refreshedRefs: ['ref_content_region'],
        extraPayload: {
          mode: 'normal',
          taskMode: 'read',
          complexityLevel: 'complex',
          summary: {
            pageRole: '',
            primaryRegion: null,
          },
        },
      });
      mockReadPageRoundTrip(unknownGatePayload);

      const result = await handleToolCall('chrome_read_page', {
        taskSessionId: 'long-content-unknown-gate',
        mode: 'normal',
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_unknown_gate',
        verdict: 'unknown',
        reasonCode: 'metadata_insufficient',
      });
      expect(getLifecycleEvidenceArtifactStoreSnapshot().bufferedArtifacts).toBe(0);
      expect(listLifecycleEvidenceArtifacts()).toHaveLength(0);
    });

    it('exposes structure-sparse structured-read reason in chrome_read_page AI-facing output', async () => {
      markBridgeReady();
      const structureSparsePayload = readPagePayloadWithProjection({
        projectionId: 'projection_long_content_structure_sparse',
        contextChars: 3100,
        changedRegions: ['article_body'],
        refreshedRefs: ['ref_article_body'],
        extraPayload: {
          mode: 'normal',
          taskMode: 'read',
          complexityLevel: 'complex',
          summary: {
            pageRole: 'article',
            primaryRegion: 'content',
            quality: 'usable',
          },
          completeTextRegion: {
            completeTextAvailable: true,
            charCount: 3100,
            lineCount: 30,
            structureSparse: true,
            contentSparse: false,
          },
        },
      });
      const sourcePayload = JSON.parse(structureSparsePayload);
      expect(sourcePayload.completeTextRegion).toMatchObject({
        completeTextAvailable: true,
        charCount: 3100,
        structureSparse: true,
        contentSparse: false,
      });
      expect(sourcePayload.visibleRegionRows).toBeUndefined();
      mockReadPageRoundTrip(structureSparsePayload);

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'long-content-structure-sparse-gate',
        mode: 'normal',
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.visibleRegionRows).toBeUndefined();
      expect(payload.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_structure_sparse',
        verdict: 'structure_sparse',
        reasonCode: 'structure_sparse_sections_missing',
        gapDescription: 'content exists but lacks enough structure for complete-read proof',
        recommendedAction: 'request a more structured read or scroll-and-reread before summarizing',
        metrics: {
          readMode: 'normal',
          taskMode: 'read',
          complexityLevel: 'complex',
          pageRole: 'article',
          primaryRegion: 'content',
          completeTextAvailable: true,
          structureSparse: true,
          contentSparse: false,
        },
        boundary: {
          metadataOnly: true,
          rawContentInspected: false,
          browserIoPerformed: false,
          publicContractChanged: false,
          commercialGradeProven: false,
        },
      });
      expect(payload.structuredReadGate.metrics.bodyCharCount).toBe(3100);
      expect(payload.structuredReadGate.evidenceBasis).toEqual(
        expect.arrayContaining(['summary', 'taskMode', 'complexityLevel', 'completeTextRegion']),
      );
      expect(payload.aiContextEnvelope.structuredReadGate).toMatchObject({
        gateId: 'structured-read-gate:projection_long_content_structure_sparse',
        verdict: 'structure_sparse',
        reasonCode: 'structure_sparse_sections_missing',
        recommendedAction: 'request a more structured read or scroll-and-reread before summarizing',
      });
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
      expect(payload.pageProjection).toMatchObject({
        chosenDataSource: 'dom_region_rows',
        sourceLineage: 'dom',
      });
      expect(payload.deltaContext).toMatchObject({
        toProjectionId: payload.pageProjection.projectionId,
      });
      expect(payload.aiContextEnvelope.taskState).toMatchObject({
        state: 'ready',
        recommendedNextAction: 'continue_read',
      });
    });

    it('does not surface single-row visible DOM evidence as selected dom_region_rows', async () => {
      markBridgeReady();
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_weak_dom_rows',
          contextChars: 2400,
          changedRegions: ['result_list'],
          refreshedRefs: ['ref_result_1'],
          selectedDataSource: 'dom_region_rows',
          extraPayload: {
            kind: 'dom_region_rows',
            rowCount: 1,
            visibleRegionRowsUsed: true,
            visibleRegionRowCount: 1,
            rowExtractionConfidence: 0.9,
            targetRefCoverageRate: 1,
            regionQualityScore: 0.9,
            apiRowsUnavailableReason: 'observed_api_rows_not_available',
            decisionReason: 'visible_dom_rows_selected',
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'weak-dom-rows-truthfulness-task',
        requestedLayer: 'L0+L1+L2',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.aiContextEnvelope.dataSourceDecision.selectedSource).toBe('dom_json');
      expect(payload.aiContextEnvelope.dataSourceDecision.selectedSource).not.toBe(
        'dom_region_rows',
      );
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
      expect(payload.sourceRouteHonesty).toMatchObject({
        verdict: 'unknown',
        selectedDataSource: 'cdp_enhanced_api_rows',
        reason: 'api_cdp_reuse_requires_r5_gate',
        proofGate: 'r5_required',
        sourceRouteCandidate: 'cdp_source_with_fact_evidence',
        apiCdpReuseProven: false,
      });
      expect(payload.aiContextEnvelope.sourceRouteHonesty).toMatchObject({
        verdict: 'unknown',
        selectedDataSource: 'cdp_enhanced_api_rows',
        reason: 'api_cdp_reuse_requires_r5_gate',
        proofGate: 'r5_required',
        sourceRouteCandidate: 'cdp_source_with_fact_evidence',
        apiCdpReuseProven: false,
      });
      expect(payload.apiCdpProofBoundary).toMatchObject({
        proofStatus: 'requires_r5_gate',
        apiCdpReuseProven: false,
        selectedDataSource: 'cdp_enhanced_api_rows',
        sourceRouteCandidate: 'cdp_source_with_fact_evidence',
        reason: 'api_cdp_reuse_requires_r5_gate',
        notSafeClaim:
          'Do not claim API proven, CDP proven, API reuse, CDP reuse, or product delivery grade.',
      });
      expect(payload.aiContextEnvelope.apiCdpProofBoundary).toMatchObject({
        proofStatus: 'requires_r5_gate',
        apiCdpReuseProven: false,
        selectedDataSource: 'cdp_enhanced_api_rows',
        sourceRouteCandidate: 'cdp_source_with_fact_evidence',
      });
      expect(JSON.stringify(payload.sourceRouteHonesty)).not.toContain('cdp_proven');
      expect(JSON.stringify(payload.aiContextEnvelope.sourceRouteHonesty)).not.toContain(
        'cdp_proven',
      );
      expect(JSON.stringify(payload.apiCdpProofBoundary)).not.toContain('cdp_proven');
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
              sourceTabId: 12,
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
          tabId: 12,
          ownerType: 'user_owned',
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 12,
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
      expect(payload.pageProjection).toMatchObject({
        chosenDataSource: 'dom_region_rows',
        sourceLineage: 'dom',
        ownerType: 'user_owned',
      });
      expect(payload.ownershipRuntime).toMatchObject({
        currentTabId: 12,
        currentOwnerType: 'user_owned',
        isCurrentTabRunOwnedByTask: false,
      });
    });

    it('falls back to the projection tab when the visible-row source tab is missing', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('unknown-owner-search-rows');
      ctx.noteVisibleRegionRows({
        sourceDataSource: 'dom_region_rows',
        sourceTabId: 0,
        available: true,
        rowCount: 2,
        confidence: 0.9,
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
        ],
        visibleRegionRowsUsed: true,
        visibleRegionRowsRejectedReason: null,
        sourceRegion: 'visible_results',
        rowExtractionConfidence: 0.9,
        targetRefCoverageRate: 1,
        regionQualityScore: 0.96,
        cardExtractorUsed: false,
        cardPatternConfidence: 0,
        cardRowsCount: 0,
        rowOrder: 'visual_order',
      });
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_unknown_owner',
          contextChars: 1200,
          changedRegions: ['viewport'],
          selectedDataSource: 'markdown',
          ownerType: 'unknown',
          extraPayload: {
            markdown: '# Repository search results',
            decisionReason: 'markdown_reading_surface_preferred',
            apiRowsUnavailableReason: 'api_rows_unavailable_dom_region_rows_available',
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'unknown-owner-search-rows',
        requestedLayer: 'L0+L1+L2',
        render: 'markdown',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.pageProjection).toMatchObject({
        ownerType: 'user_owned',
      });
      expect(payload.ownershipRuntime).toMatchObject({
        currentTabId: 1,
        currentOwnerType: 'user_owned',
        currentTabRunOwnershipVerdict: 'not_run_owned_by_task',
      });
    });

    it('surfaces run-owned ownership truth for DOM rows selected into AI context', async () => {
      markBridgeReady();
      bridgeRuntimeState.setPrimaryTabSnapshot({
        primaryTabId: 9,
        primaryTabReuseRate: 1,
        benchmarkOwnedTabCount: 1,
      });
      bridgeRuntimeState.recordHeartbeat({
        tabCount: 6,
        windowCount: 1,
      });
      const ctx = sessionManager.getOrCreateExternalTaskContext('run-owned-search-rows');
      ctx.noteRunOwnedTab(9);
      ctx.noteVisibleRegionRows({
        sourceDataSource: 'dom_region_rows',
        sourceTabId: 9,
        available: true,
        rowCount: 2,
        confidence: 0.9,
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
        visibleRegionRowsUsed: true,
        visibleRegionRowsRejectedReason: null,
        sourceRegion: 'visible_results',
        rowExtractionConfidence: 0.9,
        targetRefCoverageRate: 0.99,
        regionQualityScore: 0.96,
        cardExtractorUsed: false,
        cardPatternConfidence: 0,
        cardRowsCount: 0,
        rowOrder: 'visual_order',
      });
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_run_owned_search_rows',
          contextChars: 1200,
          changedRegions: ['viewport'],
          refreshedRefs: ['ref_repo_1', 'ref_repo_2'],
          tabId: 9,
          selectedDataSource: 'markdown',
          extraPayload: {
            markdown: '# Repository search results',
            decisionReason: 'markdown_reading_surface_preferred',
            apiRowsUnavailableReason: 'api_rows_unavailable_dom_region_rows_available',
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 9,
        taskSessionId: 'run-owned-search-rows',
        requestedLayer: 'L0+L1+L2',
        render: 'markdown',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.pageProjection).toMatchObject({
        ownerType: 'run_owned',
      });
      expect(payload.ownershipRuntime).toMatchObject({
        currentTabId: 9,
        currentWindowId: 3,
        isCurrentTabActive: true,
        isCurrentWindowFocused: true,
        currentOwnerType: 'run_owned',
        currentTabRunOwnershipVerdict: 'run_owned_by_task',
        currentTabPrimaryRelationVerdict: 'current_tab_is_primary',
        protectedScopeVerdict: 'protected',
        cleanupEligibility: 'not_eligible',
        protectReason: 'current_tab_is_primary',
        isCurrentTabRunOwnedByTask: true,
        runOwnedTabIds: [9],
        runOwnedTabCount: 1,
        defaultProtection: 'protect_unknown_and_user_owned',
        bridgeState: 'READY',
        primaryTabId: 9,
        primaryTabReuseRate: 1,
        benchmarkOwnedTabCount: 1,
        heartbeatTabCount: 6,
        heartbeatWindowCount: 1,
      });
    });

    it('surfaces user-owned ownership summary when the current tab is not run-owned', async () => {
      markBridgeReady();
      bridgeRuntimeState.setPrimaryTabSnapshot({
        primaryTabId: 12,
        primaryTabReuseRate: 0.75,
        benchmarkOwnedTabCount: 3,
      });
      bridgeRuntimeState.recordHeartbeat({
        tabCount: 8,
        windowCount: 2,
      });
      const ctx = sessionManager.getOrCreateExternalTaskContext('user-owned-search-rows');
      ctx.noteRunOwnedTab(9);
      ctx.noteVisibleRegionRows({
        sourceDataSource: 'dom_region_rows',
        sourceTabId: 12,
        available: true,
        rowCount: 1,
        confidence: 0.88,
        rows: [
          {
            title: 'User-owned result',
            primaryText: 'User-owned row',
            secondaryText: null,
            metaText: null,
            targetRef: 'ref_user_owned_1',
            sourceRegion: 'visible_results',
            confidence: 0.88,
          },
          {
            title: 'User-owned result 2',
            primaryText: 'Second user-owned row',
            secondaryText: null,
            metaText: null,
            targetRef: 'ref_user_owned_2',
            sourceRegion: 'visible_results',
            confidence: 0.88,
          },
        ],
        visibleRegionRowsUsed: true,
        visibleRegionRowsRejectedReason: null,
        sourceRegion: 'visible_results',
        rowExtractionConfidence: 0.88,
        targetRefCoverageRate: 0.95,
        regionQualityScore: 0.9,
        cardExtractorUsed: false,
        cardPatternConfidence: 0,
        cardRowsCount: 0,
        rowOrder: 'visual_order',
      });
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_user_owned_search_rows',
          contextChars: 900,
          changedRegions: ['viewport'],
          tabId: 12,
          selectedDataSource: 'dom_region_rows',
          projectionDataSource: 'dom_region_rows',
          ownerType: 'unknown',
          extraPayload: {
            visibleRegionRows: {
              sourceDataSource: 'dom_region_rows',
              sourceTabId: 12,
              rows: [
                {
                  title: 'User-owned result',
                  primaryText: 'User-owned row',
                  secondaryText: null,
                  metaText: null,
                  targetRef: 'ref_user_owned_1',
                  sourceRegion: 'visible_results',
                  confidence: 0.88,
                },
                {
                  title: 'User-owned result 2',
                  primaryText: 'Second user-owned row',
                  secondaryText: null,
                  metaText: null,
                  targetRef: 'ref_user_owned_2',
                  sourceRegion: 'visible_results',
                  confidence: 0.88,
                },
              ],
              rowCount: 2,
              visibleRegionRowsUsed: true,
              visibleRegionRowsRejectedReason: null,
              sourceRegion: 'visible_results',
              rowExtractionConfidence: 0.88,
              targetRefCoverageRate: 0.95,
              regionQualityScore: 0.9,
              cardExtractorUsed: false,
              cardPatternConfidence: 0,
              cardRowsCount: 0,
            },
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 12,
        taskSessionId: 'user-owned-search-rows',
        requestedLayer: 'L0+L1+L2',
        render: 'markdown',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.aiContextEnvelope).toMatchObject({
        selectedDataSource: 'dom_region_rows',
      });
      expect(payload.pageProjection).toMatchObject({
        chosenDataSource: 'dom_region_rows',
        ownerType: 'user_owned',
      });
      expect(payload.ownershipRuntime).toMatchObject({
        currentTabId: 12,
        currentWindowId: 3,
        isCurrentTabActive: true,
        isCurrentWindowFocused: true,
        currentOwnerType: 'user_owned',
        currentTabRunOwnershipVerdict: 'not_run_owned_by_task',
        currentTabPrimaryRelationVerdict: 'current_tab_is_primary',
        protectedScopeVerdict: 'protected',
        cleanupEligibility: 'not_eligible',
        protectReason: 'not_run_owned_by_task',
        isCurrentTabRunOwnedByTask: false,
        runOwnedTabIds: [9],
        runOwnedTabCount: 1,
        primaryTabId: 12,
        primaryTabReuseRate: 0.75,
        benchmarkOwnedTabCount: 3,
        heartbeatTabCount: 8,
        heartbeatWindowCount: 2,
      });
    });

    it('surfaces eligible cleanup for a run-owned tab that differs from the primary tab', async () => {
      markBridgeReady();
      bridgeRuntimeState.setPrimaryTabSnapshot({
        primaryTabId: 12,
        primaryTabReuseRate: 0.75,
        benchmarkOwnedTabCount: 3,
      });
      bridgeRuntimeState.recordHeartbeat({
        tabCount: 8,
        windowCount: 2,
      });
      const ctx = sessionManager.getOrCreateExternalTaskContext(
        'run-owned-non-primary-search-rows',
      );
      ctx.noteRunOwnedTab(9);
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_run_owned_non_primary_search_rows',
          contextChars: 900,
          changedRegions: ['viewport'],
          tabId: 9,
          selectedDataSource: 'markdown',
          ownerType: 'unknown',
          extraPayload: {
            markdown: '# Run-owned non-primary page',
            decisionReason: 'markdown_reading_surface_preferred',
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 9,
        taskSessionId: 'run-owned-non-primary-search-rows',
        requestedLayer: 'L0+L1+L2',
        render: 'markdown',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.pageProjection).toMatchObject({
        ownerType: 'run_owned',
      });
      expect(payload.ownershipRuntime).toMatchObject({
        currentTabId: 9,
        currentWindowId: 3,
        isCurrentTabActive: true,
        isCurrentWindowFocused: true,
        currentOwnerType: 'run_owned',
        currentTabRunOwnershipVerdict: 'run_owned_by_task',
        currentTabPrimaryRelationVerdict: 'current_tab_differs_from_primary',
        protectedScopeVerdict: 'not_protected',
        cleanupEligibility: 'eligible',
        protectReason: null,
        isCurrentTabRunOwnedByTask: true,
        runOwnedTabIds: [9],
        runOwnedTabCount: 1,
        primaryTabId: 12,
        primaryTabReuseRate: 0.75,
        benchmarkOwnedTabCount: 3,
        heartbeatTabCount: 8,
        heartbeatWindowCount: 2,
      });
    });

    it('keeps ownerType consistent between pageProjection and ownershipRuntime on markdown path', async () => {
      markBridgeReady();
      bridgeRuntimeState.setPrimaryTabSnapshot({
        primaryTabId: 5,
        primaryTabReuseRate: 1,
        benchmarkOwnedTabCount: 2,
      });
      bridgeRuntimeState.recordHeartbeat({
        tabCount: 4,
        windowCount: 1,
      });
      const ctx = sessionManager.getOrCreateExternalTaskContext('markdown-user-owned-consistency');
      ctx.noteRunOwnedTab(5);
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_markdown_user_owned',
          contextChars: 600,
          changedRegions: ['viewport'],
          tabId: 7,
          selectedDataSource: 'markdown',
          ownerType: 'unknown',
          extraPayload: {
            markdown: '# User tab content',
            decisionReason: 'markdown_reading_surface_preferred',
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 7,
        taskSessionId: 'markdown-user-owned-consistency',
        requestedLayer: 'L0+L1+L2',
        render: 'markdown',
      });
      const payload = JSON.parse(String(result.content[0].text));

      // Tab 7 is NOT run-owned (only tab 5 is) →
      // both pageProjection.ownerType and ownershipRuntime.currentOwnerType must agree
      expect(payload.pageProjection.ownerType).toBe('user_owned');
      expect(payload.ownershipRuntime.currentOwnerType).toBe(payload.pageProjection.ownerType);
      expect(payload.ownershipRuntime).toMatchObject({
        currentTabId: 7,
        currentOwnerType: 'user_owned',
        currentTabRunOwnershipVerdict: 'not_run_owned_by_task',
        isCurrentTabRunOwnedByTask: false,
        runOwnedTabIds: [5],
        runOwnedTabCount: 1,
        defaultProtection: 'protect_unknown_and_user_owned',
      });
    });

    it('degrades ownership summary to unknown when the current tab cannot be trusted', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('unknown-summary-search-rows');
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_unknown_summary_search_rows',
          contextChars: 700,
          changedRegions: ['viewport'],
          tabId: -1,
          selectedDataSource: 'markdown',
          ownerType: 'unknown',
          extraPayload: {
            currentWindowId: null,
            isCurrentTabActive: null,
            isCurrentWindowFocused: null,
          },
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 0,
        taskSessionId: 'unknown-summary-search-rows',
        requestedLayer: 'L0+L1+L2',
        render: 'markdown',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.ownershipRuntime).toMatchObject({
        currentTabId: null,
        currentWindowId: null,
        isCurrentTabActive: null,
        isCurrentWindowFocused: null,
        currentOwnerType: 'unknown',
        currentTabRunOwnershipVerdict: 'unknown',
        currentTabPrimaryRelationVerdict: 'current_tab_unknown',
        protectedScopeVerdict: 'unknown',
        cleanupEligibility: 'unknown',
        protectReason: 'current_tab_unknown',
        isCurrentTabRunOwnedByTask: false,
        runOwnedTabIds: [],
        runOwnedTabCount: 0,
        defaultProtection: 'protect_unknown_and_user_owned',
      });
      expect(ctx.getRunOwnedTabIds()).toEqual([]);
    });

    it('drops stale run-owned summary after cleanup releases the tab', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('cleanup-owned-search-rows');
      ctx.noteRunOwnedTab(21);
      ctx.releaseRunOwnedTab(21);
      mockReadPageRoundTrip(
        readPagePayloadWithProjection({
          projectionId: 'projection_cleanup_owned_search_rows',
          contextChars: 850,
          changedRegions: ['viewport'],
          tabId: 21,
          selectedDataSource: 'markdown',
          ownerType: 'unknown',
        }),
      );

      const result = await handleToolCall('chrome_read_page', {
        tabId: 21,
        taskSessionId: 'cleanup-owned-search-rows',
        requestedLayer: 'L0+L1+L2',
        render: 'markdown',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.pageProjection).toMatchObject({
        ownerType: 'user_owned',
      });
      expect(payload.ownershipRuntime).toMatchObject({
        currentTabId: 21,
        currentOwnerType: 'user_owned',
        currentTabRunOwnershipVerdict: 'not_run_owned_by_task',
        currentTabPrimaryRelationVerdict: 'primary_tab_unknown',
        protectedScopeVerdict: 'protected',
        cleanupEligibility: 'not_eligible',
        protectReason: 'not_run_owned_by_task',
        isCurrentTabRunOwnedByTask: false,
        runOwnedTabIds: [],
        runOwnedTabCount: 0,
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
      expect(payload.currentWindowId).toBeUndefined();
      expect(payload.isCurrentTabActive).toBeUndefined();
      expect(payload.isCurrentWindowFocused).toBeUndefined();
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

    it('omitting both fields defaults to L0+L1 (matches MCP schema)', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('default-layer');
      Object.defineProperty(ctx, 'readBudget', { value: 4, writable: false });

      mockReadPageRoundTrip('default-layer');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        taskSessionId: 'default-layer',
      });
      expect(ctx.lastReadLayer).toBe('L0+L1');
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
      expect(ctx.lastReadLayer).toBe('L0+L1');
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

    function readPagePayloadWithRegions(input: {
      projectionId: string;
      tabId: number;
      pageRegions: Array<Record<string, unknown>>;
      pageContext?: Record<string, unknown>;
      includeTopNRows?: boolean;
      sourceFreshness?: 'fresh' | 'stale' | 'unknown';
      sourceObservedAt?: string;
      authCollaboration?: Record<string, unknown>;
    }): string {
      const sourceObservedAt = input.sourceObservedAt ?? new Date(Date.now()).toISOString();
      const topNRows = Array.from({ length: 10 }, (_, index) => {
        const n = index + 1;
        return {
          rowId: `row_${n}`,
          title: `Result ${n}`,
          primaryText: `Result ${n} summary`,
          secondaryText: null,
          metaText: null,
          interactionText: 'Open',
          targetRef: `ref_result_${n}`,
          visibleTextFields: ['title', 'primaryText'],
          qualityReasons: [],
          sourceRegion: 'result_list',
          confidence: 0.91,
        };
      });
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
        currentWindowId: 3,
        isCurrentTabActive: true,
        isCurrentWindowFocused: true,
        ...(input.includeTopNRows
          ? {
              visibleRegionRowsUsed: true,
              visibleRegionRowCount: topNRows.length,
              rowCount: topNRows.length,
              rows: topNRows,
              targetRefCoverageRate: 1,
              regionQualityScore: 0.9,
              rowExtractionConfidence: 0.92,
              sourceRegion: 'result_list',
              sourceTabId: input.tabId,
            }
          : {}),
        ...(input.pageContext ? { pageContext: input.pageContext } : {}),
        ...(input.authCollaboration ? { authCollaboration: input.authCollaboration } : {}),
        pageRegions: input.pageRegions,
        objectLifecycle: {
          source: 'read_page_regions',
          status: 'single_snapshot',
          objectCount: 0,
          changedObjectCount: 0,
          items: [],
          changes: [],
          claimBoundary: 'test lifecycle',
        },
        pageProjection: {
          projectionId: input.projectionId,
          projectionKind: 'read_snapshot_projection',
          pageId: `tab:${input.tabId}`,
          tabId: input.tabId,
          ownerType: 'run_owned',
          projectionCreatedAt: sourceObservedAt,
          sourceObservedAt,
          sourceLineage: 'dom',
          regionEvidenceRefs: ['region:results'],
          readiness: 'ready',
          stability: 'stable',
          contextVersion: input.projectionId,
          previousContextVersion: null,
          changedByActionId: null,
          changeCause: 'unknown',
          activeRegion: 'results',
          changedRegions: ['results'],
          reusedRegions: [],
          invalidatedRefs: [],
          refreshedRefs: ['ref_result_1', 'ref_result_2'],
          chosenDataSource: 'dom_json',
          sourceConfidence: 0.9,
          sourceFreshness: input.sourceFreshness ?? 'fresh',
          contextChars: 1200,
          contextSavedChars: 0,
          userActivityLevel: 'idle',
          interferenceRisk: 'low',
        },
      });
    }

    function pageContextWithLoadReadiness(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        loadReadiness: {
          status: 'stable',
          pageStability: 'stable',
          canUseSnapshotForBusinessAction: true,
          nextStepHint: 'snapshot_ready_for_business_action',
          claimBoundary: 'test load readiness',
          ...overrides,
        },
      };
    }

    function contentListRegion(refPrefix: string): Record<string, unknown> {
      return {
        regionId: 'region_results',
        regionType: 'content',
        state: `results_${refPrefix}`,
        confidence: 0.86,
        objects: [1, 2].map((index) => ({
          objectId: `${refPrefix}_${index}`,
          label: index === 1 ? 'Alpha shared insight' : 'Beta shared insight',
          objectType: 'record',
          targetRef: `ref_${refPrefix}_${index}`,
          actionTypes: ['click'],
          targetability: 'target_ref',
          confidence: 0.82,
          reason: 'test result row',
        })),
        candidateActionIds: [`ca_${refPrefix}_1`, `ca_${refPrefix}_2`],
        targetability: 'target_ref',
        claimBoundary: 'test content-list region',
      };
    }

    function weakContentListRegion(refPrefix: string): Record<string, unknown> {
      return {
        regionId: 'region_results',
        regionType: 'content',
        state: `results_${refPrefix}`,
        confidence: 0.78,
        objects: [
          {
            objectId: `${refPrefix}_text_only`,
            label: 'result text only',
            objectType: 'doc_block',
            actionTypes: [],
            targetability: 'not_clickable',
            confidence: 0.72,
            reason: 'test weak result row without target ref',
          },
        ],
        candidateActionIds: [`ca_${refPrefix}_1`, `ca_${refPrefix}_2`],
        targetability: 'locator_chain',
        claimBoundary: 'test weak content-list region',
      };
    }

    function authPromptRegion(): Record<string, unknown> {
      return {
        regionId: 'region_auth',
        regionType: 'modal',
        state: 'open_candidate',
        confidence: 0.84,
        objects: [
          {
            objectId: 'auth_submit',
            label: 'login',
            objectType: 'button',
            targetRef: 'ref_auth_submit',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.86,
            reason: 'test auth submit control',
          },
        ],
        candidateActionIds: ['ca_auth_submit'],
        targetability: 'target_ref',
        claimBoundary: 'test auth prompt region',
      };
    }

    function accountRegion(): Record<string, unknown> {
      return {
        regionId: 'region_account',
        regionType: 'account',
        state: 'logged_in_candidate',
        confidence: 0.88,
        objects: [
          {
            objectId: 'account_state',
            label: 'account present',
            objectType: 'status',
            actionTypes: [],
            targetability: 'not_clickable',
            confidence: 0.82,
            reason: 'test account state',
          },
        ],
        candidateActionIds: [],
        targetability: 'not_clickable',
        claimBoundary: 'test account region',
      };
    }

    function otpAuthCollaboration(input: {
      readiness: 'ready_to_request_otp' | 'waiting_for_user_otp' | 'not_proven';
      requestOtpState: 'visible' | 'countdown' | 'unknown';
    }): Record<string, unknown> {
      return {
        status: 'required',
        challengeType: 'otp',
        userAction: {
          message: 'Please complete the OTP login collaboration.',
          artifactRefs: [],
        },
        evidence: {
          pageFreshness: 'single_snapshot',
          operationBinding: 'ai_operable_tab',
          artifactExtractionEligibility: 'unknown',
          actionOperability: 'operable',
          semanticEventTypes: [],
          postconditionStatus: 'not_evaluated',
          claimBoundary: 'test auth collaboration evidence',
        },
        authForm: {
          formType: 'otp',
          readiness: input.readiness,
          nextAction:
            input.readiness === 'waiting_for_user_otp' ? 'wait_for_user_otp' : 'request_otp',
          controls: {
            requestOtp: {
              role: 'button',
              label: 'auth request otp control',
              targetRef: 'ref_request_otp',
              candidateActionId: 'ca_request_otp',
              confidence: 0.9,
              reason: 'test request OTP control',
              state: input.requestOtpState,
              actionability:
                input.requestOtpState === 'countdown' ? 'not_actionable' : 'actionable',
            },
            otpInput: {
              role: 'textbox',
              label: 'auth otp input',
              targetRef: 'ref_otp_input',
              confidence: 0.82,
              reason: 'test OTP input',
              state: 'visible',
              valueState: 'empty',
              actionability: 'actionable',
            },
          },
          blockers: [],
          claimBoundary: 'test auth form',
        },
        claimBoundary: 'test auth collaboration',
      };
    }

    function contentDetailRegion(refPrefix: string): Record<string, unknown> {
      return {
        regionId: 'region_detail',
        regionType: 'content',
        state: `detail_${refPrefix}`,
        confidence: 0.88,
        objects: [
          {
            objectId: `${refPrefix}_detail_title`,
            label: 'Alpha shared insight',
            objectType: 'title',
            actionTypes: [],
            targetability: 'not_targetable',
            confidence: 0.84,
            reason: 'test detail title',
          },
          {
            objectId: `${refPrefix}_detail_body`,
            label: 'Alpha shared insight detail',
            objectType: 'record',
            actionTypes: [],
            targetability: 'not_targetable',
            confidence: 0.84,
            reason: 'test detail body',
          },
        ],
        candidateActionIds: [],
        targetability: 'not_targetable',
        claimBoundary: 'test content-detail region',
      };
    }

    function weakContentDetailRegion(refPrefix: string): Record<string, unknown> {
      return {
        regionId: 'region_detail',
        regionType: 'content',
        state: `detail_${refPrefix}`,
        confidence: 0.72,
        objects: [],
        candidateActionIds: [],
        targetability: 'not_clickable',
        claimBoundary: 'test weak content-detail region',
      };
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
      expect(payload.currentWindowId).toBeUndefined();
      expect(payload.isCurrentTabActive).toBeUndefined();
      expect(payload.isCurrentWindowFocused).toBeUndefined();
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

    it('chrome_navigate refresh invalidates redundancy state for the next default-shape read', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:91');
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip('before-refresh');
      await handleToolCall('chrome_read_page', { tabId: 91, requestedLayer: 'L0+L1' });
      expect(auto.lastReadLayer).toBe('L0+L1');

      mockNavigateRoundTrip('refreshed', 91);
      await handleToolCall('chrome_navigate', { tabId: 91, refresh: true });
      expect(auto.lastReadLayer).toBeNull();

      mockReadPageRoundTrip('after-refresh');
      const result = await handleToolCall('chrome_read_page', {
        tabId: 91,
        requestedLayer: 'L0+L1',
      });
      expect(result.isError).toBeFalsy();
      expect(auto.lastReadLayer).toBe('L0+L1');
      expect(auto.readPageCount).toBe(2);
    });

    it('records run-owned identity on the returned tab auto context for new-tab navigation', async () => {
      markBridgeReady();

      mockNavigateRoundTrip('opened', 77);
      await handleToolCall('chrome_navigate', { url: 'https://example.test/new-tab' });

      const returnedTabContext = sessionManager.peekExternalTaskContext('mcp:auto:tab:77');
      expect(returnedTabContext).not.toBeNull();
      expect(returnedTabContext?.isRunOwnedTab(77)).toBe(true);
      expect(returnedTabContext?.getRunOwnedTabIds()).toEqual([77]);
    });

    it('new focused navigation invalidates cached reads for other tab contexts', async () => {
      markBridgeReady();
      const existingTabContext = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:10');
      Object.defineProperty(existingTabContext, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip('before-focus-change');
      await handleToolCall('chrome_read_page', { tabId: 10, requestedLayer: 'L0+L1' });
      expect(existingTabContext.lastReadLayer).toBe('L0+L1');

      mockNavigateRoundTrip('opened-focused-window', 88);
      await handleToolCall('chrome_navigate', {
        url: 'https://example.test/focused-window',
        newWindow: true,
      });
      expect(existingTabContext.lastReadLayer).toBeNull();

      mockReadPageRoundTrip('after-focus-change');
      const afterFocusChangeRead = await handleToolCall('chrome_read_page', {
        tabId: 10,
        requestedLayer: 'L0+L1',
      });
      expect(String(afterFocusChangeRead.content[0].text)).toBe('after-focus-change');
      expect(existingTabContext.lastReadLayer).toBe('L0+L1');
      expect(existingTabContext.readPageCount).toBe(2);
    });

    it('reuses the returned tab auto context for explicit close_tabs cleanup', async () => {
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
                  closedTabIds: [77],
                  invalidTabIds: [],
                }),
              },
            ],
            isError: false,
          },
        } as never);

      await handleToolCall('chrome_navigate', { url: 'https://example.test/new-tab' });
      const closeResult = await handleToolCall('chrome_close_tabs', { tabIds: [77] });
      const closePayload = JSON.parse(String(closeResult.content[0].text));

      expect(closeResult.isError).toBe(false);
      expect(closePayload.taskContextEnvelope).toMatchObject({
        taskContextKey: 'mcp:auto:tab:77',
        taskContextKeySource: 'external_task_key',
        toolName: 'chrome_close_tabs',
      });
      expect(closePayload.runtimePolicyAudit).toMatchObject({
        verdict: 'allow',
        reason: 'run_owned_tab',
        targetTabIds: [77],
        runOwnedTabIds: [77],
      });
      expect(sessionManager.peekExternalTaskContext('mcp:auto:tab:77')).toBeNull();
    });

    it('marks web-fetcher-created tabs as run-owned for explicit close_tabs cleanup', async () => {
      markBridgeReady();
      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  tabId: 78,
                  createdTabForUrl: true,
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
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  closedTabIds: [78],
                  invalidTabIds: [],
                }),
              },
            ],
            isError: false,
          },
        } as never);

      await handleToolCall('chrome_get_web_content', { url: 'https://example.test/list' });
      const closeResult = await handleToolCall('chrome_close_tabs', { tabIds: [78] });
      const closePayload = JSON.parse(String(closeResult.content[0].text));

      expect(closeResult.isError).toBe(false);
      expect(closePayload.taskContextEnvelope).toMatchObject({
        taskContextKey: 'mcp:auto:tab:78',
        taskContextKeySource: 'external_task_key',
        toolName: 'chrome_close_tabs',
      });
      expect(closePayload.runtimePolicyAudit).toMatchObject({
        verdict: 'allow',
        reason: 'run_owned_tab',
        targetTabIds: [78],
        runOwnedTabIds: [78],
      });
      expect(sessionManager.peekExternalTaskContext('mcp:auto:tab:78')).toBeNull();
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

    it('switch_tab invalidates cached read state so Tab activity is re-observed', async () => {
      markBridgeReady();
      const ctx = sessionManager.getOrCreateExternalTaskContext('switch-tab-task');
      ctx.noteRunOwnedTab(9);
      Object.defineProperty(ctx, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip('before-switch');
      await handleToolCall('chrome_read_page', {
        tabId: 9,
        taskSessionId: 'switch-tab-task',
        requestedLayer: 'L0+L1',
      });
      expect(ctx.lastReadLayer).toBe('L0+L1');

      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  tabId: 9,
                  windowId: 3,
                  activated: true,
                  windowFocused: true,
                  settled: true,
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_switch_tab', {
        tabId: 9,
        taskSessionId: 'switch-tab-task',
      });
      expect(ctx.lastReadLayer).toBeNull();

      mockReadPageRoundTrip('after-switch');
      const result = await handleToolCall('chrome_read_page', {
        tabId: 9,
        taskSessionId: 'switch-tab-task',
        requestedLayer: 'L0+L1',
      });
      expect(String(result.content[0].text)).toBe('after-switch');
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

    it('auto-keyed switch_tab invalidates same-tab read state', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:9');
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip('auto-before-switch');
      await handleToolCall('chrome_read_page', {
        tabId: 9,
        requestedLayer: 'L0+L1',
      });
      expect(auto.lastReadLayer).toBe('L0+L1');

      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  tabId: 9,
                  windowId: 3,
                  activated: true,
                  windowFocused: true,
                  settled: true,
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_switch_tab', { tabId: 9 });
      expect(auto.lastReadLayer).toBeNull();

      mockReadPageRoundTrip('auto-after-switch');
      const result = await handleToolCall('chrome_read_page', {
        tabId: 9,
        requestedLayer: 'L0+L1',
      });
      expect(String(result.content[0].text)).toBe('auto-after-switch');
      expect(auto.readPageCount).toBe(2);
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

    it('auto-keyed click invalidates same-tab read state for post-action verification', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip('before-click');
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      expect(auto.lastReadLayer).toBe('L0+L1');

      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: { content: [{ type: 'text', text: 'clicked' }], isError: false },
        } as never);
      await handleToolCall('chrome_click_element', { tabId: 1, ref: 'ref_42' });
      expect(auto.lastReadLayer).toBeNull();

      mockReadPageRoundTrip('after-click');
      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      expect(String(result.content[0].text)).toBe('after-click');
      expect(auto.readPageCount).toBe(2);
    });

    it('allows fill-then-click form continuation on a run-owned tab before final readback', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  valueState: 'non_empty',
                  valueLength: 6,
                }),
              },
            ],
            isError: false,
          },
        } as never);
      const fill = await handleToolCall('chrome_fill_or_select', {
        tabId: 1,
        ref: 'ref_search_input',
        value: 'poster',
        candidateAction: {
          id: 'ca_fill_search',
          actionType: 'fill',
          targetRef: 'ref_search_input',
          confidence: 0.91,
          matchReason: 'search input candidate',
          locatorChain: [{ type: 'ref', value: 'ref_search_input' }],
          intent: 'search.enter_query',
        },
      });
      expect(fill.isError).toBeFalsy();
      expect(auto.buildTaskResumeReadiness({ tabId: 1 })).toMatchObject({
        status: 'postcondition_unknown_not_proven',
        reason:
          'pending_business_verification_requires_fresh_read:form_value_state_changed:search.enter_query',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'spa_partial_update',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      const click = await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_search_submit',
        candidateAction: {
          id: 'ca_search_submit',
          actionType: 'click',
          targetRef: 'ref_search_submit',
          confidence: 0.91,
          matchReason: 'search submit candidate',
          locatorChain: [{ type: 'ref', value: 'ref_search_submit' }],
          intent: 'search.submit',
        },
      });
      expect(click.isError).toBeFalsy();
      const clickPayload = JSON.parse(String(click.content[0].text));
      expect(clickPayload.runtimePolicyAudit).toMatchObject({
        verdict: 'allow',
        reason: 'form_input_continuation_action',
        targetTabId: 1,
      });
    });

    it('does not record blocked click dispatch as pending page interaction', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  dispatchSucceeded: false,
                  observedOutcome: 'no_observed_change',
                  error: 'blocked_by_overlay',
                  targetConsistency: { verdict: 'blocked_by_overlay' },
                }),
              },
            ],
            isError: true,
          },
        } as never);
      const blocked = await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_search_submit',
        candidateAction: {
          id: 'ca_search_submit',
          actionType: 'click',
          targetRef: 'ref_search_submit',
          confidence: 0.91,
          matchReason: 'search submit candidate',
          locatorChain: [{ type: 'ref', value: 'ref_search_submit' }],
          intent: 'search.submit',
        },
      });
      expect(blocked.isError).toBe(true);
      expect(auto.buildTaskResumeReadiness({ tabId: 1 }).reason).not.toContain(
        'pending_business_verification_requires_fresh_read',
      );

      const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');
      bridgeSpy.mockClear();
      bridgeSpy
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'corrected_click_after_blocked_target',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      const corrected = await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_search_submit',
        candidateAction: {
          id: 'ca_search_submit_retry',
          actionType: 'click',
          targetRef: 'ref_search_submit',
          confidence: 0.91,
          matchReason: 'search submit retry candidate',
          locatorChain: [{ type: 'ref', value: 'ref_search_submit' }],
          intent: 'search.submit',
        },
      });
      const correctedPayload = JSON.parse(String(corrected.content[0].text));

      expect(corrected.isError).toBe(false);
      expect(correctedPayload).toMatchObject({
        success: true,
        observedOutcome: 'corrected_click_after_blocked_target',
      });
      expect(correctedPayload.runtimePolicyAudit).toMatchObject({
        verdict: 'allow',
        reason: 'run_owned_tab',
        targetTabId: 1,
      });
      expect(bridgeSpy).toHaveBeenCalledTimes(2);
    });

    it('fresh read after a search submit candidate carries region-state postcondition evidence into closeout', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_search_submit',
          tabId: 1,
          pageRegions: [contentListRegion('before')],
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'spa_partial_update',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_search_submit',
        candidateAction: {
          id: 'ca_search_submit',
          actionType: 'click',
          targetRef: 'ref_search_submit',
          confidence: 0.91,
          matchReason: 'search submit candidate',
          locatorChain: [{ type: 'ref', value: 'ref_search_submit' }],
          intent: 'search.submit',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_search_submit',
          tabId: 1,
          pageRegions: [contentListRegion('after')],
          includeTopNRows: true,
        }),
      );
      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_search_submit',
            kind: 'search_results_updated',
            verdict: 'passed',
            reason: 'result_collection_changed_after_action',
          }),
        },
      ]);
      expect(payload.aiContextEnvelope.regionStatePostconditions).toEqual(
        payload.regionStatePostconditions,
      );
      expect(payload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_passed_ready',
        canResumeOriginalTask: true,
        nextStep: 'continue_original_task',
        tabId: 1,
        reason: 'region_state_search_results_updated_passed:result_collection_changed_after_action',
        handoffSummary: {
          summaryKind: 'task_resume_handoff_v1',
          status: 'ready_to_continue',
          canContinue: true,
          nextAction: 'continue_original_task',
        },
      });
      expect(payload.aiContextEnvelope.taskResumeReadiness).toEqual(payload.taskResumeReadiness);
      expect(auto.readPageCount).toBe(2);

      jest
        .spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait')
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  closedTabIds: [1],
                  browserHygieneEvidence: {
                    kind: 'close_tabs_hygiene_v1',
                    before: {
                      tabCount: 2,
                      windowCount: 1,
                      focusedWindowId: 10,
                      activeTabId: 1,
                    },
                    after: {
                      tabCount: 1,
                      windowCount: 1,
                      focusedWindowId: 10,
                      activeTabId: 2,
                    },
                    closedTabIds: [1],
                    invalidTabIds: [],
                    tabWindowBaselineUnchanged: true,
                    activeTabRestored: true,
                    activeTabRestoreReason: 'active_tab_restored_to_surviving_tab',
                  },
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_close_tabs', {
        tabIds: [1],
      });

      const artifacts = listLifecycleEvidenceArtifacts();
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0].browserHygiene.notes).toEqual(
        expect.arrayContaining([
          'taskResumeReadinessStatus=postcondition_passed_ready',
          'taskResumeCanContinue=true',
          'taskResumeHandoffStatus=ready_to_continue',
          'taskResumeHandoffNextAction=continue_original_task',
        ]),
      );
      expect(artifacts[0].actionLog.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionId: 'ca_search_submit',
            actionKind: 'click',
            verdict: 'passed',
            reason: expect.stringContaining('top_n_accumulation:status=ready_for_default_top_n'),
          }),
        ]),
      );
    });

    it('fresh read after an auth submit candidate proves login only when the auth prompt disappears and account state appears', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_auth_submit',
          tabId: 1,
          pageRegions: [authPromptRegion()],
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'modal_closed',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_auth_submit',
        candidateAction: {
          id: 'ca_auth_submit',
          actionType: 'click',
          targetRef: 'ref_auth_submit',
          confidence: 0.91,
          matchReason: 'auth submit candidate',
          locatorChain: [{ type: 'ref', value: 'ref_auth_submit' }],
          intent: 'auth.submit_login',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_auth_submit',
          tabId: 1,
          pageRegions: [accountRegion()],
        }),
      );
      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_auth_submit',
            kind: 'login_completed',
            verdict: 'passed',
            reason: 'account_region_appeared_after_auth_prompt',
          }),
        },
      ]);
      expect(payload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_passed_ready',
        canResumeOriginalTask: true,
        nextStep: 'continue_original_task',
        reason: 'region_state_login_completed_passed:account_region_appeared_after_auth_prompt',
        handoffSummary: {
          status: 'ready_to_continue',
          nextAction: 'continue_original_task',
          canContinue: true,
        },
      });
      expect(JSON.stringify(payload.regionStatePostconditions)).not.toContain('15705171303');
    });

    it('fresh read after an OTP request candidate proves user-wait state without resuming the original task', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_request_otp',
          tabId: 1,
          pageRegions: [],
          authCollaboration: otpAuthCollaboration({
            readiness: 'ready_to_request_otp',
            requestOtpState: 'visible',
          }),
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'spa_partial_update',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_request_otp',
        candidateAction: {
          id: 'ca_request_otp',
          actionType: 'click',
          targetRef: 'ref_request_otp',
          confidence: 0.91,
          matchReason: 'request OTP candidate',
          locatorChain: [{ type: 'ref', value: 'ref_request_otp' }],
          intent: 'auth.request_otp',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_request_otp',
          tabId: 1,
          pageRegions: [],
          authCollaboration: otpAuthCollaboration({
            readiness: 'waiting_for_user_otp',
            requestOtpState: 'countdown',
          }),
        }),
      );
      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_request_otp',
            kind: 'otp_requested',
            verdict: 'passed',
            reason: 'otp_request_waiting_for_user_evidence_after_action',
          }),
        },
      ]);
      expect(payload.taskResumeReadiness).toMatchObject({
        status: 'blocked_by_auth_verification',
        canResumeOriginalTask: false,
        nextStep: 'wait_for_user_collaboration',
        reason:
          'region_state_otp_requested_waiting_for_user:otp_request_waiting_for_user_evidence_after_action',
        handoffSummary: {
          status: 'waiting_for_user',
          nextAction: 'wait_for_user_collaboration',
          canContinue: false,
        },
      });
      expect(JSON.stringify(payload.regionStatePostconditions)).not.toContain('15705171303');
      expect(JSON.stringify(payload.regionStatePostconditions)).not.toContain('134336');
    });

    it('fresh login proof after OTP user collaboration resolves the wait state and resumes the original task', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 6, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_request_otp_resume',
          tabId: 1,
          pageRegions: [],
          authCollaboration: otpAuthCollaboration({
            readiness: 'ready_to_request_otp',
            requestOtpState: 'visible',
          }),
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'spa_partial_update',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_request_otp',
        candidateAction: {
          id: 'ca_request_otp',
          actionType: 'click',
          targetRef: 'ref_request_otp',
          confidence: 0.91,
          matchReason: 'request OTP candidate',
          locatorChain: [{ type: 'ref', value: 'ref_request_otp' }],
          intent: 'auth.request_otp',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_request_otp_resume',
          tabId: 1,
          pageRegions: [authPromptRegion()],
          authCollaboration: otpAuthCollaboration({
            readiness: 'waiting_for_user_otp',
            requestOtpState: 'countdown',
          }),
        }),
      );
      const waitingResult = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      const waitingPayload = JSON.parse(String(waitingResult.content[0].text));
      expect(waitingPayload.taskResumeReadiness).toMatchObject({
        status: 'blocked_by_auth_verification',
        canResumeOriginalTask: false,
        nextStep: 'wait_for_user_collaboration',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'modal_closed',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_auth_submit',
        candidateAction: {
          id: 'ca_auth_submit',
          actionType: 'click',
          targetRef: 'ref_auth_submit',
          confidence: 0.91,
          matchReason: 'auth submit candidate',
          locatorChain: [{ type: 'ref', value: 'ref_auth_submit' }],
          intent: 'auth.submit_login',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_auth_submit_resume',
          tabId: 1,
          pageRegions: [accountRegion()],
        }),
      );
      const resumedResult = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      const resumedPayload = JSON.parse(String(resumedResult.content[0].text));

      expect(resumedPayload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_auth_submit',
            kind: 'login_completed',
            verdict: 'passed',
            reason: 'account_region_appeared_after_auth_prompt',
          }),
        },
      ]);
      expect(resumedPayload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_passed_ready',
        canResumeOriginalTask: true,
        nextStep: 'continue_original_task',
        evidenceKinds: ['region_state_postcondition', 'user_collaboration_resolved'],
        handoffSummary: {
          status: 'ready_to_continue',
          nextAction: 'continue_original_task',
          canContinue: true,
          evidenceSummary: {
            evidenceKinds: ['region_state_postcondition', 'user_collaboration_resolved'],
          },
        },
      });
      expect(JSON.stringify(resumedPayload.regionStatePostconditions)).not.toContain('15705171303');
      expect(JSON.stringify(resumedPayload.regionStatePostconditions)).not.toContain('170302');
    });

    it('does not resume original task when search readback lacks structured result rows', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_weak_search',
          tabId: 1,
          pageRegions: [contentListRegion('before')],
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'spa_partial_update',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_search_submit',
        candidateAction: {
          id: 'ca_search_submit',
          actionType: 'click',
          targetRef: 'ref_search_submit',
          confidence: 0.91,
          matchReason: 'search submit candidate',
          locatorChain: [{ type: 'ref', value: 'ref_search_submit' }],
          intent: 'search.submit',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_weak_search',
          tabId: 1,
          pageRegions: [weakContentListRegion('after')],
        }),
      );
      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_search_submit',
            kind: 'search_results_updated',
            verdict: 'unknown',
            reason: 'structured_result_evidence_missing_after_action',
          }),
        },
      ]);
      expect(payload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'force_fresh_read_same_tab',
        reason:
          'pending_business_verification_requires_fresh_read:search_results_or_url_query_changed:search.submit',
        handoffSummary: {
          status: 'needs_fresh_read',
          nextAction: 'run_chrome_read_page_force_refresh',
          canContinue: false,
        },
      });
    });

    it('does not pass search postconditions from a snapshot that is not ready for business action', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 6, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_unstable_search',
          tabId: 1,
          pageRegions: [contentListRegion('before')],
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'spa_partial_update',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_search_submit',
        candidateAction: {
          id: 'ca_search_submit',
          actionType: 'click',
          targetRef: 'ref_search_submit',
          confidence: 0.91,
          matchReason: 'search submit candidate',
          locatorChain: [{ type: 'ref', value: 'ref_search_submit' }],
          intent: 'search.submit',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_unstable_search',
          tabId: 1,
          pageRegions: [contentListRegion('after')],
          pageContext: pageContextWithLoadReadiness({
            status: 'loading_after_wait',
            pageStability: 'loading',
            canUseSnapshotForBusinessAction: false,
            nextStepHint: 'run_chrome_read_page_force_refresh',
          }),
        }),
      );
      const unstableReadback = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      const unstablePayload = JSON.parse(String(unstableReadback.content[0].text));

      expect(unstablePayload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_search_submit',
            kind: 'search_results_updated',
            verdict: 'unknown',
            reason: 'after_snapshot_not_ready_for_business_action',
            claimBoundary: expect.stringContaining('loadReadiness=loading_after_wait'),
          }),
        },
      ]);
      expect(unstablePayload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'force_fresh_read_same_tab',
        handoffSummary: {
          status: 'needs_fresh_read',
          nextAction: 'run_chrome_read_page_force_refresh',
        },
      });
      expect(unstablePayload.aiContextEnvelope.regionStatePostconditions).toEqual(
        unstablePayload.regionStatePostconditions,
      );

      const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');
      bridgeSpy.mockClear();
      bridgeSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const blocked = await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_after_1',
        userConfirmed: true,
      });
      const blockedPayload = JSON.parse(String(blocked.content[0].text));
      expect(blocked.isError).toBe(true);
      expect(blockedPayload).toMatchObject({
        code: 'TABRIX_ACTION_COLLABORATION_REQUIRED',
        actionPreflight: {
          verdict: 'collaboration_required',
          reason: 'task_resume_readiness_not_proven',
          taskResumeHandoffStatus: 'needs_fresh_read',
          taskResumeHandoffNextAction: 'run_chrome_read_page_force_refresh',
          taskResumeCanContinue: false,
        },
      });
      expect(bridgeSpy).toHaveBeenCalledTimes(1);

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_stable_search',
          tabId: 1,
          pageRegions: [contentListRegion('after')],
          pageContext: pageContextWithLoadReadiness(),
          includeTopNRows: true,
        }),
      );
      const stableReadback = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
        forceRefresh: true,
      });
      const stablePayload = JSON.parse(String(stableReadback.content[0].text));

      expect(stablePayload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_search_submit',
            kind: 'search_results_updated',
            verdict: 'passed',
            reason: 'result_collection_changed_after_action',
          }),
        },
      ]);
      expect(stablePayload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_passed_ready',
        canResumeOriginalTask: true,
        nextStep: 'continue_original_task',
        handoffSummary: {
          status: 'ready_to_continue',
          nextAction: 'continue_original_task',
          canContinue: true,
        },
      });
    });

    it('carries read_page load-readiness into task resume before the next impact action', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_unstable_before_action',
          tabId: 1,
          pageRegions: [contentListRegion('unstable_before_action')],
          pageContext: pageContextWithLoadReadiness({
            status: 'loading_after_wait',
            pageStability: 'changing',
            canUseSnapshotForBusinessAction: false,
            nextStepHint: 'wait_for_page_stability',
          }),
        }),
      );
      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'force_fresh_read_same_tab',
        tabId: 1,
        evidenceKinds: ['page_load_readiness', 'page_stability'],
        reason:
          'page_load_readiness_not_ready:status:loading_after_wait:pageStability:changing:nextStepHint:wait_for_page_stability',
        handoffSummary: {
          status: 'needs_fresh_read',
          nextAction: 'run_chrome_read_page_force_refresh',
          canContinue: false,
        },
      });
      expect(payload.aiContextEnvelope.taskResumeReadiness).toEqual(payload.taskResumeReadiness);
    });

    it('does not pass search postconditions from source evidence observed before the action', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_stale_source_search',
          tabId: 1,
          pageRegions: [contentListRegion('before_stale_source')],
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'spa_partial_update',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_search_submit',
        candidateAction: {
          id: 'ca_search_submit',
          actionType: 'click',
          targetRef: 'ref_search_submit',
          confidence: 0.91,
          matchReason: 'search submit candidate',
          locatorChain: [{ type: 'ref', value: 'ref_search_submit' }],
          intent: 'search.submit',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_stale_source_search',
          tabId: 1,
          pageRegions: [contentListRegion('after_stale_source')],
          sourceObservedAt: '1970-01-01T00:00:00.000Z',
        }),
      );
      const result = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
        forceRefresh: true,
      });
      const payload = JSON.parse(String(result.content[0].text));

      expect(payload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_search_submit',
            kind: 'search_results_updated',
            verdict: 'unknown',
            reason: 'post_action_fresh_read_required',
            claimBoundary: expect.stringContaining('sourceObservedAtMs=0'),
          }),
        },
      ]);
      expect(payload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'force_fresh_read_same_tab',
        reason:
          'pending_business_verification_requires_fresh_read:search_results_or_url_query_changed:search.submit',
        handoffSummary: {
          status: 'needs_fresh_read',
          nextAction: 'run_chrome_read_page_force_refresh',
          canContinue: false,
        },
      });
    });

    it('fresh read after a result detail candidate proves detail opened before continuation', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_detail_open',
          tabId: 1,
          pageRegions: [contentListRegion('before_detail')],
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'tool_reported_click_dispatched',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_before_detail_1',
        candidateAction: {
          id: 'ca_open_detail',
          actionType: 'click',
          targetRef: 'ref_before_detail_1',
          confidence: 0.9,
          matchReason: 'content result detail candidate',
          locatorChain: [{ type: 'ref', value: 'ref_before_detail_1' }],
          intent: 'content.open_detail',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_detail_open',
          tabId: 1,
          pageRegions: [contentDetailRegion('after_detail')],
        }),
      );
      const readback = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
        forceRefresh: true,
      });
      const payload = JSON.parse(String(readback.content[0].text));

      expect(payload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_open_detail',
            kind: 'detail_opened',
            verdict: 'passed',
            reason: 'content_detail_region_semantic_match_after_action',
          }),
        },
      ]);
      expect(payload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_passed_ready',
        canResumeOriginalTask: true,
        nextStep: 'continue_original_task',
        reason:
          'region_state_detail_opened_passed:content_detail_region_semantic_match_after_action',
        handoffSummary: {
          summaryKind: 'task_resume_handoff_v1',
          status: 'ready_to_continue',
          canContinue: true,
          nextAction: 'continue_original_task',
        },
      });
      expect(payload.aiContextEnvelope.regionStatePostconditions).toEqual(
        payload.regionStatePostconditions,
      );
      expect(payload.aiContextEnvelope.taskResumeReadiness).toEqual(payload.taskResumeReadiness);

      const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');
      bridgeSpy.mockClear();
      bridgeSpy
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'continued_after_detail_open_postcondition',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      const continued = await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_after_detail',
        userConfirmed: true,
      });
      const continuedPayload = JSON.parse(String(continued.content[0].text));

      expect(continued.isError).toBe(false);
      expect(continuedPayload).toMatchObject({
        success: true,
        observedOutcome: 'continued_after_detail_open_postcondition',
      });
      expect(bridgeSpy).toHaveBeenCalledTimes(2);
    });

    it('does not resume after a detail click when the target ref was not in the before result rows', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_mismatched_detail_open',
          tabId: 1,
          pageRegions: [contentListRegion('before_mismatched_detail')],
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'tool_reported_click_dispatched',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_not_in_before_rows',
        candidateAction: {
          id: 'ca_open_detail_mismatch',
          actionType: 'click',
          targetRef: 'ref_not_in_before_rows',
          confidence: 0.9,
          matchReason: 'content result detail candidate',
          locatorChain: [{ type: 'ref', value: 'ref_not_in_before_rows' }],
          intent: 'content.open_detail',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_mismatched_detail_open',
          tabId: 1,
          pageRegions: [contentDetailRegion('after_mismatched_detail')],
        }),
      );
      const readback = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
        forceRefresh: true,
      });
      const payload = JSON.parse(String(readback.content[0].text));

      expect(payload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_open_detail_mismatch',
            kind: 'detail_opened',
            verdict: 'unknown',
            reason: 'before_target_row_identity_not_proven',
          }),
        },
      ]);
      expect(payload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'force_fresh_read_same_tab',
        reason:
          'pending_business_verification_requires_fresh_read:detail_region_or_content_transition:content.open_detail',
      });
    });

    it('does not resume after a result detail candidate when detail evidence is unstructured', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_weak_detail_open',
          tabId: 1,
          pageRegions: [contentListRegion('before_weak_detail')],
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'tool_reported_click_dispatched',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_before_weak_detail_1',
        candidateAction: {
          id: 'ca_open_detail',
          actionType: 'click',
          targetRef: 'ref_before_weak_detail_1',
          confidence: 0.9,
          matchReason: 'content result detail candidate',
          locatorChain: [{ type: 'ref', value: 'ref_before_weak_detail_1' }],
          intent: 'content.open_detail',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_weak_detail_open',
          tabId: 1,
          pageRegions: [weakContentDetailRegion('after_weak_detail')],
        }),
      );
      const readback = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
        forceRefresh: true,
      });
      const payload = JSON.parse(String(readback.content[0].text));

      expect(payload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_open_detail',
            kind: 'detail_opened',
            verdict: 'unknown',
            reason: 'structured_detail_evidence_missing_after_action',
          }),
        },
      ]);
      expect(payload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'force_fresh_read_same_tab',
        reason:
          'pending_business_verification_requires_fresh_read:detail_region_or_content_transition:content.open_detail',
        handoffSummary: {
          status: 'needs_fresh_read',
          nextAction: 'run_chrome_read_page_force_refresh',
          canContinue: false,
        },
      });

      const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');
      bridgeSpy.mockClear();
      bridgeSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const blocked = await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_after_weak_detail',
        userConfirmed: true,
      });
      const blockedPayload = JSON.parse(String(blocked.content[0].text));

      expect(blocked.isError).toBe(true);
      expect(blockedPayload).toMatchObject({
        code: 'TABRIX_ACTION_COLLABORATION_REQUIRED',
        actionPreflight: {
          verdict: 'collaboration_required',
          reason: 'task_resume_readiness_not_proven',
          taskResumeHandoffStatus: 'needs_fresh_read',
          taskResumeHandoffNextAction: 'run_chrome_read_page_force_refresh',
          taskResumeCanContinue: false,
        },
      });
      expect(bridgeSpy).toHaveBeenCalledTimes(1);
    });

    it('blocked continuation after a failed search postcondition returns stop handoff guidance', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 5, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_failed_search',
          tabId: 1,
          pageRegions: [contentListRegion('before')],
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'tool_reported_success_without_business_change',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_search_submit',
        candidateAction: {
          id: 'ca_search_submit',
          actionType: 'click',
          targetRef: 'ref_search_submit',
          confidence: 0.91,
          matchReason: 'search submit candidate',
          locatorChain: [{ type: 'ref', value: 'ref_search_submit' }],
          intent: 'search.submit',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_failed_search',
          tabId: 1,
          pageRegions: [contentListRegion('before')],
        }),
      );
      const readback = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      const readbackPayload = JSON.parse(String(readback.content[0].text));
      expect(readbackPayload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_failed_stop',
        canResumeOriginalTask: false,
        nextStep: 'stop_not_proven',
        handoffSummary: {
          status: 'stop_not_proven',
          nextAction: 'stop_and_report_not_proven',
        },
      });

      const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');
      bridgeSpy.mockClear();
      bridgeSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const blocked = await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_next_result',
        userConfirmed: true,
      });
      const blockedPayload = JSON.parse(String(blocked.content[0].text));

      expect(blocked.isError).toBe(true);
      expect(blockedPayload).toMatchObject({
        ok: false,
        code: 'TABRIX_NON_INTERFERENCE_BLOCKED',
        actionPreflight: {
          verdict: 'block',
          reason: 'task_resume_readiness_not_proven',
          taskResumeHandoffStatus: 'stop_not_proven',
          taskResumeHandoffNextAction: 'stop_and_report_not_proven',
          taskResumeCanContinue: false,
        },
        taskResumeHandoff: {
          summaryKind: 'task_resume_handoff_v1',
          status: 'stop_not_proven',
          canContinue: false,
          nextAction: 'stop_and_report_not_proven',
        },
        runtimePolicyAudit: {
          verdict: 'block',
          reason: 'task_resume_readiness_not_proven',
          taskResumeReadiness: {
            status: 'postcondition_failed_stop',
            handoffSummary: {
              status: 'stop_not_proven',
              nextAction: 'stop_and_report_not_proven',
            },
          },
        },
      });
      expect(blockedPayload.message).toBe(blockedPayload.taskResumeHandoff.message);
      expect(bridgeSpy).toHaveBeenCalledTimes(1);
    });

    it('auto-runs a fresh readback for implicit post-action readiness before page interaction', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 6, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_auto_readback_search',
          tabId: 1,
          pageRegions: [contentListRegion('before')],
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'tool_reported_success_without_business_change',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_search_submit',
        candidateAction: {
          id: 'ca_search_submit',
          actionType: 'click',
          targetRef: 'ref_search_submit',
          confidence: 0.91,
          matchReason: 'search submit candidate',
          locatorChain: [{ type: 'ref', value: 'ref_search_submit' }],
          intent: 'search.submit',
        },
      });

      const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');
      bridgeSpy.mockClear();
      bridgeSpy
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: readPagePayloadWithRegions({
                  projectionId: 'projection_after_auto_readback_search',
                  tabId: 1,
                  pageRegions: [contentListRegion('after')],
                  includeTopNRows: true,
                }),
              },
            ],
            isError: false,
          },
        } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  dispatchSucceeded: true,
                  observedOutcome: 'continued_after_auto_readback',
                }),
              },
            ],
            isError: false,
          },
        } as never);

      const continued = await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_after_1',
      });
      const continuedPayload = JSON.parse(String(continued.content[0].text));

      expect(continued.isError).toBe(false);
      expect(continuedPayload).toMatchObject({
        success: true,
        observedOutcome: 'continued_after_auto_readback',
        actionPreflight: {
          verdict: 'allow',
        },
        runtimePolicyAudit: {
          verdict: 'allow',
        },
      });
      expect(bridgeSpy).toHaveBeenCalledTimes(4);
    });

    it('fresh postcondition recovery after a blocked impact action unblocks continuation on the same tab', async () => {
      markBridgeReady();
      const auto = sessionManager.getOrCreateExternalTaskContext('mcp:auto:tab:1');
      auto.noteRunOwnedTab(1);
      Object.defineProperty(auto, 'readBudget', { value: 6, writable: false });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_before_recovery_search',
          tabId: 1,
          pageRegions: [contentListRegion('before')],
        }),
      );
      await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
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
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'tool_reported_success_without_business_change',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_search_submit',
        candidateAction: {
          id: 'ca_search_submit',
          actionType: 'click',
          targetRef: 'ref_search_submit',
          confidence: 0.91,
          matchReason: 'search submit candidate',
          locatorChain: [{ type: 'ref', value: 'ref_search_submit' }],
          intent: 'search.submit',
        },
      });

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_recovery_unknown',
          tabId: 1,
          pageRegions: [],
        }),
      );
      const unknownReadback = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
      });
      const unknownPayload = JSON.parse(String(unknownReadback.content[0].text));
      expect(unknownPayload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'force_fresh_read_same_tab',
        handoffSummary: {
          status: 'needs_fresh_read',
          nextAction: 'run_chrome_read_page_force_refresh',
        },
      });

      const bridgeSpy = jest.spyOn(nativeMessagingHostInstance, 'sendRequestToExtensionAndWait');
      bridgeSpy.mockClear();
      bridgeSpy.mockResolvedValueOnce({ status: 'success', items: [] } as never);
      const blocked = await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_next_result',
        userConfirmed: true,
      });
      const blockedPayload = JSON.parse(String(blocked.content[0].text));
      expect(blocked.isError).toBe(true);
      expect(blockedPayload).toMatchObject({
        code: 'TABRIX_ACTION_COLLABORATION_REQUIRED',
        actionPreflight: {
          verdict: 'collaboration_required',
          reason: 'task_resume_readiness_not_proven',
          taskResumeHandoffStatus: 'needs_fresh_read',
          taskResumeHandoffNextAction: 'run_chrome_read_page_force_refresh',
          taskResumeCanContinue: false,
        },
      });
      expect(bridgeSpy).toHaveBeenCalledTimes(1);

      mockReadPageRoundTrip(
        readPagePayloadWithRegions({
          projectionId: 'projection_after_recovery_passed',
          tabId: 1,
          pageRegions: [contentListRegion('after')],
          includeTopNRows: true,
        }),
      );
      const recoveredReadback = await handleToolCall('chrome_read_page', {
        tabId: 1,
        requestedLayer: 'L0+L1',
        forceRefresh: true,
      });
      const recoveredPayload = JSON.parse(String(recoveredReadback.content[0].text));
      expect(recoveredPayload.regionStatePostconditions).toEqual([
        {
          actionKind: 'click',
          result: expect.objectContaining({
            actionId: 'ca_search_submit',
            kind: 'search_results_updated',
            verdict: 'passed',
            reason: 'result_collection_changed_after_action',
          }),
        },
      ]);
      expect(recoveredPayload.taskResumeReadiness).toMatchObject({
        status: 'postcondition_passed_ready',
        canResumeOriginalTask: true,
        nextStep: 'continue_original_task',
        handoffSummary: {
          status: 'ready_to_continue',
          nextAction: 'continue_original_task',
          canContinue: true,
        },
      });

      bridgeSpy.mockClear();
      bridgeSpy
        .mockResolvedValueOnce({ status: 'success', items: [] } as never)
        .mockResolvedValueOnce({
          status: 'success',
          data: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  observedOutcome: 'continued_after_postcondition_recovery',
                }),
              },
            ],
            isError: false,
          },
        } as never);
      const continued = await handleToolCall('chrome_click_element', {
        tabId: 1,
        ref: 'ref_after_1',
        userConfirmed: true,
      });
      const continuedPayload = JSON.parse(String(continued.content[0].text));

      expect(continued.isError).toBe(false);
      expect(continuedPayload).toMatchObject({
        success: true,
        observedOutcome: 'continued_after_postcondition_recovery',
      });
      expect(bridgeSpy).toHaveBeenCalledTimes(2);
    });
  });
});
