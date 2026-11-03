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
      cursor: {
        type: 'string',
        description: 'Opaque all-view cursor returned by a previous charter_read call.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum all-view items to return (1-64).',
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
          nextCursor: { type: 'string' },
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
      const value = charter.readForModel(session, args.view ?? 'standing', {
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      })
      return {
        revision: value.revision,
        objective: value.objective,
        items: value.items.map(item => {
          const { requires, ...rest } = item
          return requires === undefined ? rest : { ...rest, requires: [...requires] }
        }),
        truncated: value.truncated,
        ...(value.objectiveTruncated === true ? { objectiveTruncated: true } : {}),
        ...(value.nextCursor === undefined ? {} : { nextCursor: value.nextCursor }),
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
      const callId = exec.callId === undefined ? undefined : String(exec.callId)
      return charter.proposeFromAgent(session, items as never, callId)
    },
  })
}
