import {describe, expect, it, vi} from 'vitest';
import {
  createTurboWarpDebuggerLog,
  debuggerLogProcedureCodes,
  redactDebuggerLogText,
} from '../src/index.js';

type Callback = (args: Record<string, unknown>, util: {thread?: unknown}) => void;

function createRuntime() {
  const entries: {level: string; content: unknown; thread: unknown}[] = [];
  const blocks = new Map<string, {callback: Callback}>();
  for (const level of ['log', 'warn', 'error'] as const) {
    blocks.set(debuggerLogProcedureCodes[level], {
      callback: ({content}, {thread}) => entries.push({level, content, thread}),
    });
  }
  const runtime = {
    on() {},
    startHats: () => [],
    getAddonBlock: (code: string) => blocks.get(code),
  };
  return {entries, blocks, runtime};
}

const silent = {log: vi.fn(), warn: vi.fn(), error: vi.fn()};
const zeroWidthSpace = String.fromCodePoint(0x200b);

describe('createTurboWarpDebuggerLog', () => {
  it('names the add-on blocks exactly, zero-width spaces included', () => {
    const z = zeroWidthSpace.repeat(2);
    expect(debuggerLogProcedureCodes).toEqual({
      log: `${z}log${z} %s`,
      warn: `${z}warn${z} %s`,
      error: `${z}error${z} %s`,
    });
  });

  it('writes entries to the add-on log blocks with the source in front', () => {
    const {runtime, entries} = createRuntime();
    const log = createTurboWarpDebuggerLog({runtime, source: '紙芝居', console: null});
    expect(log.available()).toBe(true);
    expect(log.warn('camera controls unavailable.')).toBe(true);
    const error = Object.assign(new TypeError('no scene'), {code: 'K4-RUNTIME-001'});
    expect(log.error('playback failed.', error)).toBe(true);
    expect(entries).toEqual([
      {level: 'warn', content: '[紙芝居] camera controls unavailable.', thread: undefined},
      {
        level: 'error',
        content: '[紙芝居] playback failed. TypeError: no scene [K4-RUNTIME-001]',
        thread: undefined,
      },
    ]);
  });

  it('resolves the runtime from Scratch as the runtime host does, and refuses a non-runtime', () => {
    const {runtime, entries} = createRuntime();
    createTurboWarpDebuggerLog({Scratch: {vm: {runtime}}, console: null}).log('from Scratch');
    expect(entries[0]?.content).toBe('from Scratch');
    expect(() => createTurboWarpDebuggerLog({runtime: {}, console: null})).toThrow(
      /TurboWarp runtime must provide on/u,
    );
    expect(createTurboWarpDebuggerLog({console: silent}).warn('no runtime')).toBe(false);
  });

  it('never links an entry to a block', () => {
    const {runtime, entries} = createRuntime();
    createTurboWarpDebuggerLog({runtime, console: null}).error('failed');
    expect(entries[0]?.thread).toBeUndefined();
  });

  it('keeps writing to the console, and only there without the add-on', () => {
    const output = {log: vi.fn(), warn: vi.fn(), error: vi.fn()};
    const {runtime} = createRuntime();
    const log = createTurboWarpDebuggerLog({
      runtime: {...runtime, getAddonBlock: () => undefined},
      source: 'ext',
      console: output,
    });
    expect(log.available()).toBe(false);
    const detail = new Error('broken https://example.com/a?token=secret');
    expect(log.error('failed.', detail)).toBe(false);
    expect(output.error).toHaveBeenCalledWith('[ext] failed.', detail);
  });

  it('hides URL queries, local paths and credentials in the debugger, not in the console', () => {
    const output = {log: vi.fn(), warn: vi.fn(), error: vi.fn()};
    const {runtime, entries} = createRuntime();
    const log = createTurboWarpDebuggerLog({runtime, console: output});
    const message = 'load https://cdn.example.com/a.png?sig=abc from /Users/me/story.yaml token=xyz';
    log.error(message);
    expect(entries[0]?.content).toBe(
      'load https://cdn.example.com/a.png from [local path] token=[redacted]',
    );
    expect(output.error).toHaveBeenCalledWith(message);
    expect(redactDebuggerLogText('C:\\Users\\me\\a.txt')).toBe('[local path]');
    createTurboWarpDebuggerLog({runtime, console: null, redact: null}).log(message);
    expect(entries[1]?.content).toBe(message);
  });

  it('cuts long entries between characters and survives a failing add-on', () => {
    const {runtime, entries, blocks} = createRuntime();
    const log = createTurboWarpDebuggerLog({runtime, console: null, maxLength: 5});
    log.log('0123456789');
    log.log('ab😀😀😀😀');
    expect(entries.map((entry) => entry.content)).toEqual(['0123…', 'ab😀😀…']);
    blocks.set(debuggerLogProcedureCodes.error, {
      callback() {
        throw new Error('add-on gone');
      },
    });
    expect(log.error('x')).toBe(false);
  });

  it('describes plain objects as JSON, without stringifying past the limit', () => {
    const {runtime, entries} = createRuntime();
    const log = createTurboWarpDebuggerLog({runtime, console: null, maxLength: 60});
    log.warn('warning', {mode: 'memory'});
    expect(entries[0]?.content).toBe('warning {"mode":"memory"}');
    const visited: string[] = [];
    const large = Object.fromEntries(
      Array.from({length: 1000}, (_, index) => [
        `key${index}`,
        {
          get value() {
            visited.push(`key${index}`);
            return index;
          },
        },
      ]),
    );
    log.warn('large', large);
    expect(visited.length).toBeLessThan(50);
    expect(String(entries[1]?.content).endsWith('…')).toBe(true);
  });
});
