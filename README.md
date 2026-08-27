# turbowarp-runtime-host

[日本語](README.ja.md)

`@kubohiroya/turbowarp-runtime-host` provides app-neutral adapters for interacting with the TurboWarp runtime from unsandboxed extensions and packaged TurboWarp apps.

This package intentionally does not define app-specific DSL semantics, block metadata, story/navigation behavior, pose handling, or 3D scene graph policy. Those remain in app packages such as `tm-kamishibai` and `tm-3d-app`.

## Scope

- Resolve a runtime from `Scratch.vm.runtime` or an explicit runtime object.
- Subscribe to runtime events with disposable listeners.
- Start hats through a small validated host adapter.
- Provide a generic `broadcastMessageAndWait` port for exact Stage broadcast names.
- Keep Scratch VM access behind a narrow interface.

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
