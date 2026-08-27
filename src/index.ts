export interface ScratchRuntimeHost {
  vm?: {
    runtime?: unknown;
  };
  extensions?: {
    unsandboxed?: boolean;
  };
}

export interface TurboWarpRuntimeLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  startHats(opcode: string, matchFields?: Record<string, string>): unknown[] | undefined;
  getTargetForStage?: () => unknown;
  _stopThread?: (thread: unknown) => void;
  threads?: unknown[];
}

export interface TurboWarpRuntimeHostOptions {
  Scratch?: ScratchRuntimeHost;
  runtime?: unknown;
  requireUnsandboxed?: boolean;
}

export interface TurboWarpRuntimeHost {
  runtime: TurboWarpRuntimeLike;
  onRuntimeEvent(event: string, listener: (...args: unknown[]) => void): () => void;
  startHats(opcode: string, matchFields?: Record<string, string>): unknown[];
  stopThread(thread: unknown): void;
  getStageTarget(): unknown;
  currentThreads(): unknown[];
}

export interface BroadcastPortContext {
  signal: AbortSignal;
}

export interface TurboWarpBroadcastPort {
  broadcastMessageAndWait(
    payload: {message: string},
    context: BroadcastPortContext
  ): Promise<void>;
  dispose(): void;
}

export interface TurboWarpBroadcastPortOptions {
  runtime: unknown;
  errorCodePrefix?: string;
}

const broadcastHatOpcode = 'event_whenbroadcastreceived';
const broadcastMessageType = 'broadcast_msg';
const afterExecuteEvent = 'AFTER_EXECUTE';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function prefixedCode(prefix: string, suffix: string): string {
  if (!/^[A-Z][A-Z0-9]*$/u.test(prefix)) {
    throw new TypeError('errorCodePrefix must be an uppercase diagnostic prefix.');
  }
  return `${prefix}-${suffix}`;
}

function hostError(code: string, message: string, cause?: unknown): Error {
  const error = new Error(message);
  Object.defineProperty(error, 'code', {value: code});
  if (cause !== undefined) Object.defineProperty(error, 'cause', {value: cause});
  return error;
}

function cancelledError(prefix: string, message: string): Error {
  const error = hostError(prefixedCode(prefix, 'BROADCAST-CANCELLED'), message);
  error.name = 'AbortError';
  return error;
}

function removeRuntimeListener(
  runtime: TurboWarpRuntimeLike,
  event: string,
  listener: (...args: unknown[]) => void
): void {
  if (typeof runtime.off === 'function') {
    runtime.off(event, listener);
    return;
  }
  if (typeof runtime.removeListener === 'function') {
    runtime.removeListener(event, listener);
    return;
  }
  throw hostError(
    'TWRH-RUNTIME-001',
    'TurboWarp runtime must provide off or removeListener to dispose listeners.'
  );
}

function validateRuntime(value: unknown): TurboWarpRuntimeLike {
  if (!isRecord(value)) {
    throw hostError('TWRH-RUNTIME-001', 'TurboWarp runtime must be an object.');
  }
  if (typeof value['on'] !== 'function') {
    throw hostError('TWRH-RUNTIME-001', 'TurboWarp runtime must provide on.');
  }
  if (typeof value['startHats'] !== 'function') {
    throw hostError('TWRH-RUNTIME-001', 'TurboWarp runtime must provide startHats.');
  }
  return value as unknown as TurboWarpRuntimeLike;
}

function validateAbortSignal(value: unknown, prefix = 'TWRH'): AbortSignal {
  if (
    !isRecord(value) ||
    typeof value['aborted'] !== 'boolean' ||
    typeof value['addEventListener'] !== 'function' ||
    typeof value['removeEventListener'] !== 'function'
  ) {
    throw hostError(
      prefixedCode(prefix, 'BROADCAST-CONTEXT-001'),
      'broadcastMessageAndWait context must provide an AbortSignal.'
    );
  }
  return value as unknown as AbortSignal;
}

function requireMethod<T extends keyof TurboWarpRuntimeLike>(
  runtime: TurboWarpRuntimeLike,
  method: T
): NonNullable<TurboWarpRuntimeLike[T]> {
  const operation = runtime[method];
  if (typeof operation !== 'function') {
    throw hostError('TWRH-RUNTIME-001', `TurboWarp runtime must provide ${String(method)}.`);
  }
  return operation as NonNullable<TurboWarpRuntimeLike[T]>;
}

export function createTurboWarpRuntimeHost(
  options: TurboWarpRuntimeHostOptions = {}
): TurboWarpRuntimeHost {
  if (options.requireUnsandboxed === true && options.Scratch?.extensions?.unsandboxed !== true) {
    throw hostError('TWRH-SCRATCH-001', 'TurboWarp runtime host requires unsandboxed Scratch.');
  }
  const runtime = validateRuntime(options.runtime ?? options.Scratch?.vm?.runtime);

  return Object.freeze({
    runtime,
    onRuntimeEvent(event: string, listener: (...args: unknown[]) => void) {
      runtime.on(event, listener);
      return () => removeRuntimeListener(runtime, event, listener);
    },
    startHats(opcode: string, matchFields?: Record<string, string>) {
      const threads = runtime.startHats(opcode, matchFields);
      if (threads === undefined) return [];
      if (!Array.isArray(threads)) {
        throw hostError('TWRH-RUNTIME-001', 'TurboWarp startHats must return an array or undefined.');
      }
      return threads;
    },
    stopThread(thread: unknown) {
      requireMethod(runtime, '_stopThread').call(runtime, thread);
    },
    getStageTarget() {
      return requireMethod(runtime, 'getTargetForStage').call(runtime);
    },
    currentThreads() {
      if (runtime.threads === undefined) return [];
      if (!Array.isArray(runtime.threads)) {
        throw hostError('TWRH-RUNTIME-001', 'TurboWarp runtime threads must be an array.');
      }
      return [...runtime.threads];
    }
  });
}

function validateBroadcastRuntime(runtime: TurboWarpRuntimeLike, prefix: string): TurboWarpRuntimeLike {
  try {
    requireMethod(runtime, 'getTargetForStage');
    requireMethod(runtime, '_stopThread');
  } catch {
    throw hostError(
      prefixedCode(prefix, 'BROADCAST-RUNTIME-001'),
      'TurboWarp runtime is missing required broadcast methods.'
    );
  }
  if (!Array.isArray(runtime.threads)) {
    throw hostError(prefixedCode(prefix, 'BROADCAST-RUNTIME-001'), 'TurboWarp runtime threads must be an array.');
  }
  if (typeof runtime.off !== 'function' && typeof runtime.removeListener !== 'function') {
    throw hostError(prefixedCode(prefix, 'BROADCAST-RUNTIME-001'), 'TurboWarp runtime must provide off or removeListener.');
  }
  return runtime;
}

function resolveExactBroadcast(runtime: TurboWarpRuntimeLike, message: string, prefix: string): string | null {
  let stage: unknown;
  try {
    stage = requireMethod(runtime, 'getTargetForStage').call(runtime);
  } catch (cause) {
    throw hostError(prefixedCode(prefix, 'BROADCAST-RUNTIME-001'), 'TurboWarp Stage broadcasts could not be read.', cause);
  }
  if (!isRecord(stage) || !isRecord(stage['variables'])) {
    throw hostError(prefixedCode(prefix, 'BROADCAST-RUNTIME-001'), 'TurboWarp Stage broadcasts are unavailable.');
  }
  const declared = Object.values(stage['variables']).find(
    (variable) =>
      isRecord(variable) &&
      variable['type'] === broadcastMessageType &&
      variable['name'] === message
  );
  return declared ? message : null;
}

function validateBroadcastPayload(payload: unknown, prefix: string): string {
  if (
    !isRecord(payload) ||
    Object.keys(payload).length !== 1 ||
    typeof payload['message'] !== 'string' ||
    payload['message'].length === 0
  ) {
    throw hostError(
      prefixedCode(prefix, 'BROADCAST-PAYLOAD-001'),
      'broadcastMessageAndWait payload must contain one non-empty message string.'
    );
  }
  return payload['message'];
}

export function createTurboWarpBroadcastPort(
  options: TurboWarpBroadcastPortOptions
): TurboWarpBroadcastPort {
  if (!isRecord(options)) {
    throw hostError('TWRH-BROADCAST-RUNTIME-001', 'TurboWarp broadcast port options must be an object.');
  }
  const prefix = options.errorCodePrefix ?? 'TWRH';
  let baseRuntime: TurboWarpRuntimeLike;
  try {
    baseRuntime = validateRuntime(options.runtime);
  } catch (cause) {
    throw hostError(
      prefixedCode(prefix, 'BROADCAST-RUNTIME-001'),
      'TurboWarp broadcast port requires a valid runtime object.',
      cause
    );
  }
  const runtime = validateBroadcastRuntime(baseRuntime, prefix);
  const activeInvocations = new Set<{cancel(message: string): void}>();
  let disposed = false;

  function threadIsActive(thread: unknown): boolean {
    return runtime.threads?.includes(thread) === true;
  }

  function stopOwnedThreads(threads: readonly unknown[], reason: string): void {
    const errors: unknown[] = [];
    for (const thread of threads) {
      if (!threadIsActive(thread)) continue;
      try {
        requireMethod(runtime, '_stopThread').call(runtime, thread);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw hostError(
        prefixedCode(prefix, 'BROADCAST-CLEANUP-001'),
        `TurboWarp broadcast receiver cleanup failed: ${reason}`,
        errors.length === 1 ? errors[0] : new AggregateError(errors)
      );
    }
  }

  return Object.freeze({
    broadcastMessageAndWait(payload: {message: string}, context: BroadcastPortContext) {
      if (disposed) {
        return Promise.reject(
          hostError(prefixedCode(prefix, 'BROADCAST-DISPOSED'), 'TurboWarp broadcast port is disposed.')
        );
      }
      const message = validateBroadcastPayload(payload, prefix);
      const signal = validateAbortSignal(context?.signal, prefix);
      if (signal.aborted) {
        return Promise.reject(cancelledError(prefix, 'broadcastMessageAndWait was cancelled.'));
      }
      const broadcastName = resolveExactBroadcast(runtime, message, prefix);
      if (broadcastName === null) return Promise.resolve();

      let started: unknown[] | undefined;
      try {
        started = runtime.startHats(broadcastHatOpcode, {BROADCAST_OPTION: broadcastName});
      } catch (cause) {
        throw hostError(
          prefixedCode(prefix, 'BROADCAST-START-001'),
          'TurboWarp broadcast receiver threads could not be started.',
          cause
        );
      }
      const threads = started ?? [];
      if (!Array.isArray(threads)) {
        throw hostError(prefixedCode(prefix, 'BROADCAST-RUNTIME-001'), 'TurboWarp startHats must return an array or undefined.');
      }
      if (threads.length === 0) return Promise.resolve();

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        let runtimeListenerAttached = false;
        let abortListenerAttached = false;
        const invocation = {
          cancel(messageText: string) {
            settleCancelled(messageText);
          }
        };
        const cleanup = (reason: string) => {
          const errors: unknown[] = [];
          if (runtimeListenerAttached) {
            runtimeListenerAttached = false;
            try {
              removeRuntimeListener(runtime, afterExecuteEvent, handleAfterExecute);
            } catch (error) {
              errors.push(error);
            }
          }
          if (abortListenerAttached) {
            abortListenerAttached = false;
            signal.removeEventListener('abort', handleAbort);
          }
          activeInvocations.delete(invocation);
          try {
            stopOwnedThreads(threads, reason);
          } catch (error) {
            errors.push(error);
          }
          if (errors.length > 0) {
            throw hostError(
              prefixedCode(prefix, 'BROADCAST-CLEANUP-001'),
              `TurboWarp broadcast cleanup failed: ${reason}`,
              errors.length === 1 ? errors[0] : new AggregateError(errors)
            );
          }
        };
        const settle = (operation: () => void, reason: string) => {
          if (settled) return;
          settled = true;
          try {
            cleanup(reason);
            operation();
          } catch (error) {
            reject(error);
          }
        };
        const settleCancelled = (messageText: string) => {
          settle(() => reject(cancelledError(prefix, messageText)), 'cancelled');
        };
        const handleAbort = () => {
          settleCancelled('broadcastMessageAndWait was cancelled.');
        };
        const handleAfterExecute = () => {
          if (threads.every((thread) => !threadIsActive(thread))) {
            settle(resolve, 'completed');
          }
        };

        activeInvocations.add(invocation);
        try {
          runtime.on(afterExecuteEvent, handleAfterExecute);
          runtimeListenerAttached = true;
          signal.addEventListener('abort', handleAbort, {once: true});
          abortListenerAttached = true;
        } catch (cause) {
          settled = true;
          const errors: unknown[] = [
            hostError(
              prefixedCode(prefix, 'BROADCAST-RUNTIME-001'),
              'TurboWarp broadcast receiver completion could not be observed.',
              cause
            )
          ];
          try {
            cleanup('observer setup failure');
          } catch (error) {
            errors.push(error);
          }
          reject(
            errors.length === 1
              ? errors[0]
              : hostError(
                  prefixedCode(prefix, 'BROADCAST-CLEANUP-001'),
                  'TurboWarp broadcast observer setup cleanup failed.',
                  new AggregateError(errors)
                )
          );
          return;
        }
        if (signal.aborted) handleAbort();
        else handleAfterExecute();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const invocation of [...activeInvocations]) {
        invocation.cancel('TurboWarp broadcast port was disposed.');
      }
    }
  });
}
