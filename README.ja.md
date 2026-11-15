# turbowarp-runtime-adapter

[English](README.md)

`@kubohiroya/turbowarp-runtime-adapter` は、unsandboxed extension や packaged TurboWarp app から TurboWarp runtime を操作するための、アプリ非依存の adapter を提供します。

この package は、アプリ固有の DSL semantics、block metadata、story/navigation、pose、3D scene graph policy を定義しません。それらは app package `@kubohiroya/turbowarp-kamishibai-app`（repository: `tm-kamishibai`）や domain library `@kubohiroya/turbowarp-3d-scene-dsl` 側に残します。

## 役割

- `Scratch.vm.runtime` または明示された runtime object から runtime を解決する。
- runtime event を disposable listener として購読する。
- 小さく検証された host adapter 経由で hats を起動する。
- Stage target、sprite target、renderer、monitor store を読む。
- Stage に宣言された exact broadcast name 用の汎用 `broadcastMessageAndWait` port を提供する。
- 機能拡張の警告とエラーを、エディターのデバッガーの Logs タブへ書く。
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

## デバッガーのログ

`createTurboWarpDebuggerLog({Scratch, source})` は、機能拡張の警告とエラーを、エディターのデバッガーアドオンの Logs タブへ書く。これを使うすべての機能拡張と、作品自身のログブロックの出力が、同じ場所に並ぶ。各行の先頭には `[source]` を付ける。

```js
const log = createTurboWarpDebuggerLog({Scratch, source: 'My extension'});
log.warn('Camera unavailable.', error);
log.error('Playback failed.', error);
```

- 書き込み先の runtime は `runtime`、なければ `createTurboWarpRuntimeHost` と同じく `Scratch.vm.runtime` から取る。渡した runtime が runtime でなければ `TWRH-RUNTIME-001` を投げる。どちらもなければコンソールにだけ出す。
- `log`・`warn`・`error` は、メッセージと省略できる詳細を受け取る。詳細は、`Error` なら `名前: メッセージ [code]`、普通のオブジェクトならおよそ `maxLength` 文字までの JSON にする。デバッガーに届いたかどうかを返す。
- 行はブロックに結び付けない。アドオンは結び付いたブロックの最初の入力をプレビューするが、自分のログブロック以外の多くのブロック（たとえば数値の入力）ではそのプレビューが失敗し、Logs の一覧全体が描かれなくなる。
- 同じ内容は常にコンソールにも、手を加えずに出す。詳細は別の引数で渡すので、開発者ツールではスタックも見られる。デバッガーだけに書くときは `console: null` を渡す。
- Logs タブは内容を書き出せるので、デバッガーへ渡す文は先に `redact` を通す。既定の `redactDebuggerLogText` は、URL を origin とパスだけにし、ローカルのファイルパスを `[local path]` に、`token=`・`password:` などの後ろの値を `[redacted]` に置き換える。`redact: null` ならそのまま渡す。
- 書き込みにはアドオン自身の log・warn・error ブロック（`runtime.getAddonBlock`）を使う。VM と GUI に新しい口は要らない。アドオンがない環境（プレイヤー、パッケージャー、アドオンを切ったとき）では `available()` が false になり、コンソールにだけ出す。
- `maxLength` 文字（既定は 1000）を超える行は、文字の途中では切らずに切り詰める。

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
npm install --global corepack@latest
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
