import type { TabrixCapability } from '../capabilities';

/**
 * Tools whose visibility AND dispatch are gated by a Tabrix
 * capability (`TABRIX_POLICY_CAPABILITIES`), independent of the P3
 * opt-in path.
 *
 * The map's value is the {@link import('../capabilities').TabrixCapability}
 * the tool requires. The native-server's `register-tools.ts`:
 *   1. drops the tool from `listTools` when its capability is not enabled, and
 *   2. denies `callTool` with `code: 'capability_off'` when its
 *      capability is not enabled — without opening a Memory session.
 *
 * Invariant: every key here SHOULD also be tagged
 * `requiresExplicitOptIn: true` in its `TOOL_SCHEMAS` annotations so
 * MCP clients that render annotations see a coherent "opt-in required"
 * marker — but the gating is enforced by this map, not by the
 * annotation. (`isExplicitOptInTool` intentionally does NOT widen.)
 */
export const CAPABILITY_GATED_TOOLS: ReadonlyMap<string, TabrixCapability> = new Map();

/** True when the tool requires a Tabrix capability to be enabled. */
export function isCapabilityGatedTool(toolName: string): boolean {
  return CAPABILITY_GATED_TOOLS.has(toolName);
}

/** Returns the required capability for a capability-gated tool, or undefined. */
export function getRequiredCapability(toolName: string): TabrixCapability | undefined {
  return CAPABILITY_GATED_TOOLS.get(toolName);
}
