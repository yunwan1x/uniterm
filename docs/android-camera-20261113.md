# Android 摄像头来源切换（2026-11-13）

状态栏增加屏幕、前置摄像头、后置摄像头选择，切换时关闭旧会话并通过 Go ADB 库建立新会话。没有增加外部 adb 程序或相关运行时依赖。

后端使用内置 scrcpy 3.3.4 的 video_source=camera / camera_facing=front|back；开始前检查 Android API >=31 和目标镜头是否可访问。参数白名单防止任意 shell 参数拼接。摄像头模式前后端均阻止屏幕控制输入，文件和 Shell 仍可用。音频保持 audio_source=output，不自动开启手机麦克风。

## 验证

- Go TestAndroid 测试通过，含来源参数白名单和默认屏幕行为。
- 28 项前端测试通过，包含来源元数据、旧服务端兼容、音频回归。
- 前端生产构建、Go server/gateway 构建通过；git diff --check 通过。
- 浏览器实测：Go ADB 屏幕连接成功；前置、后置不存在时分别明确报错；画面操作禁用，来源选择器仍可用；两次切回屏幕均恢复连接和 Home 按键；浏览器异常 0。
- 全量类型检查仍为既存 570 项错误；AndroidTabContent、Android client 本次修改未报错。

## 尚未验收

本机 redroid 报告 0 个摄像头，不能作为真实前后镜头的视频采集验证。仍需 Android 12+ 实体设备验证镜头打开、编码、视频连续性、摄像头占用/权限错误，以及连续前后镜头切换。本次不声称真实摄像头画面已经验收通过。

未构建或推送 Docker 镜像，未提交代码。临时 gateway 已停止、凭据删除，redroid 恢复停止状态。
