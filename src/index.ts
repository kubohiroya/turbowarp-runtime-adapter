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
  targets?: unknown[];
  renderer?: unknown;
  requestRedraw?: () => void;
  monitorBlocks?: unknown;
  getMonitorState?: () => unknown;
}

/**
 * The Scratch monitor block store, as used by the `data_showvariable` and `data_hidevariable`
 * primitives. Only the members needed to read and toggle a monitor are declared.
 */
export interface TurboWarpMonitorBlocks {
  getBlock(id: string): unknown;
  getScripts(): string[];
  changeBlock(change: {id: string; element: string; value: unknown}): void;
}

/** The immutable monitor record map the runtime keeps alongside {@link TurboWarpMonitorBlocks}. */
export interface TurboWarpMonitorState {
  has(id: string): boolean;
  get(id: string): unknown;
  valueSeq(): Iterable<unknown>;
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
  /** Every loaded target, Stage included, as a copy the caller may not mutate in place. */
  targets(): unknown[];
  /** Every loaded target except the Stage, in runtime order. */
  spriteTargets(): unknown[];
  /** The renderer the VM attached. Throws when the runtime has none. */
  getRenderer(): unknown;
  /** Ask the renderer for a frame. A runtime without `requestRedraw` is a no-op, not an error. */
  requestRedraw(): void;
  getMonitorBlocks(): TurboWarpMonitorBlocks;
  getMonitorState(): TurboWarpMonitorState;
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
    },
    targets() {
      return resolveTargets(runtime);
    },
    spriteTargets() {
      return resolveTargets(runtime).filter(
        (target) => !(isRecord(target) && target['isStage'] === true)
      );
    },
    getRenderer() {
      const renderer = runtime.renderer;
      if (!isRecord(renderer)) {
        throw hostError('TWRH-RENDERER-001', 'TurboWarp runtime has no attached renderer.');
      }
      return renderer;
    },
    requestRedraw() {
      // A runtime without a renderer redraws on its own tick, so this stays a no-op rather than
      // forcing every caller to feature-test before asking for a frame.
      if (typeof runtime.requestRedraw === 'function') runtime.requestRedraw();
    },
    getMonitorBlocks() {
      return resolveMonitorBlocks(runtime);
    },
    getMonitorState() {
      return resolveMonitorState(runtime);
    }
  });
}

function resolveTargets(runtime: TurboWarpRuntimeLike): unknown[] {
  if (runtime.targets === undefined) return [];
  if (!Array.isArray(runtime.targets)) {
    throw hostError('TWRH-RUNTIME-001', 'TurboWarp runtime targets must be an array.');
  }
  return [...runtime.targets];
}

function resolveMonitorBlocks(runtime: TurboWarpRuntimeLike): TurboWarpMonitorBlocks {
  const monitorBlocks = runtime.monitorBlocks;
  if (
    !isRecord(monitorBlocks) ||
    typeof monitorBlocks['getBlock'] !== 'function' ||
    typeof monitorBlocks['getScripts'] !== 'function' ||
    typeof monitorBlocks['changeBlock'] !== 'function'
  ) {
    throw hostError('TWRH-MONITOR-001', 'TurboWarp monitor blocks are unavailable.');
  }
  return monitorBlocks as unknown as TurboWarpMonitorBlocks;
}

function resolveMonitorState(runtime: TurboWarpRuntimeLike): TurboWarpMonitorState {
  const getMonitorState = runtime.getMonitorState;
  if (typeof getMonitorState !== 'function') {
    throw hostError('TWRH-MONITOR-001', 'TurboWarp runtime must provide getMonitorState.');
  }
  const monitorState = getMonitorState.call(runtime);
  if (
    !isRecord(monitorState) ||
    typeof monitorState['has'] !== 'function' ||
    typeof monitorState['get'] !== 'function' ||
    typeof monitorState['valueSeq'] !== 'function'
  ) {
    throw hostError('TWRH-MONITOR-001', 'TurboWarp monitor state is unavailable.');
  }
  return monitorState as unknown as TurboWarpMonitorState;
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

/**
 * The `Scratch.BlockType` / `Scratch.ArgumentType` pair an extension's `getInfo()` builds against.
 * Passing them in keeps this package free of any ambient `Scratch` global.
 */
export interface ScratchBlockVocabulary {
  ArgumentType: Record<string, string>;
  BlockType: Record<string, string>;
}

export interface BlockArgumentRecord {
  type: string;
  defaultValue?: string | number | boolean;
  menu?: string;
}

export interface BlockRecord {
  opcode: string;
  blockType: string;
  text: string;
  arguments?: Readonly<Record<string, BlockArgumentRecord>>;
  hideFromPalette?: boolean;
  disableMonitor?: boolean;
}

export interface BlockMenuRecord {
  acceptReporters: boolean;
  items: readonly string[];
}

export interface BlockSpec {
  opcode: string;
  text: string;
  arguments?: Readonly<Record<string, BlockArgumentRecord>>;
  /** Defaults to the builder's own visibility. */
  visible?: boolean;
  /** Reporters default to `true`; other block types ignore it. */
  monitor?: boolean;
}

export interface BlockSurfaceBuilderOptions {
  /** Default palette visibility for every block this builder makes. Defaults to `true`. */
  visible?: boolean;
}

export interface BlockSurfaceBuilder {
  reporter(spec: BlockSpec): BlockRecord;
  boolean(spec: BlockSpec): BlockRecord;
  command(spec: BlockSpec): BlockRecord;
  hat(spec: BlockSpec): BlockRecord;
  /** Build a run of plain reporters from `[opcode, text]` pairs. */
  reporters(
    entries: readonly (readonly [string, string])[],
    options?: {visible?: boolean; monitor?: boolean}
  ): readonly BlockRecord[];
  stringArgument(defaultValue?: string): BlockArgumentRecord;
  numberArgument(defaultValue?: number): BlockArgumentRecord;
  menuArgument(menu: string): BlockArgumentRecord;
  menu(items: readonly string[], options?: {acceptReporters?: boolean}): BlockMenuRecord;
  surface(
    blocks: readonly BlockRecord[],
    menus?: Readonly<Record<string, BlockMenuRecord>>
  ): Readonly<{blocks: readonly BlockRecord[]; menus: Readonly<Record<string, BlockMenuRecord>>}>;
}

function requireBlockType(vocabulary: ScratchBlockVocabulary, name: string): string {
  const value = vocabulary.BlockType[name];
  if (typeof value !== 'string') {
    throw hostError('TWRH-BLOCK-001', `Scratch.BlockType.${name} is required.`);
  }
  return value;
}

function requireArgumentType(vocabulary: ScratchBlockVocabulary, name: string): string {
  const value = vocabulary.ArgumentType[name];
  if (typeof value !== 'string') {
    throw hostError('TWRH-BLOCK-001', `Scratch.ArgumentType.${name} is required.`);
  }
  return value;
}

function validateBlockSpec(spec: BlockSpec): BlockSpec {
  if (!isRecord(spec) || typeof spec.opcode !== 'string' || spec.opcode.length === 0) {
    throw hostError('TWRH-BLOCK-002', 'A block spec must provide a non-empty opcode.');
  }
  if (typeof spec.text !== 'string' || spec.text.length === 0) {
    throw hostError('TWRH-BLOCK-002', `Block ${spec.opcode} must provide non-empty text.`);
  }
  return spec;
}

/**
 * Build the repetitive parts of an extension's `getInfo()` block list.
 *
 * The builder owns record shape and palette visibility only. Opcodes, block text, menu items, and
 * every other app-specific decision stay with the caller, so nothing about a concrete app leaks
 * into this package.
 */
export function createBlockSurfaceBuilder(
  vocabulary: ScratchBlockVocabulary,
  options: BlockSurfaceBuilderOptions = {}
): BlockSurfaceBuilder {
  if (
    !isRecord(vocabulary) ||
    !isRecord(vocabulary.ArgumentType) ||
    !isRecord(vocabulary.BlockType)
  ) {
    throw hostError(
      'TWRH-BLOCK-001',
      'Block surface requires Scratch ArgumentType and BlockType records.'
    );
  }
  if (options.visible !== undefined && typeof options.visible !== 'boolean') {
    throw hostError('TWRH-BLOCK-001', 'Block surface visible must be boolean.');
  }
  const defaultVisible = options.visible ?? true;

  function build(spec: BlockSpec, blockTypeName: string, monitorable: boolean): BlockRecord {
    validateBlockSpec(spec);
    const visible = spec.visible ?? defaultVisible;
    const record: BlockRecord = {
      opcode: spec.opcode,
      blockType: requireBlockType(vocabulary, blockTypeName),
      text: spec.text,
      hideFromPalette: !visible
    };
    if (spec.arguments !== undefined) record.arguments = Object.freeze({...spec.arguments});
    if (monitorable && (spec.monitor ?? false) === false) record.disableMonitor = true;
    return Object.freeze(record);
  }

  return Object.freeze({
    reporter(spec: BlockSpec) {
      return build(spec, 'REPORTER', true);
    },
    boolean(spec: BlockSpec) {
      return build(spec, 'BOOLEAN', false);
    },
    command(spec: BlockSpec) {
      return build(spec, 'COMMAND', false);
    },
    hat(spec: BlockSpec) {
      return build(spec, 'HAT', false);
    },
    reporters(
      entries: readonly (readonly [string, string])[],
      reporterOptions: {visible?: boolean; monitor?: boolean} = {}
    ) {
      if (!Array.isArray(entries)) {
        throw hostError('TWRH-BLOCK-002', 'Block reporters must be an array of entries.');
      }
      return Object.freeze(
        entries.map(([opcode, text]) =>
          build(
            {
              opcode,
              text,
              ...(reporterOptions.visible === undefined ? {} : {visible: reporterOptions.visible}),
              ...(reporterOptions.monitor === undefined ? {} : {monitor: reporterOptions.monitor})
            },
            'REPORTER',
            true
          )
        )
      );
    },
    stringArgument(defaultValue = '') {
      return Object.freeze({type: requireArgumentType(vocabulary, 'STRING'), defaultValue});
    },
    numberArgument(defaultValue = 0) {
      return Object.freeze({type: requireArgumentType(vocabulary, 'NUMBER'), defaultValue});
    },
    menuArgument(menu: string) {
      if (typeof menu !== 'string' || menu.length === 0) {
        throw hostError('TWRH-BLOCK-002', 'A menu argument must name a non-empty menu.');
      }
      return Object.freeze({type: requireArgumentType(vocabulary, 'STRING'), menu});
    },
    menu(items: readonly string[], menuOptions: {acceptReporters?: boolean} = {}) {
      if (!Array.isArray(items) || items.length === 0) {
        throw hostError('TWRH-BLOCK-002', 'A block menu must list at least one item.');
      }
      return Object.freeze({
        acceptReporters: menuOptions.acceptReporters ?? false,
        items: Object.freeze([...items])
      });
    },
    surface(
      blocks: readonly BlockRecord[],
      menus: Readonly<Record<string, BlockMenuRecord>> = {}
    ) {
      if (!Array.isArray(blocks)) {
        throw hostError('TWRH-BLOCK-002', 'A block surface must provide an array of blocks.');
      }
      const opcodes = new Set<string>();
      for (const block of blocks) {
        if (opcodes.has(block.opcode)) {
          throw hostError('TWRH-BLOCK-002', `Duplicate block opcode: ${block.opcode}`);
        }
        opcodes.add(block.opcode);
      }
      return Object.freeze({
        blocks: Object.freeze([...blocks]),
        menus: Object.freeze({...menus})
      });
    }
  });
}

export type ScalarBlockValueType = 'string' | 'number' | 'boolean';

export type ScalarBlockValueResult =
  | Readonly<{ok: true; value: string | number | boolean}>
  | Readonly<{ok: false; code: string}>;

/**
 * Coerce one Scratch block argument to a scalar of the named type.
 *
 * Scratch hands every argument over as a string, so a writable scalar surface has to decide what
 * counts as a number or a boolean. That decision is the same in every app, while the diagnostic
 * codes are not, so the prefix is injectable the way {@link createTurboWarpBroadcastPort} does it.
 */
export function coerceScalarBlockValue(
  value: unknown,
  type: string,
  options: {errorCodePrefix?: string} = {}
): ScalarBlockValueResult {
  const prefix = options.errorCodePrefix ?? 'TWRH';
  if (type === 'string') return Object.freeze({ok: true as const, value: String(value ?? '')});
  if (type === 'number') {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number)
      ? Object.freeze({ok: true as const, value: number})
      : Object.freeze({ok: false as const, code: prefixedCode(prefix, 'VARIABLE-WRITE-VALUE')});
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return Object.freeze({ok: true as const, value});
    if (value === 'true') return Object.freeze({ok: true as const, value: true});
    if (value === 'false') return Object.freeze({ok: true as const, value: false});
    return Object.freeze({ok: false as const, code: prefixedCode(prefix, 'VARIABLE-WRITE-VALUE')});
  }
  return Object.freeze({ok: false as const, code: prefixedCode(prefix, 'VARIABLE-WRITE-TYPE')});
}
