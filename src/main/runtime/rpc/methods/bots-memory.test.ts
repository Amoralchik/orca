import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../../../config/scripts/test-runtime/environment/vitest-host-ports-setup'
import { makeTestBot } from '../../../bots/bot.test-fixture'
import { createBotMemoryRecord } from '../../../bots/bot-memory-record'
import { initDataPath } from '../../../persistence/loading-store/user-data-path'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import type * as BotMemoryLines from '../../../../shared/bot-memory-lines'
import { BOT_MEMORY_METHODS } from './bots-memory'

// Off: the real placement. On: an add that puts the line where it reads as no fact.
const misplaced = vi.hoisted(() => ({ on: false }))
vi.mock('../../../../shared/bot-memory-lines', async (original) => {
  const lines = await original<typeof BotMemoryLines>()
  return {
    ...lines,
    addBotMemoryFact: (text: string, fact: string, date: string) =>
      misplaced.on ? `${text}\`\`\`\n- ${date} ${fact}\n` : lines.addBotMemoryFact(text, fact, date)
  }
})

describe('bot memory commands', () => {
  it.each([
    ['bots.memory.edit', { botId: 'b1', text: 'releases go out on Wednesdays' }, 'change'],
    ['bots.memory.forget', { botId: 'b1', fact: 'releases go out on Wednesdays' }, 'forget'],
    ['bots.memory.undo', { botId: 'b1', id: 'row-1' }, 'undo']
  ] as const)('%s changes the memory in the bot home', async (method, params, call) => {
    installFakeAppEnvironment({ getPath: () => join('/isolated', 'profile') })
    initDataPath()
    const memory = {
      change: vi.fn(async () => {}),
      forget: vi.fn(async () => true),
      undo: vi.fn(async () => true)
    }
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      bots: { assertEnabled: () => {}, list: () => [makeTestBot({ id: 'b1' })], memory }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these methods read only runtime.bots, which the stub provides.
    const service = runtime as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime: service, methods: BOT_MEMORY_METHODS })

    const response = await dispatcher.dispatch({
      id: 'req-1',
      authToken: 'test-token',
      method,
      params
    })

    expect(response).toMatchObject({ ok: true })
    expect(memory[call]).toHaveBeenCalledWith(
      'b1',
      join('/isolated', 'profile', 'bots', 'reviewer'),
      ...(call === 'undo' ? ['row-1'] : [expect.anything(), expect.anything()])
    )
  })

  const homeMemory = (text: string) => {
    installFakeAppEnvironment({ getPath: () => join('/isolated', 'profile') })
    initDataPath()
    const path = join('/isolated', 'profile', 'bots', 'reviewer', 'MEMORY.md')
    const files = new Map([[path, text]])
    const memory = createBotMemoryRecord({
      readText: async (at) => files.get(at) ?? null,
      replaceText: async (at, expected, next) =>
        files.get(at) === expected && !!files.set(at, next),
      writeText: async (at, next) => !!files.set(at, next)
    })
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      bots: { assertEnabled: () => {}, list: () => [makeTestBot({ id: 'b1' })], memory }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these methods read only runtime.bots, which the stub provides.
    const service = runtime as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime: service, methods: BOT_MEMORY_METHODS })
    const add = (fact: string) =>
      dispatcher.dispatch({
        id: 'req-1',
        authToken: 'test-token',
        method: 'bots.memory.edit',
        params: { botId: 'b1', text: fact }
      })
    return { add, read: () => files.get(path) }
  }

  it('adds a fact to a MEMORY.md that ends in an open code fence, above the fence', async () => {
    const memory = homeMemory('# Notes\n\n```sh\npnpm build\n')

    expect(await memory.add('Deploys at noon')).toMatchObject({ ok: true })
    expect(memory.read()).toMatch(
      /^# Notes\n- \d{4}-\d{2}-\d{2} Deploys at noon\n\n```sh\npnpm build\n$/
    )
  })

  it('fails, saving nothing, when an add would leave the fact out', async () => {
    const memory = homeMemory('# Notes\n')
    misplaced.on = true
    try {
      expect(await memory.add('Deploys at noon')).toMatchObject({
        ok: false,
        error: { message: 'Could not add that to MEMORY.md; nothing was saved.' }
      })
    } finally {
      misplaced.on = false
    }
    expect(memory.read()).toBe('# Notes\n')
  })

  it('succeeds without a second line for a fact the file already states', async () => {
    const memory = homeMemory('# Notes\n- 2026-11-01 Deploys at noon\n')

    expect(await memory.add('Deploys at noon')).toMatchObject({ ok: true })
    expect(memory.read()).toBe('# Notes\n- 2026-11-01 Deploys at noon\n')
  })
})
