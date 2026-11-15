import {describe, expect, it, vi} from 'vitest';
import {createTurboWarpDebuggerLog, debuggerLogProcedureCodes} from '../src/index.js';

function createRuntime() {
  const entries: {level: string; content: unknown; thread: unknown}[] = [];
  const blocks = new Map<string, {callback(args: Record<string, unknown>, util: {thread?: unknown}): void}>();
  for (const level of ['log', 'warn', 'error'] as const) {
    blocks.set(debuggerLogProcedureCodes[level], {
      callback: ({content}, {thread}) => entries.push({level, content, thread}),
    });
  }
  return {entries, blocks, runtime: {getAddonBlock: (code: string) => blocks.get(code)}};
}

const silent = {log: vi.fn(), warn: vi.fn(), error: vi.fn()};

describe('createTurboWarpDebuggerLog', () => {
  it('writes entries to the add-on log blocks with the source in front', () => {
    const {runtime, entries} = createRuntime();
    const log = createTurboWarpDebuggerLog(runtime, {source: '紙芝居', console: null});
    expect(log.available()).toBe(true);
    expect(log.warn('camera controls unavailable.')).toBe(true);
    const error = Object.assign(new TypeError('no scene'), {code: 'K4-RUNTIME-001'});
    expect(log.error('playback failed.', error)).toBe(true);
    expect(entries).toEqual([
      {level: 'warn', content: '[紙芝居] camera controls unavailable.', thread: undefined},
      {level: 'error', content: '[紙芝居] playback failed. TypeError: no scene [K4-RUNTIME-001]', thread: undefined},
    ]);
  });

  it('links an entry to a thread only when it looks like one', () => {
    const {runtime, entries} = createRuntime();
    const log = createTurboWarpDebuggerLog(runtime, {console: null});
    const thread = {peekStack: () => 'block', target: {id: 'sprite'}};
    log.log('here', undefined, {thread});
    log.log('not a thread', undefined, {thread: {}});
    expect(entries.map((entry) => entry.thread)).toEqual([thread, undefined]);
  });

  it('keeps writing to the console, and only there without the add-on', () => {
    const output = {log: vi.fn(), warn: vi.fn(), error: vi.fn()};
    const log = createTurboWarpDebuggerLog({}, {source: 'ext', console: output});
    expect(log.available()).toBe(false);
    const detail = new Error('broken');
    expect(log.error('failed.', detail)).toBe(false);
    expect(output.error).toHaveBeenCalledWith('[ext] failed.', detail);
    expect(createTurboWarpDebuggerLog(undefined, {console: silent}).warn('x')).toBe(false);
  });

  it('shortens long entries and survives a failing add-on', () => {
    const {runtime, entries, blocks} = createRuntime();
    const log = createTurboWarpDebuggerLog(runtime, {console: null, maxLength: 10});
    log.log('0123456789abc');
    expect(entries[0]?.content).toBe('012345678…');
    blocks.set(debuggerLogProcedureCodes.error, {
      callback() {
        throw new Error('add-on gone');
      },
    });
    expect(log.error('x')).toBe(false);
  });

  it('describes plain objects as JSON', () => {
    const {runtime, entries} = createRuntime();
    createTurboWarpDebuggerLog(runtime, {console: null}).warn('warning', {mode: 'memory'});
    expect(entries[0]?.content).toBe('warning {"mode":"memory"}');
  });
});
