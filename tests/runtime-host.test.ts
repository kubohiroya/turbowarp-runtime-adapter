import {describe, expect, it, vi} from 'vitest';
import {createTurboWarpBroadcastPort, createTurboWarpRuntimeHost} from '../src/index.js';

function createRuntime() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const runtime = {
    threads: [] as unknown[],
    stage: {
      variables: {
        message: {type: 'broadcast_msg', name: 'openScene'}
      }
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      const bucket = listeners.get(event) ?? new Set();
      bucket.add(listener);
      listeners.set(event, bucket);
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    startHats: vi.fn<() => unknown[] | undefined>(() => []),
    getTargetForStage() {
      return this.stage;
    },
    _stopThread(thread: unknown) {
      this.threads = this.threads.filter((candidate) => candidate !== thread);
    }
  };
  return runtime;
}

async function expectPending(promise: Promise<unknown>) {
  let settled = false;
  promise.finally(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
}

describe('createTurboWarpRuntimeHost', () => {
  it('resolves a runtime from Scratch and disposes event listeners', () => {
    const runtime = createRuntime();
    const host = createTurboWarpRuntimeHost({Scratch: {vm: {runtime}}});
    const listener = vi.fn();
    const dispose = host.onRuntimeEvent('PROJECT_STOP_ALL', listener);

    runtime.emit('PROJECT_STOP_ALL');
    expect(listener).toHaveBeenCalledTimes(1);

    dispose();
    runtime.emit('PROJECT_STOP_ALL');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('starts hats and normalizes undefined results to an empty array', () => {
    const runtime = createRuntime();
    runtime.startHats.mockImplementationOnce(() => undefined);
    const host = createTurboWarpRuntimeHost({runtime});

    expect(host.startHats('event_whenflagclicked')).toEqual([]);
    expect(runtime.startHats).toHaveBeenCalledWith('event_whenflagclicked', undefined);
  });
});

describe('createTurboWarpBroadcastPort', () => {
  it('resolves only exact Stage broadcast names', async () => {
    const runtime = createRuntime();
    const port = createTurboWarpBroadcastPort({runtime});

    await port.broadcastMessageAndWait(
      {message: 'missing'},
      {signal: new AbortController().signal}
    );

    expect(runtime.startHats).not.toHaveBeenCalled();
  });

  it('starts a broadcast and waits until receiver threads finish', async () => {
    const runtime = createRuntime();
    const thread = {id: 'thread'};
    runtime.threads = [thread];
    runtime.startHats.mockReturnValueOnce([thread]);
    const port = createTurboWarpBroadcastPort({runtime});

    const promise = port.broadcastMessageAndWait(
      {message: 'openScene'},
      {signal: new AbortController().signal}
    );

    expect(runtime.startHats).toHaveBeenCalledWith('event_whenbroadcastreceived', {
      BROADCAST_OPTION: 'openScene'
    });

    runtime.threads = [];
    runtime.emit('AFTER_EXECUTE');
    await expect(promise).resolves.toBeUndefined();
  });

  it('waits for every owned receiver thread and removes the observer', async () => {
    const runtime = createRuntime();
    const threads = [{id: 'stage-thread'}, {id: 'sprite-thread'}, {id: 'clone-thread'}];
    runtime.threads = [...threads];
    runtime.startHats.mockReturnValueOnce(threads);
    const port = createTurboWarpBroadcastPort({runtime});

    const promise = port.broadcastMessageAndWait(
      {message: 'openScene'},
      {signal: new AbortController().signal}
    );

    runtime.threads = [threads[1], threads[2]];
    runtime.emit('AFTER_EXECUTE');
    await expectPending(promise);
    runtime.threads = [threads[2]];
    runtime.emit('AFTER_EXECUTE');
    await expectPending(promise);
    runtime.threads = [];
    runtime.emit('AFTER_EXECUTE');

    await expect(promise).resolves.toBeUndefined();
    expect(runtime.listenerCount('AFTER_EXECUTE')).toBe(0);
  });

  it('cancels active receiver threads when aborted', async () => {
    const runtime = createRuntime();
    const thread = {id: 'thread'};
    runtime.threads = [thread];
    runtime.startHats.mockReturnValueOnce([thread]);
    const port = createTurboWarpBroadcastPort({runtime});
    const controller = new AbortController();

    const promise = port.broadcastMessageAndWait(
      {message: 'openScene'},
      {signal: controller.signal}
    );

    controller.abort();
    await expect(promise).rejects.toMatchObject({name: 'AbortError'});
    expect(runtime.threads).toEqual([]);
  });

  it('does not stop unrelated threads when disposed', async () => {
    const runtime = createRuntime();
    const owned = {id: 'owned'};
    const unrelated = {id: 'unrelated'};
    runtime.threads = [owned, unrelated];
    runtime.startHats.mockReturnValueOnce([owned]);
    const port = createTurboWarpBroadcastPort({runtime, errorCodePrefix: 'K4'});
    const promise = port.broadcastMessageAndWait(
      {message: 'openScene'},
      {signal: new AbortController().signal}
    );

    port.dispose();
    await expect(promise).rejects.toMatchObject({code: 'K4-BROADCAST-CANCELLED'});
    expect(runtime.threads).toEqual([unrelated]);
  });

  it('supports app-specific diagnostic prefixes', async () => {
    const runtime = createRuntime();
    const port = createTurboWarpBroadcastPort({runtime, errorCodePrefix: 'K4'});

    await expect(
      Promise.resolve().then(() =>
        port.broadcastMessageAndWait({message: ''}, {signal: new AbortController().signal})
      )
    ).rejects.toMatchObject({code: 'K4-BROADCAST-PAYLOAD-001'});

    port.dispose();
    await expect(
      port.broadcastMessageAndWait(
        {message: 'openScene'},
        {signal: new AbortController().signal}
      )
    ).rejects.toMatchObject({code: 'K4-BROADCAST-DISPOSED'});
  });

  it('cleans up owned threads when observer setup fails', async () => {
    const runtime = createRuntime();
    const thread = {id: 'thread'};
    runtime.threads = [thread];
    runtime.startHats.mockReturnValueOnce([thread]);
    runtime.on = () => {
      throw new Error('listener failed');
    };
    const port = createTurboWarpBroadcastPort({runtime, errorCodePrefix: 'K4'});

    await expect(
      port.broadcastMessageAndWait(
        {message: 'openScene'},
        {signal: new AbortController().signal}
      )
    ).rejects.toMatchObject({code: 'K4-BROADCAST-RUNTIME-001'});
    expect(runtime.threads).toEqual([]);
  });
});
