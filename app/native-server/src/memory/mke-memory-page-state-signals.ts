const BLOCKED_PAGE_SIGNAL_PATTERN =
  /\b(captcha|recaptcha|challenge|verification|security[-_]?check|human[-_]?check|verify(uuid|type|biz)?|user[_-]?verification[_-]?required|login[_-]?required|auth[_-]?required|access[_-]?denied|restricted|blocked)\b|安全验证|人机验证|滑块验证|验证码|登录验证/i;

export function stringHasBlockedPageSignal(value: string | null | undefined): boolean {
  return typeof value === 'string' && BLOCKED_PAGE_SIGNAL_PATTERN.test(value);
}

export function valueHasBlockedPageSignal(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return stringHasBlockedPageSignal(value);
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.some(valueHasBlockedPageSignal);
  if (typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, entry]) => stringHasBlockedPageSignal(key) || valueHasBlockedPageSignal(entry),
  );
}
