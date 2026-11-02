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

export function defineCharterProposeTool(charter: CharterService): ToolDefinition {
  return defineTool({
    name: 'charter_propose',
    description:
      'Create pending proposals for the current Session charter. This tool is not a write path: the user must '
      + 'review and accept proposals in the Review Center. Only invariants and deliverables are allowed; objectives, '
      + 'acceptance, archival, purge, and progress changes are not.',
    parameters: {
      items: {
        type: 'array',
        description: 'Pending invariant/deliverable proposals; max 16 items.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['invariant', 'deliverable'], required: true },
            text: { type: 'string', required: true },
            requires: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          revision: { type: 'integer' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('charter_propose requires a live Agent session')
      const items = Array.isArray(args.items) ? args.items.slice(0, 16) : []
      return charter.proposeFromAgent(session, items as never)
    },
  })
}
