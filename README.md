# cnki-window（知网阅览）

一个 React Native 客户端，用来在手机上以**机构 IP 授权**的方式访问知网，界面全部原生渲染。

## 它解决的两个问题

1. **知网手机版（m.cnki.net）没有 IP 登录入口**，只有电脑版才有。校园网用户因此在手机上无法使用机构订购的全文资源。
2. **电脑版页面直接塞进手机浏览器无法阅读** —— 三栏布局、十几列表格、固定 1200px 宽度，手机上必须反复缩放拖动。

因此本应用的策略是：

> 用**桌面 UA** 连接知网 PC 站（这样才存在 IP 登录与完整接口），但**只取数据**；界面 100% 由 React Native 原生渲染，按手机阅读习惯重新排版。

用户在正常使用过程中看不到任何知网原始页面 —— 唯一一次看到，是手动完成 IP 登录/滑块验证的时候。

## 运行

依赖里有原生模块（`react-native-webview`、`expo-file-system`、`expo-sharing`），
**Expo Go 跑不起来**，要用开发构建：

```bash
npm install
npx expo run:android          # 本地编一个 dev 包并装到设备
# 或：npm run build:android   # 直接出 release 包
```

首次启动会连接知网并建立会话。

> 建议用真机 + 校园网测试。模拟器连的是电脑的网络，IP 授权取决于电脑出口 IP。

## 首次使用：完成 IP 登录

1. 连接**校园网 Wi-Fi**（或确认设备出口 IP 在机构授权段内）。
2. 打开 App。首页顶部会有一条状态提示：
   - 绿色「XX 大学」→ IP 授权已生效，可直接检索下载。
   - 黄色「未检测到机构权限」→ 点它。
3. 点「去登录」会打开知网登录页（桌面版式，可双指缩放）。
   - 若页面有 **IP 登录** 按钮，点它即可。
   - 若知网要求滑块验证，手动滑一次。
   - 判断成功的标准：页面右上角出现你所在的机构名称。
4. 点右上角「完成」返回。App 会重新探测权限，状态条变绿即成功。

会话（cookie）会保留在 WebView 里，之后重启 App 一般无需重复登录。

## 技术架构

```
┌────────────────────────────────────────────┐
│ React Native 原生 UI                        │
│  首页 / 结果列表 / 详情 / 收藏 / 设置         │
└───────────────▲────────────────────────────┘
                │ postMessage (JSON)
┌───────────────┴────────────────────────────┐
│ 常驻 WebView（桌面 UA，离屏）                │
│  ├─ 注入 bridge 脚本：window.__CNKI__        │
│  ├─ 同源 fetch（自动带 cookie，无 CORS）      │
│  └─ DOMParser 解析服务端渲染的 HTML           │
└────────────────────────────────────────────┘
```

几个关键决策：

- **为什么用 WebView 而不是纯 fetch**：知网对新会话会 302 到滑块验证
  （`/verify/home?captchaType=blockPuzzle`）。纯 HTTP 客户端过不去，也没有正当理由去破解。
  放在 WebView 里，验证由用户手动完成一次，之后复用 cookie。
- **为什么在 WebView 里解析**：RN 没有 DOM，用正则在几百 KB 的 HTML 里抠字段既慢又脆。
  注入脚本里有完整的 `DOMParser`，按 CSS 选择器抽取后只回传结构化 JSON。
- **为什么 WebView 常驻且不能卸载**：会话和验证状态绑在这个 WebView 上。页面切换时若被销毁，
  下次请求会重新触发验证。因此它在 `SessionProvider` 里，位于 `NavigationContainer` 之上。
- **为什么隐藏时移出屏幕而不是 `display:none`**：部分内核会暂停不可见 WebView 的脚本执行，
  导致 cookie 写不进去。

## 目录

按「应用外壳 / 内核 / 共享 / 业务」四层切分，业务代码全部走 `@/` 别名，
不写 `../../`：

```
src/
├─ app/                        应用外壳：跑起来的东西
│  ├─ App.tsx                  Provider 组合（SafeArea → Session → Navigation）
│  └─ navigation/              Stack + Tabs 与路由参数类型
│
├─ core/                       内核：与界面无关、可被任意页面复用
│  ├─ api/
│  │  ├─ cnki.ts               检索 / 详情接口封装 + 选择器规则
│  │  ├─ query.ts              请求体构造（跨库 / 单库 / 来源类别）
│  │  ├─ download.ts           带会话的全文下载、落盘与打开
│  │  └─ mime.ts               扩展名 ↔ MIME 的唯一映射表
│  ├─ bridge/
│  │  ├─ script.ts             注入 WebView 的桥接脚本（fetch + DOM 抽取）
│  │  └─ SessionProvider.tsx   常驻 WebView、任务队列、会话探测、验证面板
│  ├─ storage/store.ts         收藏 / 历史 / 检索词（AsyncStorage）
│  └─ types/cnki.ts            领域类型
│
├─ features/                   业务：按功能切，一个功能一个文件夹
│  ├─ search/                  首页 + 检索结果（含搜索框、筛选面板）
│  ├─ detail/                  文献详情
│  ├─ reader/                  HTML / 原版阅读 + 应用内 PDF（连 pdf.js 资源）
│  ├─ library/                 收藏与浏览历史
│  └─ settings/                会话设置与接口诊断
│
└─ shared/                     跨功能复用，不含业务规则
   ├─ components/              文献卡片、空态、会话状态条
   ├─ hooks/                   响应式断点、状态栏样式
   └─ theme/theme.ts           设计 token
```

几条约定：

- **依赖方向单向**：`app → features → core → shared`，反过来一律不允许。
  `core` 里不会出现 `Alert`、导航、任何 `react-native` 以外的界面依赖。
- **一个功能的东西放一起**：不做 `screens/`、`components/` 全局平铺 ——
  那样每加一个功能就要在四个目录里各放一个文件，改的时候来回跳。
- **只有真被两个以上功能用到，才升到 `shared`**。
- **资源跟随使用方**：pdf.js 的产物放在 `features/reader/assets/`，
  谁用谁带，不堆在根 `assets/`（那里只放图标和启动图）。

## 常用命令

```bash
npm run lint        # ESLint 9 + eslint-config-expo
npm run format      # Prettier（单引号、100 列）
npm run typecheck   # tsc --noEmit
npm run build:android  # 打 arm64 release 包（脚本会兜底 JAVA_HOME）
```

## 已知限制

- **不破解任何付费内容**。能下载什么完全取决于你所连网络对应的机构订购范围，
  所有请求仍由知网服务端鉴权。
- **全文是 PDF/CAJ 固定版式**，手机上只能缩放浏览，本应用不做版式重排。
  摘要、关键词、出处等元信息则是原生排版，这部分才是日常高频阅读的内容。
- **筛选（类型/年份）作用于已加载结果**。知网跨库检索的类型过滤参数在不同版本里不一致，
  与其拼一个不可靠的后端参数，不如在前端做确定性过滤。
- 知网前端改版会让解析规则失效，此时用「设置 → 接口诊断」定位。

## 授权判定的确定性依据

不要再靠扫页面文本猜机构名。知网自己的登录组件
（`login.cnki.net/tlogin/scripts/loginState.js`）已经把规则写死了：

```js
if (!vj)                        → 未登录
else if (vj.UserType === "jf")  → 个人账号
     ├ vj.BUserType === "bk"    → 个人 + 机构（机构名 = BShowName）
     └ 否则                     → 纯个人
else                            → 机构/IP 登录（机构名 = ShowName）
```

`vj` 就是 cookie `Ecp_LoginStuts` 里的 JSON。它是 JS 可读的，所以在
WebView 里 `document.cookie` 直接能拿到，不受页面版式影响。
页头机构名的固定位置是 `.ecp_header_unitName`，只作为兜底。

## 检索「搜不到」的真正原因

会话没过人机验证时，`/kns8s/brief/grid` **照样回 200**，但内容固定是 74 字节：

```html
<div id="briefBox"><p class="no-content" value="">抱歉，暂无数据，请稍后重试。</p></div>
```

它和「这个关键词真的没结果」文案完全一样，只能靠长度和结构区分。
App 现在把这种情况判为 `softBlocked`，明确提示去完成验证，
而不是显示一句没有信息量的「暂无数据」。

## 排查

**设置 → 接口诊断 → 运行自检**，会做一次真实检索并报告数据通道状态。

常见情况：

| 现象 | 原因 | 处理 |
|---|---|---|
| 提示「需要先在知网页面完成一次人机验证」 | 会话没过滑块，检索接口返回 74 字节空壳 | 点「去验证」，在打开的知网页面拖一次滑块，回来重试 |
| 状态条显示未授权，但学校确实买了库 | 出口 IP 不在订购段内 / 没走对线路 | 用手机浏览器打开 www.cnki.net，右上角没有学校名就是网络侧问题 |
| 检索返回 0 条但知网网页能搜到 | 选择器变更 | 改 `src/core/api/cnki.ts` 里的 `SEARCH_SPEC`，对照线上页面结构补一个候选选择器 |
| 详情页摘要为空 | 详情页结构变更 | 改 `DETAIL_SPEC` 的选择器 |
| 状态条一直黄色 | 设备不在机构 IP 段内 | 确认连的是校园网，或用 VPN 回校园网 |

所有选择器都支持**逗号分隔多个候选**（CSS 的"或"语义），改版时补一个新的候选即可，通常不用动 UI。

## 合规说明

本项目是个人学习用途的第三方客户端，与同方知网无隶属关系，不内置、不分发任何文献内容。
使用时请遵守所在机构的数据库使用协议，不要批量下载。

## 本地打 APK（Windows）

前置组件：JDK 17、Android SDK（platform-37 / build-tools 36.0.0 / NDK 27.1.12297006 / CMake 3.22.1）。

```bash
export JAVA_HOME="/path/to/jdk-17"
export ANDROID_HOME="/path/to/Android/Sdk"
npm run build:android          # 等价于 cd android && ./gradlew assembleRelease
```

产物：`android/app/build/outputs/apk/release/app-release.apk`
（仅含 arm64-v8a；如需多 ABI，改 `gradle.properties` 的 `reactNativeArchitectures`）

### Windows 上必须替换 ninja

RN 0.88 只支持新架构，`safe-area-context` / `screens` / `svg` 要现场编译 C++。
CMake 会把源码的**绝对路径**镜像进对象目录，最长 337 字符，超过 Windows 的 260 限制，
表现为 `ninja: error: mkdir(...): No such file or directory`。

即使 `LongPathsEnabled=1` 也没用——Android SDK 自带的 ninja 1.10.2 的清单里没有
`longPathAware`，Win32 API 仍按 260 截断。替换成 1.13+ 即可：

```bash
pip download ninja --no-deps -d /tmp/ninja
# 解出 wheel 里的 ninja-*.data/scripts/ninja.exe，
# 覆盖 $ANDROID_HOME/cmake/3.22.1/bin/ninja.exe（原文件先备份）
$ANDROID_HOME/cmake/3.22.1/bin/ninja.exe --version   # 应显示 1.13.x
```

另外已把 `@react-native/codegen` 的 CMake 模板、以及 `react-native-screens` / `react-native-svg` /
`react-native-safe-area-context` 的 `CMakeLists.txt` 改成相对路径清单，进一步缩短对象路径。
**这些改动在 `npm install` 重装依赖后会丢失，需要重新应用**（见 git 历史或本段说明）。

## 常见问题

### 白屏 / "Error loading page · net::ERR_CLEARTEXT_NOT_PERMITTED"

中国知网的部分链路（登录跳转、验证码、老资源）仍走 `http://`，
而 Android 9+ 默认禁止明文流量。已在 `AndroidManifest.xml` 里
`android:usesCleartextTraffic="true"`，并在 WebView 上开了 `mixedContentMode="always"`。
如果安装的是修复前的包，重装新版即可。

### 检索提示"需要先过一次安全验证"

知网的风控（滑块）和 IP 登录是**两套东西**：

| | 影响什么 | 怎么通过 |
|---|---|---|
| 滑块验证 | 能不能检索、看摘要 | 点「去验证」拖一次滑块，会话会保留 |
| IP 登录 | 能不能下载全文 | 校园网内去登录页完成机构授权 |

没做 IP 登录时，检索、看题录和摘要都应该正常，只是下载全文会被拒。

### 检索返回"抱歉，暂无数据"

多半是会话没过风控，而不是没有结果。跑一次 **设置 → 接口诊断**，
它会同时显示状态和知网返回的原始片段，便于判断是风控还是解析规则失效。

## 检索接口要点（改版时对照）

`POST https://kns.cnki.net/kns8s/brief/grid`，表单里有两处容易写错：

1. `QueryJson.QNode.QGroup[].Items[]` 的键名必须是
   `Field / Value / Operator / Vector / Title`，写成 `Name / Operate` 之类的
   自造名，接口照样返回 200，但内容是「暂无数据」。
2. 第 2 页起 `boolSearch=false`，且必须回传第 1 页响应里的
   `#hidTurnPage` 令牌（`turnpage` 字段），否则知网会当成一次新检索返回空。
