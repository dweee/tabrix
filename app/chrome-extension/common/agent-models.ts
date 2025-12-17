/**
 * Agent CLI Model Definitions.
 *
 * Static model definitions for each CLI type.
 * Based on the pattern from Claudable (other/cweb).
 */

// ============================================================
// Types
// ============================================================

export interface ModelDefinition {
  id: string;
  name: string;
  description?: string;
  supportsImages?: boolean;
}

export type AgentCliType = 'claude' | 'codex' | 'cursor' | 'qwen' | 'glm';

// ============================================================
// Claude Models
// ============================================================

export const CLAUDE_MODELS: ModelDefinition[] = [
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    description: 'Balanced model with large context window',
    supportsImages: true,
  },
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    description: 'Strongest reasoning model',
    supportsImages: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    description: 'Fast and cost-efficient',
    supportsImages: true,
  },
];

export const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

// ============================================================
// Codex Models (aligned with other/cweb)
// ============================================================

export const CODEX_MODELS: ModelDefinition[] = [
  {
    id: 'gpt-5',
    name: 'GPT-5',
    description: 'OpenAI flagship reasoning model',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'General-purpose model with multimodal support',
    supportsImages: true,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: 'Cost-efficient GPT-4o variant',
    supportsImages: true,
  },
  {
    id: 'o1-preview',
    name: 'o1 Preview',
    description: 'OpenAI o1 preview model focused on agent use-cases',
  },
  {
    id: 'o1-mini',
    name: 'o1 Mini',
    description: 'Lightweight o1 model for faster iterations',
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'OpenAI o3 reasoning model',
  },
  {
    id: 'claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet (via Codex)',
    description: 'Anthropic Claude via Codex router',
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku (via Codex)',
    description: 'Anthropic Haiku model routed through Codex',
  },
];

export const CODEX_DEFAULT_MODEL = 'gpt-5';

// Codex model alias normalization (aligned with other/cweb)
const CODEX_ALIAS_MAP: Record<string, string> = {
  gpt5: 'gpt-5',
  gpt_5: 'gpt-5',
  'gpt-5.0': 'gpt-5',
  'gpt-4o-mini-high': 'gpt-4o-mini',
  'gpt-4o-mini-low': 'gpt-4o-mini',
  'claude-sonnet-3.5': 'claude-3.5-sonnet',
  'claude35-sonnet': 'claude-3.5-sonnet',
};

const CODEX_KNOWN_IDS = new Set(CODEX_MODELS.map((model) => model.id));

/**
 * Normalize a Codex model ID, handling aliases and falling back to default.
 */
export function normalizeCodexModelId(model?: string | null): string {
  if (!model || typeof model !== 'string') {
    return CODEX_DEFAULT_MODEL;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return CODEX_DEFAULT_MODEL;
  }

  const lower = trimmed.toLowerCase();
  if (CODEX_ALIAS_MAP[lower]) {
    return CODEX_ALIAS_MAP[lower];
  }

  if (CODEX_KNOWN_IDS.has(lower)) {
    return lower;
  }

  // If the exact casing exists, allow it
  if (CODEX_KNOWN_IDS.has(trimmed)) {
    return trimmed;
  }

  return CODEX_DEFAULT_MODEL;
}

// ============================================================
// Cursor Models
// ============================================================

export const CURSOR_MODELS: ModelDefinition[] = [
  {
    id: 'auto',
    name: 'Auto',
    description: 'Cursor auto-selects the best model',
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    description: 'Anthropic Claude via Cursor',
    supportsImages: true,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    description: 'OpenAI model via Cursor',
  },
];

export const CURSOR_DEFAULT_MODEL = 'auto';

// ============================================================
// Qwen Models
// ============================================================

export const QWEN_MODELS: ModelDefinition[] = [
  {
    id: 'qwen3-coder-plus',
    name: 'Qwen3 Coder Plus',
    description: 'Balanced 32k context model for coding',
  },
  {
    id: 'qwen3-coder-pro',
    name: 'Qwen3 Coder Pro',
    description: 'Larger 128k context with stronger reasoning',
  },
  {
    id: 'qwen3-coder',
    name: 'Qwen3 Coder',
    description: 'Fast iteration model',
  },
];

export const QWEN_DEFAULT_MODEL = 'qwen3-coder-plus';

// ============================================================
// GLM Models
// ============================================================

export const GLM_MODELS: ModelDefinition[] = [
  {
    id: 'glm-4.6',
    name: 'GLM 4.6',
    description: 'Zhipu GLM 4.6 agent runtime',
  },
];

export const GLM_DEFAULT_MODEL = 'glm-4.6';

// ============================================================
// Aggregated Definitions
// ============================================================

export const CLI_MODEL_DEFINITIONS: Record<AgentCliType, ModelDefinition[]> = {
  claude: CLAUDE_MODELS,
  codex: CODEX_MODELS,
  cursor: CURSOR_MODELS,
  qwen: QWEN_MODELS,
  glm: GLM_MODELS,
};

export const CLI_DEFAULT_MODELS: Record<AgentCliType, string> = {
  claude: CLAUDE_DEFAULT_MODEL,
  codex: CODEX_DEFAULT_MODEL,
  cursor: CURSOR_DEFAULT_MODEL,
  qwen: QWEN_DEFAULT_MODEL,
  glm: GLM_DEFAULT_MODEL,
};

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get model definitions for a specific CLI type.
 */
export function getModelsForCli(cli: string | null | undefined): ModelDefinition[] {
  if (!cli) return [];
  const key = cli.toLowerCase() as AgentCliType;
  return CLI_MODEL_DEFINITIONS[key] || [];
}

/**
 * Get the default model for a CLI type.
 */
export function getDefaultModelForCli(cli: string | null | undefined): string {
  if (!cli) return '';
  const key = cli.toLowerCase() as AgentCliType;
  return CLI_DEFAULT_MODELS[key] || '';
}

/**
 * Get display name for a model ID.
 */
export function getModelDisplayName(
  cli: string | null | undefined,
  modelId: string | null | undefined,
): string {
  if (!cli || !modelId) return modelId || '';
  const models = getModelsForCli(cli);
  const model = models.find((m) => m.id === modelId);
  return model?.name || modelId;
}
