import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { BROWSER_SCHEMAS } from './schemas-browser';
import { CONTEXT_SCHEMAS } from './schemas-context';
import { MEMORY_SCHEMAS } from './schemas-memory';

export const TOOL_SCHEMAS: Tool[] = [...BROWSER_SCHEMAS, ...CONTEXT_SCHEMAS, ...MEMORY_SCHEMAS];
