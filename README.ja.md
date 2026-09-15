# turbowarp-runtime-adapter

[English](README.md)

`@kubohiroya/turbowarp-runtime-adapter` は、unsandboxed extension や packaged TurboWarp app から TurboWarp runtime を操作するための、アプリ非依存の adapter を提供します。

この package は、アプリ固有の DSL semantics、block metadata、story/navigation、pose、3D scene graph policy を定義しません。それらは `tm-kamishibai` や `tm-3d-app` などの app package 側に残します。

## 役割

- `Scratch.vm.runtime` または明示された runtime object から runtime を解決する。
- runtime event を disposable listener として購読する。
- 小さく検証された host adapter 経由で hats を起動する。
- Stage target、sprite target、renderer、monitor store を読む。
- Stage に宣言された exact broadcast name 用の汎用 `broadcastMessageAndWait` port を提供する。
- extension の `getInfo()` block list のうち定型部分を組み立てる。
- Scratch VM への直接アクセスを狭い interface に閉じ込める。

## runtime surface

`createTurboWarpRuntimeHost` は session ごとに 1 つの adapter を返します。raw runtime を持ち回すのではなく
この adapter を注入してください。Stage しか必要としない consumer は、runtime 全体の形ではなく
`getStageTarget()` だけに依存できます。

| member | 参照先 |
| --- | --- |
| `runtime` | 検証済み runtime。この package がまだ所有していない操作向け |
| `onRuntimeEvent(event, listener)` | 購読し、解除関数を返す |
| `startHats(opcode, matchFields?)` | 常に配列。`undefined` を返さない |
| `stopThread(thread)` / `currentThreads()` | `_stopThread` / `threads` |
| `getStageTarget()` | `getTargetForStage()` |
| `targets()` / `spriteTargets()` | `targets` の複製。`spriteTargets` は Stage を除く |
| `getRenderer()` / `requestRedraw()` | `renderer`。`requestRedraw` は未提供なら no-op |
| `getMonitorBlocks()` / `getMonitorState()` | 検証済みの monitor block store と record map |

## block surface

`createBlockSurfaceBuilder` は、extension が既に持っている `Scratch.BlockType` / `Scratch.ArgumentType`
を受け取って block record を組み立てます。record の形、palette 可視性、reporter の monitor 既定値、
opcode 重複検出だけを所有します。opcode・block text・menu 項目は caller 側に残るため、アプリ固有の
語彙はこの package に入りません。

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

## 互換性

既存 app が安定した app 固有 diagnostics を公開している場合は、`errorCodePrefix` を渡せます。たとえば `tm-kamishibai` は runtime interaction mechanics をこの package に委譲しつつ、`K4-BROADCAST-*` error を維持できます。

## 使用例

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

## 開発

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
