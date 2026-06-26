export const AUTH_QR_ARTIFACT_KIND = 'auth_qr_image';
export const AUTH_QR_ARTIFACT_TTL_MS = 120_000;
export const AUTH_QR_CLAIM_BOUNDARY =
  'temporary auth-scoped QR image artifact only; not QR payload proof, not login success proof, and not long-term memory';
export const AUTH_COLLABORATION_CLAIM_BOUNDARY =
  'login collaboration planning state only; not credential storage, not auth bypass, and not proof of login success without fresh postcondition evidence';
export const AUTH_FORM_CLAIM_BOUNDARY =
  'privacy-safe OTP auth form map for user collaboration only; raw phone/OTP/password/cookie values are never included';
export const AUTH_RESUME_VERIFICATION_CLAIM_BOUNDARY =
  'resume guidance only; login success still requires a fresh same-tab read_page and postcondition evidence before the original task continues';
export const AUTH_HANDOFF_CLAIM_BOUNDARY =
  'auth handoff is observation evidence for the upstream AI client; Tabrix is not choosing the business path or proving login success';
export const AUTH_QR_EXPIRED_PATTERN =
  /qr[_\s-]*(expired|invalid|refresh|reload)|expired|invalid|timed[ -]?out|refresh_available|refreshable|二维码已过期|二维码过期|已过期|点击刷新|刷新二维码|重新加载|换一张/i;
