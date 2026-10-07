import type { MkeMemoryTraceSummary } from '@tabrix/shared';

type StatusTone = 'good' | 'warn' | 'neutral';

interface MkeAiFeedbackDisplay {
  status: string;
  line: string;
}

function recognizedBusinessStatus(value: string | null | undefined): string | null {
  if (value === 'achieved' || value === 'true') return 'AI通过';
  if (value === 'partial') return 'AI部分完成';
  if (value === 'not_achieved' || value === 'false') return 'AI未通过';
  return null;
}

export function formatMkeAiFeedbackStatus(trace: MkeMemoryTraceSummary): string {
  const feedback = trace.aiFeedback;
  const knownStatus = recognizedBusinessStatus(feedback?.businessStatus);
  if (knownStatus) return knownStatus;
  if (feedback || trace.aiFeedbackState === 'recorded') {
    return feedback?.businessStatus == null || feedback.businessStatus === ''
      ? '评价已收到，业务结果缺失'
      : '评价已收到，业务结果未知';
  }
  if (trace.aiFeedbackState === 'pending' || trace.aiFeedbackRequired === true) return '待AI评价';
  return '无需AI评价';
}

export function formatMkeAiFeedbackStatusTone(trace: MkeMemoryTraceSummary): StatusTone {
  const value = trace.aiFeedback?.businessStatus;
  if (value === 'achieved' || value === 'true') return 'good';
  if (value === 'not_achieved' || value === 'false') return 'warn';
  return 'neutral';
}

export function formatMkeAiFeedbackDetail(
  trace: MkeMemoryTraceSummary,
): { status: string; summary: string | null } | null {
  const feedback = trace.aiFeedback;
  if (!feedback && trace.aiFeedbackState !== 'recorded') return null;
  return {
    status: formatMkeAiFeedbackStatus(trace),
    summary: feedback?.summary ?? null,
  };
}

export function formatMkeAiFeedback(trace: MkeMemoryTraceSummary): MkeAiFeedbackDisplay {
  const feedback = trace.aiFeedback;
  if (!feedback) {
    const status = formatMkeAiFeedbackStatus(trace);
    return {
      status,
      line: status === '待AI评价' ? 'AI评价：待AI评价' : status === '无需AI评价' ? '' : status,
    };
  }

  const knownStatus = recognizedBusinessStatus(feedback.businessStatus);
  const status = formatMkeAiFeedbackStatus(trace);
  const summary = feedback.summary?.trim();
  const readableSummary = summary
    ?.replace(/DOM变化/g, '页面变化')
    .replace(/被浏览器接受/g, '已执行')
    .replace(/targetRef/g, '可点击目标')
    .replace(/post_action_delta|page_projection_delta|data=markdown/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[，,。；;]\s*$/u, '')
    .trim();
  const linePrefix = knownStatus ? 'AI评价' : status;
  return {
    status,
    line: readableSummary ? `${linePrefix}：${compactText(readableSummary, 88)}` : linePrefix,
  };
}

function compactText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}
