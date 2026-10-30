import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { CharterService } from './service.js'

export function defineCharterReadTool(charter: CharterService): ToolDefinition {
  return defineTool({
    name: 'charter_read',
    description:
      'Read the current user-authored session charter (read-only). The standing charter is normally present '
      + 'in runtime context when automatic injection is available; do not call standing merely to restate that '
      + 'context. Call it when the context may be absent or stale, or when revision/verification details are '
      + 'needed. standing can be large; use all only for inactive/history entries (bounded to 64 items / 32 KiB, '
      + 'with truncated and objectiveTruncated flags).',
    parameters: {
      view: {
        type: 'string',
        enum: ['standing', 'all'],
        description: 'Which charter view to return. Defaults to standing.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          revision: { type: 'integer', required: true },
          objective: {
            required: true,
            oneOf: [{ type: 'string' }, { type: 'null' }],
          },
          items: { type: 'json', required: true },
          truncated: { type: 'integer', required: true },
          objectiveTruncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('charter_read requires a live Agent session')
      const value = charter.readForModel(session, args.view ?? 'standing')
      return {
        revision: value.revision,
        objective: value.objective,
        items: value.items.map(item => ({ ...item })),
        truncated: value.truncated,
        ...(value.objectiveTruncated === true ? { objectiveTruncated: true } : {}),
      }
    },
  })
}
