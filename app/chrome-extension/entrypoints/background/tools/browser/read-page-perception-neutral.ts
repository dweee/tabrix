import type { ReadPageRegionType } from '@tabrix/shared';

export const LOW_BUSINESS_SIGNAL_PATTERN =
  /\b(footer|privacy|terms|copyright|certificate|license|permit|legal|compliance|sponsors?|sponsorable|search query|feedback|topics?|report (?:abuse|harmful|center)|harmful information report|rumou?r exposure|exposure desk|internet report center|business license|internet drug information service|creator center|creator learning center|upload|upload video|video management|works? data|live data|ads?|advertising|account recovery|contact us|join us|site map|sitemap|friend links|about us|download app)\b|隐私|协议|版权|赞助|举报|有害信息|互联网举报|网络谣言|谣言曝光|资格证书|许可证|备案|公网安备|网文|营业执照|违法不良|网信算备|增值电信|ICP备?|发布视频(?:\/图文)?|发布图文|视频管理|作品数据|直播数据|创作者学习中心|创作中心|广告投放|账号找回|联系我们|加入我们|站点地图|友情链接|业务合作|^下载(?:app|应用|客户端)?$/i;

export const LOW_BUSINESS_HREF_PATTERN =
  /(?:^|\/)(?:legal|privacy|terms|sponsors?|topics?|report|feedback|creator(?:-center)?|upload|video-management|ads?|advertising|account(?:-recovery)?|recover|recovery|contact(?:-us)?|about(?:-us)?|sitemap|site-map|friend-links?|download(?:-app)?|certificate|license|permit|compliance|icp|record)(?:\/|$|\?)/i;

export const REGION_MATCHERS: Record<ReadPageRegionType, readonly RegExp[]> = {
  search_area: [
    /\b(search[_\s-]?area|searchbox|search form|query input|search submit|search category)\b/i,
    /搜索区|搜索框|搜索表单|搜索按钮|搜索分类/i,
  ],
  filter_panel: [
    /\b(filter[_\s-]?panel|filter option|sort option|time range|applied filter)\b/i,
    /筛选面板|筛选项|排序项|发布时间|已筛选/i,
  ],
  result_list: [
    /\b(result[_\s-]?list|result card|list item|card list|search results?)\b/i,
    /结果列表|结果卡片|卡片列表|搜索结果/i,
  ],
  detail_area: [
    /\b(detail[_\s-]?area|detail view|article detail|record detail)\b/i,
    /详情区|详情页|正文详情/i,
  ],
  navigation: [/\b(nav|navigation|sidebar|tab|home|back|next)\b/i, /导航|首页|返回|下一页/i],
  content: [
    /\b(content|article|result|record|row|item|post|document|body)\b/i,
    /内容|正文|结果|列表|文章|帖子|记录/i,
  ],
  account: [
    /\b(account|profile|avatar|user|member|login|log in|sign in|signin|auth action candidate)\b/i,
    /账号|账户|用户|头像|个人|登录|登陆|我的/i,
  ],
  menu: [
    /\b(menu|more|settings?|logout|log out|sign out|expand)\b/i,
    /菜单|更多|设置|退出|注销|展开/i,
  ],
  modal: [
    /\b(dialog|modal|popup|overlay|auth modal|login dialog|sign[ -]?in dialog)\b/i,
    /弹窗|对话框|登录弹窗|授权弹窗|验证弹窗/i,
  ],
  qr_code: [/\b(qr|qrcode|scan|scan code)\b/i, /二维码|扫码|扫一扫/i],
  form: [
    /\b(form|input|textbox|searchbox|submit|publish|post|create|upload|save|generate|choose file|select file|password|credential)\b/i,
    /表单|输入|提交|发布|创建|新建|上传|保存|生成|选择文件|密码|验证码|搜索/i,
  ],
  feedback: [
    /\b(status|alert|toast|error|success|loading|progress|warning)\b/i,
    /状态|提示|错误|成功|加载|进度|警告/i,
  ],
  unknown: [],
};

export const TEXT_AUTHENTICATED_PATTERN =
  /"?(?:loggedIn|isLoggedIn|authenticated)"?\s*:\s*true|\bsigned[ -]?in\b|用户信息|个人资料/i;

export const TEXT_LOGGED_OUT_PATTERN =
  /"?(?:loggedIn|isLoggedIn|authenticated)"?\s*:\s*false|\b(?:login required|log[ -]?in|sign[ -]?in)\b|请先登录|登录后|未登录|账号登录|手机号登录|扫码登录/i;

export const TEXT_AUTH_MODAL_PATTERN =
  /"?(?:showLogin|loginModalVisible|authModalVisible)"?\s*:\s*true|\b(?:login dialog|auth modal|sign[ -]?in dialog)\b|登录弹窗|授权弹窗/i;

export const TEXT_AUTH_MODAL_HIDDEN_PATTERN =
  /"?(?:showLogin|loginModalVisible|authModalVisible)"?\s*:\s*false/i;

export const TEXT_QR_PATTERN = /\b(?:qr|qrcode|scan code)\b|二维码|扫码|扫一扫/i;

export const AUTH_PAGE_TITLE_PATTERN =
  /^(?:sign[ -]?in|log[ -]?in|login|auth(?:orization)?|登录|登陆|授权)(?:\b|\s*[-|:·])/i;

export const TEXT_QR_EXPIRED_PATTERN =
  /\b(?:qr|qrcode|scan code)[\s_-]*(?:expired|invalid|timed[ -]?out)\b|\b(?:expired|invalid|timed[ -]?out)[\s_-]*(?:qr|qrcode|scan code)\b|二维码(?:已)?过期|二维码失效/i;

export const TEXT_MENU_PATTERN =
  /\b(?:menu|settings?|log[ -]?out|sign[ -]?out)\b|菜单|设置|退出|注销/i;

export const TEXT_FEEDBACK_PATTERN =
  /\b(?:toast|alert|warning|error|success|loading|progress)\b|提示|温馨提示|警告|错误|成功|失败|加载中/i;

export const TEXT_NAVIGATION_PATTERN =
  /\b(?:home|messages?|notifications?|publish|navigation)\b|首页|消息|通知|发布/i;

export const GLOBAL_MENU_LABEL_PATTERN =
  /\b(?:home|dashboard|workspace|messages?|notifications?|publish|create|new|live|profile|account|me|my|more|settings?|help|about|orders?|products?|users?|teams?|projects?|tasks?|reports?|analytics|content|billing|admin)\b|首页|主页|工作台|仪表盘|消息|通知|发布|创建|新建|直播|我的?|个人中心|更多|设置|帮助|关于我们|订单|商品|用户|团队|项目|任务|报表|数据|内容|管理/i;

export const OVERFLOW_MENU_LABEL_PATTERN = /\b(?:more|menu|settings?|help)\b|更多|菜单|设置|帮助/i;

export const GENERIC_ACCOUNT_MENU_LABEL_PATTERN =
  /^(?:me|my|profile|account|user|member|个人|个人中心|我的?|我|账号|账户)$/i;

export type SensitiveOperationKind = 'account' | 'menu' | 'auth' | 'qr';

export type AccountMenuTargetIntent =
  | 'auth_trigger'
  | 'menu_trigger'
  | 'logout_action'
  | 'profile_route'
  | 'account_state'
  | 'account_unknown';

export function classifyAccountMenuTargetIntent(text: string): AccountMenuTargetIntent {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'account_unknown';
  if (isLogoutOperationText(normalized)) {
    return 'logout_action';
  }
  if (
    /\b(qr|qrcode|scan|scan code|log[ -]?in|sign[ -]?in|signin|auth|authorize|verify)\b|二维码|扫码|扫一扫|登录|登陆|授权|验证/i.test(
      normalized,
    )
  ) {
    return 'auth_trigger';
  }
  if (
    /\b(menu|more|settings?|expand|dropdown|popover|drawer)\b|菜单|更多|设置|展开/i.test(normalized)
  ) {
    return 'menu_trigger';
  }
  if (
    /\b(profile|user[ -]?home|homepage|personal page|member center)\b|个人主页|主页|个人中心|用户主页/i.test(
      normalized,
    )
  ) {
    return 'profile_route';
  }
  if (/\b(account|avatar|user|member)\b|账号|账户|用户|头像|个人/i.test(normalized)) {
    return 'account_state';
  }
  return 'account_unknown';
}

export function classifySensitiveOperationText(text: string): SensitiveOperationKind | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const hasSearchIntent = /\b(search|find|query)\b|搜索|查找/i.test(normalized);
  const hasExplicitAuthIntent =
    /\b(log[ -]?in|sign[ -]?in|signin|auth|authorize|verification|verify|password|credential|captcha)\b/i.test(
      normalized,
    ) || /登录|登陆|授权|验证|密码|账号|验证码/i.test(normalized);
  if (hasSearchIntent && !hasExplicitAuthIntent) return null;
  if (/\b(qr|qrcode|scan|scan code|refresh qr)\b|二维码|扫码|扫一扫/i.test(normalized)) {
    return 'qr';
  }
  if (isLogoutOperationText(normalized)) {
    return 'menu';
  }
  if (
    /\b(log[ -]?in|sign[ -]?in|signin|auth|authorize|verification|verify)\b/i.test(normalized) ||
    /登录|登陆|授权|验证|弹窗|对话框/i.test(normalized)
  ) {
    return 'auth';
  }
  if (/\b(menu|more|settings?|expand|dropdown)\b|菜单|更多|设置|展开/i.test(normalized)) {
    return 'menu';
  }
  if (/\b(account|profile|avatar|user|member)\b|账号|账户|用户|头像|个人/i.test(normalized)) {
    return 'account';
  }
  return null;
}

export function safeAiOperationLabel(kind: SensitiveOperationKind): string {
  switch (kind) {
    case 'account':
      return 'account action candidate';
    case 'menu':
      return 'menu action candidate';
    case 'auth':
      return 'auth action candidate';
    case 'qr':
      return 'QR action candidate';
  }
}

export function isLogoutOperationText(text: string): boolean {
  return /\b(log[ -]?out|sign[ -]?out)\b|退出|注销/i.test(text);
}
