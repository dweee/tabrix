import { normalizeToolCallResult, selectAiFacingToolContext } from './result-normalizer';

describe('normalizeToolCallResult', () => {
  it('returns success summary for normal tool results', () => {
    const normalized = normalizeToolCallResult('chrome_read_page', {
      content: [{ type: 'text', text: 'Page content loaded' }],
      isError: false,
    });

    expect(normalized.executionResult.status).toBe('success');
    expect(normalized.stepSummary).toBe('Page content loaded');
    expect(normalized.executionResult.errors).toEqual([]);
  });

  it('returns failure summary for tool errors', () => {
    const normalized = normalizeToolCallResult('chrome_read_page', {
      content: [{ type: 'text', text: 'Tab not found' }],
      isError: true,
    });

    expect(normalized.executionResult.status).toBe('failure');
    expect(normalized.errorCode).toBe('tool_call_error');
    expect(normalized.errorSummary).toBe('Tab not found');
  });

  it('selects delta context as the AI-facing tool context without replacing the raw result', () => {
    const rawResult = {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            kind: 'page',
            pageContent: 'full page content that should not become the execution summary',
            aiContextEnvelope: {
              envelopeKind: 'delta_context',
              contextSource: 'page_projection_delta',
              selectedDataSource: 'dom_region_rows',
              taskState: {
                state: 'ready',
                recommendedNextAction: 'continue_read',
              },
              dataSourceDecision: {
                sourceConfidence: 0.91,
              },
              deltaContext: {
                deltaKind: 'post_action_delta',
                changedRegions: ['result_list'],
                reusedRegions: ['global_nav'],
                contextChars: 1400,
                contextSavedChars: 8600,
              },
            },
          }),
        },
      ],
      isError: false,
    };

    expect(selectAiFacingToolContext(rawResult)).toMatchObject({
      contextKind: 'delta_context',
      contextSource: 'page_projection_delta',
      taskState: 'ready',
      recommendedNextAction: 'continue_read',
      deltaKind: 'post_action_delta',
      selectedDataSource: 'dom_region_rows',
      changedRegions: ['result_list'],
      reusedRegions: ['global_nav'],
      contextChars: 1400,
      contextSavedChars: 8600,
      sourceConfidence: 0.91,
    });

    const normalized = normalizeToolCallResult('chrome_read_page', rawResult);
    expect(normalized.stepSummary).toBe(
      'AI context: post_action_delta; state=ready; next=continue_read; source=page_projection_delta; data=dom_region_rows; changed=result_list; reused=global_nav; savedChars=8600',
    );
    expect(normalized.executionResult.data).toMatchObject({
      rawResult,
      aiFacingContext: {
        deltaKind: 'post_action_delta',
        selectedDataSource: 'dom_region_rows',
      },
    });
  });
});
