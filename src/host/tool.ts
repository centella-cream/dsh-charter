import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { CharterService } from './service.js'

export function defineCharterReadTool(charter: CharterService): ToolDefinition {
  return defineTool({
    name: 'charter_read',
    description:
      'Read the current user-authored session charter. This tool is read-only. '
      + 'Use the standing view for the current objective, active invariants, and active deliverables; '
      + 'use all only when historical or inactive charter entries are needed; all is a bounded debugging view.',
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
      }
    },
  })
}
