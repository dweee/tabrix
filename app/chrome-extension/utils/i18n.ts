/**
 * Chrome Extension i18n utility
 * Provides safe access to chrome.i18n.getMessage with fallbacks
 */

// Fallback messages for when Chrome APIs aren't available (English)
const fallbackMessages: Record<string, string> = {
  // Extension metadata
  extensionName: 'Tabrix',
  extensionDescription: 'Expose your own Chrome browser as an MCP service',

  // Section headers
  nativeServerConfigLabel: 'Native Server Configuration',
  semanticEngineLabel: 'Semantic Engine',
  embeddingModelLabel: 'Embedding Model',
  indexDataManagementLabel: 'Index Data Management',
  modelCacheManagementLabel: 'Model Cache Management',

  // Status labels
  statusLabel: 'Status',
  runningStatusLabel: 'Running Status',
  connectionStatusLabel: 'Connection Status',
  lastUpdatedLabel: 'Last Updated:',

  // Connection states
  connectButton: 'Connect',
  disconnectButton: 'Disconnect',
  connectingStatus: 'Connecting...',
  connectedStatus: 'Connected',
  disconnectedStatus: 'Disconnected',
  detectingStatus: 'Detecting...',

  // Server states
  serviceRunningStatus: 'Service Running (Port: {0})',
  serviceNotConnectedStatus: 'Service Not Connected',
  connectedServiceNotStartedStatus: 'Connected, Service Not Started',

  // Configuration labels
  mcpServerConfigLabel: 'MCP Configuration',
  connectionPortLabel: 'Connection Port',
  refreshStatusButton: 'Refresh Status',
  copyConfigButton: 'Copy Configuration',

  // Action buttons
  retryButton: 'Retry',
  cancelButton: 'Cancel',
  confirmButton: 'Confirm',
  saveButton: 'Save',
  closeButton: 'Close',
  resetButton: 'Reset',

  // Progress states
  initializingStatus: 'Initializing...',
  processingStatus: 'Processing...',
  loadingStatus: 'Loading...',
  clearingStatus: 'Clearing...',
  cleaningStatus: 'Cleaning...',
  downloadingStatus: 'Downloading...',

  // Semantic engine states
  semanticEngineReadyStatus: 'Semantic Engine Ready',
  semanticEngineInitializingStatus: 'Semantic Engine Initializing...',
  semanticEngineInitFailedStatus: 'Semantic Engine Initialization Failed',
  semanticEngineNotInitStatus: 'Semantic Engine Not Initialized',
  initSemanticEngineButton: 'Initialize Semantic Engine',
  reinitializeButton: 'Reinitialize',

  // Model states
  downloadingModelStatus: 'Downloading Model... {0}%',
  switchingModelStatus: 'Switching Model...',
  modelLoadedStatus: 'Model Loaded',
  modelFailedStatus: 'Model Failed to Load',

  // Model descriptions
  lightweightModelDescription: 'Lightweight Multilingual Model',
  betterThanSmallDescription: 'Slightly larger than e5-small, but better performance',
  multilingualModelDescription: 'Multilingual Semantic Model',

  // Performance levels
  fastPerformance: 'Fast',
  balancedPerformance: 'Balanced',
  accuratePerformance: 'Accurate',

  // Error messages
  networkErrorMessage: 'Network connection error, please check network and retry',
  modelCorruptedErrorMessage: 'Model file corrupted or incomplete, please retry download',
  unknownErrorMessage: 'Unknown error, please check if your network can access HuggingFace',
  permissionDeniedErrorMessage: 'Permission denied',
  timeoutErrorMessage: 'Operation timed out',

  // Data statistics
  indexedPagesLabel: 'Indexed Pages',
  indexSizeLabel: 'Index Size',
  activeTabsLabel: 'Active Tabs',
  vectorDocumentsLabel: 'Vector Documents',
  cacheSizeLabel: 'Cache Size',
  cacheEntriesLabel: 'Cache Entries',

  // Data management
  clearAllDataButton: 'Clear All Data',
  clearAllCacheButton: 'Clear All Cache',
  cleanExpiredCacheButton: 'Clean Expired Cache',
  exportDataButton: 'Export Data',
  importDataButton: 'Import Data',

  // Dialog titles
  confirmClearDataTitle: 'Confirm Clear Data',
  settingsTitle: 'Settings',
  aboutTitle: 'About',
  helpTitle: 'Help',

  // Dialog messages
  clearDataWarningMessage:
    'This operation will clear all indexed webpage content and vector data, including:',
  clearDataList1: 'All webpage text content index',
  clearDataList2: 'Vector embedding data',
  clearDataList3: 'Search history and cache',
  clearDataIrreversibleWarning:
    'This operation is irreversible! After clearing, you need to browse webpages again to rebuild the index.',
  confirmClearButton: 'Confirm Clear',

  // Cache states
  cacheDetailsLabel: 'Cache Details',
  noCacheDataMessage: 'No cache data',
  loadingCacheInfoStatus: 'Loading cache information...',
  processingCacheStatus: 'Processing cache...',
  expiredLabel: 'Expired',

  // Browser integration
  bookmarksBarLabel: 'Bookmarks Bar',
  newTabLabel: 'New Tab',
  currentPageLabel: 'Current Page',

  // Accessibility
  menuLabel: 'Menu',
  navigationLabel: 'Navigation',
  mainContentLabel: 'Main Content',

  // Future features
  languageSelectorLabel: 'Language',
  themeLabel: 'Theme',
  lightTheme: 'Light',
  darkTheme: 'Dark',
  autoTheme: 'Auto',
  advancedSettingsLabel: 'Advanced Settings',
  debugModeLabel: 'Debug Mode',
  verboseLoggingLabel: 'Verbose Logging',

  // Notifications
  successNotification: 'Operation completed successfully',
  warningNotification: 'Warning: Please review before proceeding',
  infoNotification: 'Information',
  configCopiedNotification: 'Configuration copied to clipboard',
  dataClearedNotification: 'Data cleared successfully',

  // Popup page
  popupOpenTroubleshootingGuide: 'Open Troubleshooting Guide',
  popupActiveClientsLabel: 'Active clients ({0})',
  popupConnectedClientsLabel: 'Connected clients ({0})',
  popupClientLastSeenLabel: '{0}',
  popupClientSessionsLabel: '{0} session(s)',
  popupClientLocalHttpLabel: 'Local · HTTP (no token)',
  popupClientRemoteHttpLabel: 'Remote · HTTP · {0}',
  popupClientLocalSseLabel: 'Local · SSE',
  popupClientRemoteSseLabel: 'Remote · SSE · {0}',
  popupRefreshClientsTitle: 'Refresh client list',
  popupUnknownClient: 'Unknown client',
  popupGenericMcpClient: 'MCP client',
  popupDisconnectClientTitle: 'Disconnect this client',
  popupNoActiveClients: 'No active clients',
  popupNoConnectedClients: 'No MCP client connected',
  popupMcpConfigLabel: 'MCP Configuration',
  popupRemoteAccessTitle: 'Remote Access',
  popupNetworkLocalLabel: 'Local:',
  popupNetworkLanLabel: 'LAN:',
  popupRemoteConfigHint: 'Enable Remote Access to view MCP configuration for remote clients.',
  popupManagementEntrancesTitle: 'Management',
  popupMkeDataManagementTitle: 'MKE Data',
  popupMkeDataManagementDesc: 'Query Memory, Knowledge and Experience rows',
  popupTokenManagementTitle: 'Token Management',
  popupTokenManagementDesc: 'Remote auth, refresh and validity',
  popupTroubleshootingGuideTitle: 'Troubleshooting Guide',
  popupTroubleshootingGuideDesc:
    'Run commands in order. Then restart Chrome and reload the extension in chrome://extensions/.',
  popupCopyCommand: 'Copy',
  popupCopiedShort: 'Copied',
  popupCopiedFullScript: 'Copied full script',
  popupCopyFullTroubleshootScript: 'Copy all',
  popupOpenDocs: 'Docs',
  popupComingSoonSuffix: 'is under development, stay tuned',
  popupJustNow: 'Just now',
  popupMinutesAgo: '{0} minute(s) ago',
  popupHoursAgo: '{0} hour(s) ago',
  popupCopyRepairCommand: 'Copy repair command',
  popupCopyFailed: 'Copy failed',
  popupRemoteSummaryNeedRunning:
    'Connect and start the local service before toggling Remote Access.',
  popupRemoteSummaryLocalOnly:
    'Currently local-only (127.0.0.1). Enable Remote Access to allow LAN clients to connect.',
  popupRemoteSummaryEnabledSecure:
    'Remote access is enabled (0.0.0.0). LAN clients can connect securely with Token.',
  popupRemoteSummaryAutoCreating:
    'Remote access is enabled. A default token is being created automatically.',
  popupRemoteSecurityWarning:
    'Remote mode requires Bearer Token. A default token is being created automatically, or generate one manually in Token Management.',
  popupRemoteTab: 'Remote',
  popupTabHintLocal: 'For local clients like Cursor / Claude Desktop / CherryStudio / Windsurf',
  popupTabHintStdio: 'For CLI clients like Claude Code CLI (npm i -g tabrix@latest first)',
  popupTabHintRemote: 'For remote hosts or Docker via LAN IP',
  popupLanIpPlaceholder: '<LAN_IP>',
  popupStatusDetailErrorDefault:
    'Last connection error: {0}. Try `tabrix doctor --fix`, then `tabrix register --force`, then fully restart Chrome and reload extension in chrome://extensions/.',
  popupStatusDetailDisconnectedWhileDaemon:
    'Local service is running, but browser channel is not connected. Click Connect to enable automation.',
  popupStatusDetailConnectedNoService:
    'Native host is connected, but local MCP service is not ready. Click Refresh first; if it still fails, run `tabrix doctor` and reload extension.',
  popupStatusDetailDisconnected:
    'If Connect still fails, run `tabrix doctor --fix` and `tabrix register --force`, then fully restart Chrome.',
  popupNativeGuidanceLastErrorPrefix: 'Last connection error: {0}',
  popupNativeGuidanceForbiddenDiagnosis:
    'Diagnosis: current extension ID is not in Native Messaging manifest.allowed_origins, or registry still points to an old manifest.',
  popupNativeGuidanceForbiddenSuggestion:
    'Suggestion: run `tabrix doctor --fix`; if it still fails, run `tabrix register --force`, then fully restart Chrome and reload extension in chrome://extensions/.',
  popupNativeGuidanceHostMissingDiagnosis:
    'Diagnosis: Native host is not registered, path is invalid, or host startup failed.',
  popupNativeGuidanceHostMissingSuggestion:
    'Suggestion: run `tabrix doctor --fix`; if needed, run `tabrix register --force`.',
  popupNativeGuidanceAuthDiagnosis:
    'Diagnosis: remote access token is missing, expired, or mismatched.',
  popupNativeGuidanceAuthSuggestion:
    'Suggestion: refresh/copy token in Popup > Remote, and configure Authorization header in your MCP client.',
  popupNativeGuidanceUnknownSuggestion:
    'Suggestion: run `tabrix doctor --fix`; if it still fails, run `tabrix register --force`, then fully restart Chrome.',
  popupTroubleshootQuickFixTitle: 'Current error fix',
  popupTroubleshootDoctorFixTitle: 'Auto-fix common issues',
  popupTroubleshootDaemonStartTitle: 'Start daemon (optional)',
  popupTroubleshootDaemonAutostartTitle: 'Install daemon auto-start on boot',
  popupTroubleshootRegisterForceTitle: 'Re-register Native Host',
  popupTroubleshootRemotePersistTitle: 'Persist remote mode (daemon/env)',
  popupTroubleshootRemotePersistNote:
    'Use the Remote tab toggle by default. This command is only for daemon-based persistent remote mode.',
  popupEnablingRemote: 'Enabling remote access...',
  popupDisablingRemote: 'Disabling remote access...',
  popupToggleFailedPrefix: 'Toggle failed:',
  popupRemoteRestoredLocalOnly: 'Restored to local-only access',
  popupRemoteEnabledWithToken: 'Remote access enabled; default token generated',
  popupRemoteEnabled: 'Remote access enabled',

  // Token management page
  tokenPageBackHomeTitle: 'Back to home',
  tokenPageBackLabel: 'Back',
  tokenPageCurrentTokenTitle: 'Current Token',
  tokenPageCopyTokenTitle: 'Copy token',
  tokenPageEnvTokenBadge:
    'Provided by MCP_AUTH_TOKEN environment variable (cannot be refreshed here)',
  tokenPageExpiryTimeLabel: 'Expires At',
  tokenPageTtlDaysLabel: 'TTL days when generated',
  tokenPageNeverExpire: 'Never expires',
  tokenPageDays: '{0} day(s)',
  tokenPageRegenerateTokenButton: 'Regenerate Token',
  tokenPageGenerateDefaultTokenButton: 'Generate default token',
  tokenPageNotesTitle: 'Notes',
  tokenPageNotesText:
    'You can set token validity days in the regenerate dialog. MCP_AUTH_TOKEN_TTL still controls default days on first auto-generation (default 7; 0 means never expire). Restart service after changing env vars.',
  tokenPageRemoteConfigTitle: 'Remote MCP Configuration (with Token)',
  tokenPageCopyFullConfigButton: 'Copy full configuration',
  tokenPageRegenerateConfirmTitle: 'Regenerate Token?',
  tokenPageRegenerateConfirmItem: 'Saved new token or confirmed all clients can be updated now',
  tokenPageRegenerateConfirmWarning: 'This action cannot be undone.',
  tokenPageRegenerateConfirmButton: 'Confirm regenerate',
  tokenPageNewTokenTtlLabel: 'New token validity days',
  tokenPageTtlHint: '0 = never expires, max 3650',
  tokenPageEmptyRemoteEnabled:
    'No available token detected. Click "Generate default token" (default 7 days) before copying remote config.',
  tokenPageEmptyLocalOnly:
    'Local-only mode is active. Remote token is optional. Enable remote access to generate one here.',
  tokenPageRefreshConfirmMessage:
    'The old token will expire immediately. MCP clients on other devices must update Authorization. Set validity days for the new token below.',
  tokenPageExpired: 'Expired',
  tokenPageRemainingDaysHours: 'About {0} day(s) {1} hour(s) left',
  tokenPageRemainingHoursMinutes: 'About {0} hour(s) {1} minute(s) left',
  tokenPageRemainingMinutes: 'About {0} minute(s) left',
  tokenPageRefreshFailed: 'Refresh failed: {0}',
  tokenPageRefreshRequestFailed: 'Refresh request failed',
  tokenPageReadTokenFailedHttp: 'Failed to read token (HTTP {0})',
  tokenPageLocalServiceUnavailable: 'Token service is temporarily unavailable. Please retry.',
  webEditorNoAgentProjectSelected:
    'No Agent project selected. Open Side Panel -> AI Assistant and select/create a project first.',
  agentProjectConfirmCreateMissingDir: 'Directory "{0}" does not exist. Create it?',
  agentProjectConfirmSwitchExisting:
    'A project already exists for "{0}": {1}. Switch to that project?',

  // Sidepanel navigator
  sidepanelNavigatorTitle: 'Switch Pages',
  bytesUnit: 'bytes',
  kilobytesUnit: 'KB',
  megabytesUnit: 'MB',
  gigabytesUnit: 'GB',
  itemsUnit: 'items',
  pagesUnit: 'pages',

  // Legacy keys for backwards compatibility
  nativeServerConfig: 'Native Server Configuration',
  runningStatus: 'Running Status',
  refreshStatus: 'Refresh Status',
  lastUpdated: 'Last Updated:',
  mcpServerConfig: 'MCP Server Configuration',
  connectionPort: 'Connection Port',
  connecting: 'Connecting...',
  disconnect: 'Disconnect',
  connect: 'Connect',
  semanticEngine: 'Semantic Engine',
  embeddingModel: 'Embedding Model',
  retry: 'Retry',
  indexDataManagement: 'Index Data Management',
  clearing: 'Clearing...',
  clearAllData: 'Clear All Data',
  copyConfig: 'Copy Configuration',
  serviceRunning: 'Service Running (Port: {0})',
  connectedServiceNotStarted: 'Connected, Service Not Started',
  serviceNotConnected: 'Service Not Connected',
  detecting: 'Detecting...',
  lightweightModel: 'Lightweight Multilingual Model',
  betterThanSmall: 'Slightly larger than e5-small, but better performance',
  multilingualModel: 'Multilingual Semantic Model',
  fast: 'Fast',
  balanced: 'Balanced',
  accurate: 'Accurate',
  semanticEngineReady: 'Semantic Engine Ready',
  semanticEngineInitializing: 'Semantic Engine Initializing...',
  semanticEngineInitFailed: 'Semantic Engine Initialization Failed',
  semanticEngineNotInit: 'Semantic Engine Not Initialized',
  downloadingModel: 'Downloading Model... {0}%',
  switchingModel: 'Switching Model...',
  networkError: 'Network connection error, please check network and retry',
  modelCorrupted: 'Model file corrupted or incomplete, please retry download',
  unknownError: 'Unknown error, please check if your network can access HuggingFace',
  reinitialize: 'Reinitialize',
  initializing: 'Initializing...',
  initSemanticEngine: 'Initialize Semantic Engine',
  indexedPages: 'Indexed Pages',
  indexSize: 'Index Size',
  activeTabs: 'Active Tabs',
  vectorDocuments: 'Vector Documents',
  confirmClearData: 'Confirm Clear Data',
  clearDataWarning:
    'This operation will clear all indexed webpage content and vector data, including:',
  clearDataIrreversible:
    'This operation is irreversible! After clearing, you need to browse webpages again to rebuild the index.',
  confirmClear: 'Confirm Clear',
  cancel: 'Cancel',
  confirm: 'Confirm',
  processing: 'Processing...',
  modelCacheManagement: 'Model Cache Management',
  cacheSize: 'Cache Size',
  cacheEntries: 'Cache Entries',
  cacheDetails: 'Cache Details',
  noCacheData: 'No cache data',
  loadingCacheInfo: 'Loading cache information...',
  processingCache: 'Processing cache...',
  cleaning: 'Cleaning...',
  cleanExpiredCache: 'Clean Expired Cache',
  clearAllCache: 'Clear All Cache',
  expired: 'Expired',
  bookmarksBar: 'Bookmarks Bar',
};

/**
 * Safe i18n message getter with fallback support
 * @param key Message key
 * @param substitutions Optional substitution values
 * @returns Localized message or fallback
 */
export function getMessage(key: string, substitutions?: string[]): string {
  try {
    // Check if Chrome extension APIs are available
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const message = chrome.i18n.getMessage(key, substitutions);
      if (message) {
        return message;
      }
    }
  } catch (error) {
    console.warn(`Failed to get i18n message for key "${key}":`, error);
  }

  // Fallback to English messages
  let fallback = fallbackMessages[key] || key;

  // Handle substitutions in fallback messages
  if (substitutions && substitutions.length > 0) {
    substitutions.forEach((value, index) => {
      fallback = fallback.replace(`{${index}}`, value);
    });
  }

  return fallback;
}

/**
 * Check if Chrome extension i18n APIs are available
 */
export function isI18nAvailable(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function'
    );
  } catch {
    return false;
  }
}
