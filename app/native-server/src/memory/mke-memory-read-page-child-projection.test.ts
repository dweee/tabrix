import type { BrowserObject, BrowserObjectInput, MemoryTrace } from './db';
import { recordReadPageRegionAndActionObjects } from './mke-memory-read-page-child-projection';

function trace(): MemoryTrace {
  return {
    traceId: 'trace-1',
    taskId: 'task-1',
    taskTheme: null,
    taskIntent: null,
    taskSignature: null,
    aiClient: null,
    toolName: 'chrome_read_page',
    toolCallId: null,
    sequenceIndex: null,
    requestParams: {},
    requestAt: '2026-06-27T00:00:00.000Z',
    response: {},
    responseAt: '2026-06-27T00:00:01.000Z',
    durationMs: 100,
    toolSuccess: true,
    businessSuccess: null,
    resultSummary: null,
    errorCode: null,
    tabId: 10,
    windowId: null,
    browserContextKey: 'ctx-1',
    tabLifecycle: null,
    siteFamily: 'generic',
    pageUrlPattern: 'example.test/search',
    pageRole: 'search_results',
    pageState: null,
    pageModelKey: 'example.test/search',
    perceptionObjects: null,
    actionTarget: null,
    preObservation: null,
    postObservation: null,
    postActionDelta: null,
    sourceRoute: 'read_page',
    selectedDataSource: null,
    freshness: 'fresh',
    fallbackUsed: null,
    nextRequiredCheck: null,
    tokenPrompt: null,
    tokenCompletion: null,
    tokenTotal: null,
    aiFeedbackScore: null,
    aiFeedback: null,
    redactionState: 'redacted',
    createdAt: '2026-06-27T00:00:00.000Z',
  };
}

describe('read-page child object projection', () => {
  it('filters transient or unknown source provenance from reusable child and action facts', () => {
    const captured: BrowserObjectInput[] = [];

    recordReadPageRegionAndActionObjects({
      trace: trace(),
      payload: {
        pageRegions: [
          {
            regionId: 'results',
            regionType: 'result_list',
            objects: [
              {
                objectId: 'card-1',
                objectType: 'result_card',
                label: 'Result card',
                sourceProvenance: ['dom', 'screenshot', 'rect', 'visible_text', 'extra'],
                targetRef: 'ref-card-1',
                actionTypes: ['click'],
              },
            ],
          },
        ],
        candidateActions: [
          {
            id: 'open-card-1',
            actionType: 'click',
            targetRef: 'ref-card-1',
            label: 'Open card',
            locatorChain: [{ type: 'ref', value: 'ref-card-1' }],
            sourceProvenanceDetail: ['ax', 'visual_fallback', 'cdp', 'coordinates'],
          },
        ],
      },
      observedAt: '2026-06-27T00:00:01.000Z',
      browserContextKey: 'ctx-1',
      siteFamily: 'generic',
      rootRoute: 'example.test/search',
      currentRoute: 'example.test/search',
      pageModelKey: 'example.test/search',
      pageRole: 'search_results',
      tabId: 10,
      redactionState: 'redacted',
      upsertBrowserObject: (objectInput) => {
        captured.push(objectInput);
        return { browserObjectId: `bo-${captured.length}` } as BrowserObject;
      },
    });

    const childObject = captured.find((object) => object.objectType === 'result_card');
    const actionTarget = captured.find((object) => object.objectType === 'action_target');

    expect(childObject?.facts).toMatchObject({
      sourceProvenance: ['dom', 'visible_text'],
    });
    expect(actionTarget?.facts).toMatchObject({
      sourceProvenance: ['ax', 'cdp'],
    });
    expect(JSON.stringify(captured)).not.toContain('visual_fallback');
    expect(JSON.stringify(captured)).not.toContain('coordinates');
    expect(JSON.stringify(captured)).not.toContain('screenshot');
  });

  it('merges action target source provenance from the page object snapshot when candidate actions are compact', () => {
    const captured: BrowserObjectInput[] = [];

    recordReadPageRegionAndActionObjects({
      trace: trace(),
      payload: {
        selectedDataSource: 'dom_region_rows',
        sourceRouteHonesty: { verdict: 'dom_fallback' },
        pageObjectSnapshot: {
          actionableTargets: [
            {
              targetId: 'open-search',
              targetRef: 'ref-search',
              sourceProvenance: 'cdp',
              sourceProvenanceDetail: ['dom', 'ax', 'cdp', 'coordinates'],
            },
          ],
        },
        candidateActions: [
          {
            id: 'open-search',
            actionType: 'click',
            targetRef: 'ref-search',
            label: 'Search',
            locatorChain: [{ type: 'aria', value: 'Search' }],
          },
        ],
      },
      observedAt: '2026-06-27T00:00:01.000Z',
      browserContextKey: 'ctx-1',
      siteFamily: 'generic',
      rootRoute: 'example.test/search',
      currentRoute: 'example.test/search',
      pageModelKey: 'example.test/search',
      pageRole: 'search_results',
      tabId: 10,
      redactionState: 'redacted',
      upsertBrowserObject: (objectInput) => {
        captured.push(objectInput);
        return { browserObjectId: `bo-${captured.length}` } as BrowserObject;
      },
    });

    const actionTarget = captured.find((object) => object.objectType === 'action_target');
    expect(actionTarget).toMatchObject({
      sourceRoute: 'dom_fallback',
      selectedDataSource: 'dom_region_rows',
    });
    expect(actionTarget?.facts).toMatchObject({
      sourceProvenance: ['dom', 'ax', 'cdp'],
    });
    expect(JSON.stringify(actionTarget)).not.toContain('coordinates');
  });
});
