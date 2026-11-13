# uniTerm Android 网络连接实现与验收

> 后续变更：Android 后端已迁移为内嵌 Go ADB 库，移除外部 adb 与 android-tools。以下为初版验收记录；当前实现与复测方式见 tools/android/README.md。

日期：2026-11-13。基于现有会话管理、认证网关和 session-proxy 接入 Android，使用网络 ADB + scrcpy 3.3.4；不包含 USB 连接。

## 已实现

- 远程桌面分类新增 Android；配置设备地址、连接端口，可选无线配对端口和六位配对码。配对码通过 stdin 提交，不保存为密码。
- 每个用户 worker 独立 ADB 服务和密钥目录；Docker 镜像内置 android-tools。
- H.264 投屏：优先 WebCodecs，不可用时采用软件 H.264 解码。
- 鼠标/触摸、滚轮、键盘、中文粘贴，返回、主页、最近任务、音量、电源、旋转、全屏。
- Android 音频通过网页播放，需浏览器用户交互激活。
- 文件上传/下载（单文件最大 256 MiB，下载限制 /sdcard/）、ADB Shell。
- 标签页切换保留连接；断线显示重连入口，处理设备重启后的 ADB offline 状态；重连替换旧画布，避免重复显示。

## 实测环境

Linux 本机运行 redroid Android 12，720×1280，软件 GPU。redroid 的宿主机 ADB 仅监听 127.0.0.1:15555；uniTerm Docker 通过容器网络连接。浏览器为 Playwright Chromium。

本地验证镜像：`uniterm/android-test:local`，已构建成功；本轮未发布镜像仓库。

## 验收结果

| 项目 | 结果与证据 |
| --- | --- |
| Go Android 测试 | 5 项通过，含真实 redroid H.264 数据、控制、1,000,000 字节文件往返及断开路由清理 |
| 前端相关测试 | 3 个测试文件、35 项通过 |
| 生产构建 | 前端与最终 Linux amd64 Docker 镜像成功 |
| 实际页面控制 | 点击打开 Gallery，以 Android resumed activity 验证；主页/返回/最近任务可用 |
| 切换标签页 | 返回后保持原有 Android 会话 |
| 浏览器文件传输 | 1,048,597 字节、中文文件名上传下载一致；SHA256：9e3ad6ecee087048754ec8e224ff149667fb834a2920ba0fcad6ff588a3bcf9a |
| 重启恢复 | 实际停止 redroid，网页识别断开；重新启动后点击重连成功 |
| 软件解码回退 | 在最终 Docker 镜像禁用 VideoDecoder，显示 H.264 software，画面/按键可用，无浏览器异常 |
| Shell | 返回 uniterm-shell-ok |
| 中文粘贴 | Android 设置搜索框实际出现“你好 Android” |
| 旋转 | 设置页面切换到 1280×720；桌面启动器可能锁定竖屏 |
| 音频 | 播放测试 WAV，网页播放节点记录 286 个音频片段，峰值振幅 0.0072021484375；为自动信号验证，未进行人工听音验收 |

录像 `android-demo.mp4` 展示最终 Docker 连接、操作、文件传输和设备重启恢复。录像无音轨；音频单独检测。

## 验证边界

- redroid 没有真实 Wi-Fi 网络，开启 adbwifi 时提示 Not connected to any wireless network。网络 ADB 已端到端实测；六位码配对的输入、校验和命令调用有测试，但成功配对流程仍需 Android 真机验收。
- 本轮未测试麦克风、摄像头重定向，也未实现这些能力。
- 未给出帧率、延迟或吞吐提升百分比；尚未进行弱网与长期运行基准测试。
- 仓库全量 vue-tsc 仍存在原有错误；本次检查未发现 Android 新增文件的类型错误。根包回归测试受现有 memKeychain 重复声明阻塞，因此不能声称全量测试通过。

## 复测

参见 tools/android/README.md 与 tools/android/docker-live.mjs。测试脚本会停止并重启指定 redroid 测试容器，请仅用于测试实例。
