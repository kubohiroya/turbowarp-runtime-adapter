import {describe, expect, it, vi} from 'vitest';
import {
  coerceScalarBlockValue,
  createBlockSurfaceBuilder,
  createTurboWarpRuntimeHost
} from '../src/index.js';

const stage = {isStage: true, id: 'stage'};
const hero = {isStage: false, id: 'hero'};
const villain = {isStage: false, id: 'villain'};

function createRuntime(overrides: Record<string, unknown> = {}) {
  return {
    on() {},
    startHats: () => [],
    targets: [stage, hero, villain],
    ...overrides
  };
}

describe('target enumeration', () => {
  it('copies the target list so callers cannot splice the runtime', () => {
    const runtime = createRuntime();
    const host = createTurboWarpRuntimeHost({runtime});

    const targets = host.targets();
    expect(targets).toEqual([stage, hero, villain]);

    targets.length = 0;
    expect(host.targets()).toHaveLength(3);
    expect(runtime.targets).toHaveLength(3);
  });

  it('drops the Stage from spriteTargets and keeps runtime order', () => {
    const host = createTurboWarpRuntimeHost({runtime: createRuntime()});
    expect(host.spriteTargets()).toEqual([hero, villain]);
  });

  it('treats an absent target list as empty and a non-array one as a runtime fault', () => {
    expect(createTurboWarpRuntimeHost({runtime: createRuntime({targets: undefined})}).targets())
      .toEqual([]);
    expect(() =>
      createTurboWarpRuntimeHost({runtime: createRuntime({targets: 'nope'})}).targets()
    ).toThrow(/targets must be an array/u);
  });
});

describe('renderer access', () => {
  it('returns the attached renderer and reports a missing one', () => {
    const renderer = {draw() {}};
    expect(createTurboWarpRuntimeHost({runtime: createRuntime({renderer})}).getRenderer()).toBe(
      renderer
    );
    expect(() => createTurboWarpRuntimeHost({runtime: createRuntime()}).getRenderer()).toThrow(
      /no attached renderer/u
    );
  });

  it('forwards requestRedraw and stays a no-op when the runtime has none', () => {
    const requestRedraw = vi.fn();
    createTurboWarpRuntimeHost({runtime: createRuntime({requestRedraw})}).requestRedraw();
    expect(requestRedraw).toHaveBeenCalledTimes(1);

    expect(() =>
      createTurboWarpRuntimeHost({runtime: createRuntime()}).requestRedraw()
    ).not.toThrow();
  });
});

describe('monitor access', () => {
  const monitorBlocks = {getBlock: () => null, getScripts: () => [], changeBlock() {}};
  const monitorState = {has: () => false, get: () => null, valueSeq: () => []};

  it('returns the monitor block store and state', () => {
    const host = createTurboWarpRuntimeHost({
      runtime: createRuntime({monitorBlocks, getMonitorState: () => monitorState})
    });
    expect(host.getMonitorBlocks()).toBe(monitorBlocks);
    expect(host.getMonitorState()).toBe(monitorState);
  });

  it('rejects an incomplete monitor API instead of returning a half-usable object', () => {
    const partialBlocks = {getBlock: () => null, getScripts: () => []};
    expect(() =>
      createTurboWarpRuntimeHost({runtime: createRuntime({monitorBlocks: partialBlocks})})
        .getMonitorBlocks()
    ).toThrow(/monitor blocks are unavailable/u);

    expect(() =>
      createTurboWarpRuntimeHost({runtime: createRuntime({monitorBlocks})}).getMonitorState()
    ).toThrow(/must provide getMonitorState/u);

    expect(() =>
      createTurboWarpRuntimeHost({
        runtime: createRuntime({monitorBlocks, getMonitorState: () => ({has: () => false})})
      }).getMonitorState()
    ).toThrow(/monitor state is unavailable/u);
  });

  it('calls getMonitorState with the runtime as its receiver', () => {
    const runtime = createRuntime({
      monitorBlocks,
      marker: 'self',
      getMonitorState(this: {marker: string}) {
        return {...monitorState, marker: this.marker};
      }
    });
    const state = createTurboWarpRuntimeHost({runtime}).getMonitorState();
    expect((state as unknown as {marker: string}).marker).toBe('self');
  });
});

describe('createBlockSurfaceBuilder', () => {
  const vocabulary = {
    ArgumentType: {STRING: 'string', NUMBER: 'number'},
    BlockType: {REPORTER: 'reporter', BOOLEAN: 'Boolean', COMMAND: 'command', HAT: 'hat'}
  };

  it('builds records with palette visibility and reporter monitors off by default', () => {
    const build = createBlockSurfaceBuilder(vocabulary);
    expect(build.reporter({opcode: 'sceneId', text: 'scene id'})).toEqual({
      opcode: 'sceneId',
      blockType: 'reporter',
      text: 'scene id',
      hideFromPalette: false,
      disableMonitor: true
    });
    expect(build.boolean({opcode: 'ready', text: 'ready?'})).toEqual({
      opcode: 'ready',
      blockType: 'Boolean',
      text: 'ready?',
      hideFromPalette: false
    });
  });

  it('lets a spec override the builder default in both directions', () => {
    const hidden = createBlockSurfaceBuilder(vocabulary, {visible: false});
    expect(hidden.command({opcode: 'go', text: 'go'}).hideFromPalette).toBe(true);
    expect(hidden.command({opcode: 'go', text: 'go', visible: true}).hideFromPalette).toBe(false);
    expect(
      createBlockSurfaceBuilder(vocabulary).reporter({opcode: 'n', text: 'n', monitor: true})
        .disableMonitor
    ).toBeUndefined();
  });

  it('expands [opcode, text] runs into reporters', () => {
    const build = createBlockSurfaceBuilder(vocabulary, {visible: false});
    const blocks = build.reporters([
      ['status', 'status'],
      ['version', 'version']
    ]);
    expect(blocks.map((block) => block.opcode)).toEqual(['status', 'version']);
    expect(blocks.every((block) => block.hideFromPalette === true)).toBe(true);
  });

  it('freezes the records it returns', () => {
    const build = createBlockSurfaceBuilder(vocabulary);
    const block = build.reporter({opcode: 'a', text: 'a'});
    expect(Object.isFrozen(block)).toBe(true);
    expect(Object.isFrozen(build.menu(['x']))).toBe(true);
  });

  it('builds arguments and menus from the injected vocabulary', () => {
    const build = createBlockSurfaceBuilder(vocabulary);
    expect(build.stringArgument('hi')).toEqual({type: 'string', defaultValue: 'hi'});
    expect(build.numberArgument(1)).toEqual({type: 'number', defaultValue: 1});
    expect(build.menuArgument('types')).toEqual({type: 'string', menu: 'types'});
    expect(build.menu(['a', 'b'])).toEqual({acceptReporters: false, items: ['a', 'b']});
  });

  it('rejects a vocabulary or spec it cannot build against', () => {
    expect(() => createBlockSurfaceBuilder({ArgumentType: {}} as never)).toThrow(/ArgumentType/u);
    expect(() =>
      createBlockSurfaceBuilder({ArgumentType: {}, BlockType: {}}).reporter({
        opcode: 'a',
        text: 'a'
      })
    ).toThrow(/BlockType\.REPORTER/u);
    expect(() =>
      createBlockSurfaceBuilder(vocabulary).reporter({opcode: '', text: 'a'})
    ).toThrow(/non-empty opcode/u);
    expect(() =>
      createBlockSurfaceBuilder(vocabulary).reporter({opcode: 'a', text: ''})
    ).toThrow(/non-empty text/u);
    expect(() => createBlockSurfaceBuilder(vocabulary).menu([])).toThrow(/at least one item/u);
  });

  it('refuses a surface that registers one opcode twice', () => {
    const build = createBlockSurfaceBuilder(vocabulary);
    const block = build.reporter({opcode: 'a', text: 'a'});
    expect(() => build.surface([block, block])).toThrow(/Duplicate block opcode: a/u);
    expect(build.surface([block], {m: build.menu(['x'])})).toEqual({
      blocks: [block],
      menus: {m: {acceptReporters: false, items: ['x']}}
    });
  });
});

describe('coerceScalarBlockValue', () => {
  it('coerces the three scalar types Scratch can hand over as strings', () => {
    expect(coerceScalarBlockValue(7, 'string')).toEqual({ok: true, value: '7'});
    expect(coerceScalarBlockValue(null, 'string')).toEqual({ok: true, value: ''});
    expect(coerceScalarBlockValue('2.5', 'number')).toEqual({ok: true, value: 2.5});
    expect(coerceScalarBlockValue('true', 'boolean')).toEqual({ok: true, value: true});
    expect(coerceScalarBlockValue(false, 'boolean')).toEqual({ok: true, value: false});
  });

  it('reports unusable values and unknown types under the injected prefix', () => {
    expect(coerceScalarBlockValue('abc', 'number')).toEqual({
      ok: false,
      code: 'TWRH-VARIABLE-WRITE-VALUE'
    });
    expect(coerceScalarBlockValue('yes', 'boolean', {errorCodePrefix: 'K4'})).toEqual({
      ok: false,
      code: 'K4-VARIABLE-WRITE-VALUE'
    });
    expect(coerceScalarBlockValue('x', 'date', {errorCodePrefix: 'K4'})).toEqual({
      ok: false,
      code: 'K4-VARIABLE-WRITE-TYPE'
    });
  });
});
