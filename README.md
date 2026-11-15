# turbowarp-runtime-adapter

[日本語](README.ja.md)

`@kubohiroya/turbowarp-runtime-adapter` provides app-neutral adapters for interacting with the TurboWarp runtime from unsandboxed extensions and packaged TurboWarp apps.

This package intentionally does not define app-specific DSL semantics, block metadata, story/navigation behavior, pose handling, or 3D scene graph policy. Those remain in the app package `@kubohiroya/turbowarp-kamishibai-app` (repository: `tm-kamishibai`) or domain libraries such as `@kubohiroya/turbowarp-3d-scene-dsl`.

## Scope

- Resolve a runtime from `Scratch.vm.runtime` or an explicit runtime object.
- Subscribe to runtime events with disposable listeners.
- Start hats through a small validated host adapter.
- Read the Stage target, the sprite targets, the renderer, and the monitor stores.
- Provide a generic `broadcastMessageAndWait` port for exact Stage broadcast names.
- Build the repetitive parts of an extension `getInfo()` block list.
- Write extension warnings and errors to the Logs tab of the editor's debugger.
- Keep Scratch VM access behind a narrow interface.

## Runtime surface

`createTurboWarpRuntimeHost` returns one adapter per session. Inject it rather than passing a raw
runtime around: a consumer that only needs the Stage then depends on `getStageTarget()` alone, not
on the whole runtime shape.

| Member | Reads |
| --- | --- |
| `runtime` | the validated runtime, for anything this package does not own yet |
| `onRuntimeEvent(event, listener)` | subscribes and returns a disposer |
| `startHats(opcode, matchFields?)` | always an array, never `undefined` |
| `stopThread(thread)` / `currentThreads()` | `_stopThread` / `threads` |
| `getStageTarget()` | `getTargetForStage()` |
| `targets()` / `spriteTargets()` | `targets`, copied; `spriteTargets` drops the Stage |
| `getRenderer()` / `requestRedraw()` | `renderer`; `requestRedraw` is a no-op when absent |
| `getMonitorBlocks()` / `getMonitorState()` | the validated monitor block store and record map |

## Block surfaces

`createBlockSurfaceBuilder` takes the `Scratch.BlockType` / `Scratch.ArgumentType` pair an
extension already has and builds block records from it. It owns record shape, palette visibility,
reporter monitor defaults, and duplicate-opcode detection. Opcodes, block text, and menu items stay
with the caller, so no app vocabulary enters this package.

```ts
import {coerceScalarBlockValue, createBlockSurfaceBuilder} from '@kubohiroya/turbowarp-runtime-adapter';

const build = createBlockSurfaceBuilder({ArgumentType, BlockType}, {visible: stateVisible});
const surface = build.surface(
  [
    build.reporter({opcode: 'sceneId', text: 'current scene id'}),
    ...build.reporters([
      ['status', 'story status'],
      ['version', 'runtime version']
    ]),
    build.command({
      opcode: 'setVariable',
      text: 'set [NAME] to [VALUE] as [TYPE]',
      arguments: {
        NAME: build.stringArgument(),
        VALUE: build.stringArgument(),
        TYPE: build.menuArgument('scalarTypes')
      },
      visible: writeVisible
    })
  ],
  {scalarTypes: build.menu(['string', 'number', 'boolean'])}
);

const written = coerceScalarBlockValue(args.VALUE, args.TYPE, {errorCodePrefix: 'K4'});
```

## Debugger log

`createTurboWarpDebuggerLog({Scratch, source})` writes an extension's warnings and errors to the Logs tab of the editor's debugger add-on, where every extension using it and the project's own log blocks show together. Each entry starts with `[source]`.

```js
const log = createTurboWarpDebuggerLog({Scratch, source: 'My extension'});
log.warn('Camera unavailable.', error);
log.error('Playback failed.', error);
```

- The runtime is `runtime`, or else `Scratch.vm.runtime`, as `createTurboWarpRuntimeHost` resolves it. A runtime that is given must be one (`TWRH-RUNTIME-001` otherwise). Without any, entries only reach the console.
- `log`, `warn` and `error` take a message, an optional detail (an `Error` becomes `Name: message [code]`, a plain object JSON of at most about `maxLength` characters). Each returns whether the entry reached the debugger.
- An entry is not linked to a block. The add-on previews the first input of a linked block, and that preview fails on most blocks other than its own log blocks (a number input, for one), which stops the whole Logs list from drawing.
- The entry always goes to the console too, unchanged and with the detail as a separate argument, so developer tools keep the stack. Pass `console: null` to write only to the debugger.
- The Logs tab can export its entries, so the debugger's text goes through `redact` first. The default, `redactDebuggerLogText`, keeps only the origin and path of a URL, replaces local file paths with `[local path]` and credentials after `token=`, `password:` and the like with `[redacted]`. `redact: null` keeps the text as it is.
- Entries go through the add-on's own log, warn and error blocks (`runtime.getAddonBlock`), so the VM and the GUI need no new interface. Without the add-on (a player, the packager, the add-on turned off) `available()` is false and entries only reach the console.
- An entry longer than `maxLength` characters (1000 by default) is cut between characters, never inside one.

## Compatibility

Consumers that already expose stable app-specific diagnostics can pass `errorCodePrefix`. For example, `tm-kamishibai` can keep `K4-BROADCAST-*` errors while delegating the runtime interaction mechanics to this package.

## Example

```ts
import {
  createTurboWarpBroadcastPort,
  createTurboWarpRuntimeHost
} from '@kubohiroya/turbowarp-runtime-adapter';

const host = createTurboWarpRuntimeHost({Scratch});
const broadcast = createTurboWarpBroadcastPort({
  runtime: host.runtime,
  errorCodePrefix: 'K4'
});

const dispose = host.onRuntimeEvent('PROJECT_STOP_ALL', () => {
  console.log('stopped');
});

await broadcast.broadcastMessageAndWait(
  {message: 'openScene'},
  {signal: new AbortController().signal}
);

dispose();
```

## Development

```bash
npm install --global corepack@latest
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
