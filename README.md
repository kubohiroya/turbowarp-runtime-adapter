# turbowarp-runtime-host

[日本語](README.ja.md)

`@kubohiroya/turbowarp-runtime-host` provides app-neutral adapters for interacting with the TurboWarp runtime from unsandboxed extensions and packaged TurboWarp apps.

This package intentionally does not define app-specific DSL semantics, block metadata, story/navigation behavior, pose handling, or 3D scene graph policy. Those remain in app packages such as `tm-kamishibai` and `tm-3d-app`.

## Scope

- Resolve a runtime from `Scratch.vm.runtime` or an explicit runtime object.
- Subscribe to runtime events with disposable listeners.
- Start hats through a small validated host adapter.
- Read the Stage target, the sprite targets, the renderer, and the monitor stores.
- Provide a generic `broadcastMessageAndWait` port for exact Stage broadcast names.
- Build the repetitive parts of an extension `getInfo()` block list.
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
import {coerceScalarBlockValue, createBlockSurfaceBuilder} from '@kubohiroya/turbowarp-runtime-host';

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

## Compatibility

Consumers that already expose stable app-specific diagnostics can pass `errorCodePrefix`. For example, `tm-kamishibai` can keep `K4-BROADCAST-*` errors while delegating the runtime interaction mechanics to this package.

## Example

```ts
import {
  createTurboWarpBroadcastPort,
  createTurboWarpRuntimeHost
} from '@kubohiroya/turbowarp-runtime-host';

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
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
