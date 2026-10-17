import { TOOL_SCHEMAS } from '@tabrix/shared';

import { withTabrixMetadataSchema } from './tabrix-metadata-envelope';
import { filterToolsByEnvironment, filterToolsByPolicy } from './tool-registry-filters';

export function buildMcpToolListResponse() {
  const byEnv = filterToolsByEnvironment(TOOL_SCHEMAS);
  const byPolicy = filterToolsByPolicy(byEnv);
  return {
    tools: byPolicy.map(withTabrixMetadataSchema),
  };
}
