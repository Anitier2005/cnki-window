This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

> **本仓库的现状（2026-10 整理）**：导航仍用 React Navigation（`src/app/navigation/`），
> 没有迁到 Expo Router。原因是路由参数里直接传了整个 `CnkiDoc` 对象，而
> Expo Router 的参数只能走 URL 字符串，迁移必须同时改掉详情页的数据流
> （只传 href/id，进页面再取）。这是一次行为变更，不适合放在收尾阶段做。
> 新写页面按 B 方案来：路由参数只传可序列化的标量。

## 目录分层（必须遵守）

```
src/app/      应用外壳：App.tsx、导航
src/core/     内核：api / bridge / storage / types，不含任何界面代码
src/features/ 业务：一个功能一个文件夹（search / detail / reader / library / settings）
src/shared/   跨功能复用：components / hooks / theme
```

- 依赖方向单向：`app → features → core → shared`，禁止反向引用。
- 跨目录导入一律写 `@/…`（tsconfig paths），不写 `../../`。
- 只有被两个以上功能用到的代码才升到 `shared`。
- 静态资源跟随使用方，不要堆在根 `assets/`。

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
