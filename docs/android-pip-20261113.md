# Android 悬浮窗与全屏验收

日期：2026-11-13。本轮实现 Android 视图悬浮与还原，未发布镜像或推送代码。

## 交互

- “悬浮窗”“全屏”位于 Android 底部 status 栏右侧，同一行；操作较多时左侧横向滚动，右侧窗口按钮固定可见。
- 支持 Document Picture-in-Picture 且处于安全上下文时打开独立画中画窗口；API 缺失或调用被浏览器策略拒绝时回退到网页内悬浮窗。
- 网页内悬浮窗没有地址栏和额外标题栏，用底部拖动手柄移动、右下角手柄缩放；尺寸与位置限制在浏览器视口内。
- 独立画中画窗口由浏览器管理其原生顶部栏，网页不隐藏来源提示。独立窗口内不提供不受支持的全屏入口。
- 还原或关闭小窗自动切回原 Android 标签页，保留原会话、画布和解码器；切换其他标签页时小窗继续显示和接受输入。
- 关闭 Android 连接标签页时清理悬浮窗、后端会话、前端解码器与缓存；处理尚未完成的弹窗请求，避免关闭后再次出现小窗。

## 验证

本机 redroid Android 12，网络 ADB；生产前端构建及本机 server-production 可执行文件。Playwright Chromium 实际调用 Document Picture-in-Picture API，并在其子窗口点击 Android Gallery，由 Android resumed activity 验证输入确实到达设备。

- 相关单元测试：4 个测试文件，40 项通过。
- 原生画中画：真实 Android 输入、跨标签页保留、浏览器关闭窗口后还原并激活原标签页。
- 网页内回退：模拟 API 缺失，测试拖动、缩放、其他标签页中继续操作、关闭还原。
- 模拟浏览器拒绝 requestWindow，自动回退成功。
- 全屏进入与退出成功。
- 使用画布 DOM 身份标记验证全过程同一个 canvas，无重复画布。
- 关闭连接标签页（含项目原有确认框）后小窗被清理。
- 前端生产构建和 Go server-production 构建成功；浏览器测试未出现 pageerror。
- 全量 vue-tsc 仍存在仓库既有错误；新增悬浮窗模块和 AndroidTabContent 未报告类型错误。

复测脚本：`tools/android/pip-live.mjs`；环境变量见 `tools/android/README.md`。

## 证据说明

`android-pip-page.png` 为网页内悬浮窗实测截图；`android-pip-native.png` 为原生 PiP 的内容区域截图，浏览器截图接口不包含操作系统/浏览器外框，不能据此认为来源栏已隐藏。`android-status.png` 展示 status 栏按钮。视频记录主页面的弹出占位、回退小窗拖动缩放、还原和关闭连接，独立 PiP 子窗口不会被合成进主页面录像。

本轮没有进行跨浏览器全覆盖或长期性能基准测试；原生画中画支持范围以运行时检测为准。
