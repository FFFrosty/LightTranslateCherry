# LightTranslate Cherry — 来源与修改说明

本项目是独立的划词翻译工具，包含从 Cherry Studio 抽取、修改的代码；不是 Cherry Studio 官方发行版。

- 上游：https://github.com/CherryHQ/cherry-studio
- 来源提交：`dd0767e1e7ecd8e37f44376382f35cb7ba04bea8`
- 来源许可：GNU Affero General Public License v3.0，见 `LICENSE`。
- 本项目修改日期：2026-10-07。
- 原始组件快照及路径清单见 `vendor/cherry/` 和 `vendor/cherry/SOURCES.json`。

主要修改：将划词工具条、翻译结果窗口及其内容和操作区移植到独立 React 应用；去除 Cherry 主程序状态、聊天与 Agent 依赖；接入独立的 Electron 进程通信、模型配置、翻译客户端及窗口管理。保留上游版权与许可声明。项目使用自有名称与 Logo，不表示上游为此项目背书。

本程序按 AGPL-3.0 发布，不提供保证。分发程序时应同时提供对应版本完整源码、构建脚本、依赖锁文件和许可声明。
