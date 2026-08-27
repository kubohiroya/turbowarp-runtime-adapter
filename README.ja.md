# turbowarp-runtime-host

[English](README.md)

`@kubohiroya/turbowarp-runtime-host` は、unsandboxed extension や packaged TurboWarp app から TurboWarp runtime を操作するための、アプリ非依存の adapter を提供します。

この package は、アプリ固有の DSL semantics、block metadata、story/navigation、pose、3D scene graph policy を定義しません。それらは `tm-kamishibai` や `tm-3d-app` などの app package 側に残します。

## 役割

- `Scratch.vm.runtime` または明示された runtime object から runtime を解決する。
- runtime event を disposable listener として購読する。
- 小さく検証された host adapter 経由で hats を起動する。
- Stage に宣言された exact broadcast name 用の汎用 `broadcastMessageAndWait` port を提供する。
- Scratch VM への直接アクセスを狭い interface に閉じ込める。

## 互換性

既存 app が安定した app 固有 diagnostics を公開している場合は、`errorCodePrefix` を渡せます。たとえば `tm-kamishibai` は runtime interaction mechanics をこの package に委譲しつつ、`K4-BROADCAST-*` error を維持できます。

## 使用例

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

## 開発

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
