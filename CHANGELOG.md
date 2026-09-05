# Changelog

## 0.2.0

- Add target enumeration to the runtime host: `targets()` returns a copy of every loaded target and `spriteTargets()` drops the Stage. An absent target list reads as empty; a non-array one is a runtime fault.
- Add renderer access: `getRenderer()` returns the attached renderer and throws when there is none, while `requestRedraw()` stays a no-op on a runtime that does not provide it.
- Add monitor access: `getMonitorBlocks()` and `getMonitorState()` validate the `data_showvariable` / `data_hidevariable` block store and monitor record map before handing them back. `getMonitorState` is invoked with the runtime as its receiver.
- Add `createBlockSurfaceBuilder`, which builds the repetitive parts of an extension `getInfo()` block list from an injected `Scratch.BlockType` / `Scratch.ArgumentType` pair. It owns record shape, palette visibility, reporter monitor defaults, and duplicate-opcode detection; opcodes, block text, and menu items stay with the caller.
- Add `coerceScalarBlockValue` for the string/number/boolean coercion a writable scalar block surface needs, with the same injectable `errorCodePrefix` the broadcast port uses.
- No behavior change to any 0.1.0 export.

## 0.1.0

- Initial public package shape for app-neutral TurboWarp runtime host adapters.
- Add broadcast action port support with exact Stage broadcast lookup, owned-thread waiting, abort, and dispose behavior.
- Add compatibility-oriented error code prefixing for consumers that need stable app-specific error codes.
