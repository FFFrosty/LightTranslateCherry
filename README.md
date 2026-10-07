# LightTranslate Cherry

从 Cherry Studio 划词翻译组件抽取、改造的独立 Windows 桌面原型。使用 Electron + React，按 **AGPL-3.0** 开源，与原 WinForms 版 LightTranslate 是两个独立项目。

## 试用

启动 `release/win-unpacked/LightTranslate Cherry.exe`。请保留整个 `win-unpacked` 文件夹，不能只复制 EXE。

- 在支持辅助功能取词的应用中选中文字，点击浮动工具条的“翻译”。划词本身不会向模型发起请求。
- 点击图钉后，窗口持续置顶，并在下一次翻译时保留；未固定的旧结果会被下一次结果替换。
- 翻译窗口可以拖动标题栏、从四边和四角调整大小；关闭一个窗口不影响其他固定窗口。
- 双击托盘图标打开手动输入，Ctrl+Enter 翻译；Ctrl+Alt+Y 尝试翻译当前选区。
- 结果窗口支持原文折叠、目标语言切换、停止、重试、复制与 Markdown。
- 在托盘菜单暂停划词监听，或退出程序。默认不会安装自启动。

旧版 LightTranslate 的快捷键是 Ctrl+Alt+T，本原型使用 Y。两个程序同时监听会出现两套工具条，试用时建议暂时退出旧版。

## 模型配置与隐私

此原型首次启动会读取当前 Windows 用户的 `%LOCALAPPDATA%\LightTranslate\profile.bin`，解密并导入旧版已保存的模型配置；旧文件保持只读。导入成功后，配置在本项目自己的用户目录中加密保存，运行不再需要旧版或 Cherry Studio 保持打开。

当前原型尚未提供通用的模型配置编辑器或直接解析 Cherry 数据库的入口。没有旧版配置时，可打开界面，但不能真实翻译；可使用 `npm start -- --demo` 离线体验界面。不要将密钥、`profile.bin` 或用户配置提交到仓库。

手动窗口上方显示当前提供商和模型。遇到 HTTP 402 时，应核对这里实际使用的服务；不同提供商的账户余额互不代表。旧版切换服务后，需要在本程序点击“重新导入配置”。更新程序或配置后若仍显示旧服务，请从托盘完整退出，再启动。0.1.2 起错误提示会去除 Electron 内部调用前缀；这项显示修复本身不会改变服务账户的余额或配额。

模型鉴权只在主进程处理，界面仅收到提供商和模型名称。只有明确点击翻译或使用翻译快捷键时，选中文字才发送至配置的模型服务。翻译内容不自动保存到文件；日志和错误不会输出密钥或完整服务响应。

## 当前范围

目标语言：简体中文、英语、日语、韩语、法语、德语、西班牙语。中日韩来源提示使用简单文字特征，其他文字显示“自动识别”；首选为中文时，中文内容转为备选英语。手动语言切换始终可用。

原生取词组件的自动 Ctrl+C 回退仍禁用。Edge 的 PDF 辅助功能接口可能返回缺少空格或开头的文字，因此对 Edge 的明确翻译点击／快捷键使用独立的复制取词路径：先核验原窗口身份并保存剪贴板各格式，再触发复制；只接受新产生的选区文本，并在剪贴板未被其他操作修改时恢复原内容。遇到不支持保存的剪贴板格式、失焦或复制超时，会提示失败，不会把旧剪贴板或已知可能损坏的辅助功能文字当作原文。

这条路径会触发系统复制事件，不能撤销第三方剪贴板历史工具的记录。其他应用仍通过辅助功能取词；不提供选区的 PDF 阅读器或其他应用可改用手动输入。当前没有自动更新、安装器或代码签名；这是用于验证移植路线的原型。

## 开发和构建

需要 Windows x64、Node.js 22.12+（本次使用 22.22.3）和 npm。复制取词助手通过 Windows 自带的 .NET Framework 4.x C# 编译器构建，使用系统的 .NET Framework；发布文件包含 Electron 运行时，不需要另装 Node.js 或 .NET 8。

```powershell
npm ci
npm run runtime
npm run icons
npm run notices
npm run typecheck
npm test
npm run build
npm run test:desktop
npm run pack
```

`runtime` 从 Electron 官方发布源下载并校验运行时，支持现有的 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 环境配置。`pack` 生成 `release/win-unpacked`。

桌面验收脚本使用独立 `--demo` 数据目录、模拟译文、不加载原生监听、不读取个人模型配置、不发送网络请求。它测试真实 Electron 窗口的焦点、固定保留、替换、缩放和并行取消；不能替代在所有第三方应用中的真实划词测试。

## 源码来源和许可

Cherry Studio 上游提交：`dd0767e1e7ecd8e37f44376382f35cb7ba04bea8`。

本项目实际移植了 `ActionWindow`、`ActionTranslate`、`WindowFooter` 与 `SelectionToolbarView`，将共享状态、服务和 UI 依赖替换为独立实现，保留了主要结构、交互与布局。原始文件及 SHA-256 见 `vendor/cherry/SOURCES.json`；修改说明见 `NOTICE.md`。

本项目整体按 GNU AGPL v3 发布，完整条款见 `LICENSE`；第三方许可见 `THIRD_PARTY_NOTICES.md`。软件不提供保证。发布二进制时应同时提供该二进制对应的完整源码、锁文件和构建脚本。本项目不是 Cherry Studio 官方产品，名称和 Logo 为独立标识。
