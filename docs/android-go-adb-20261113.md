# Android Go ADB 接入与验收

日期：2026-11-13

## 实现

- Android 会话改用 juanlianyangyang/adb-go v1.0.6，固定上游提交 5acae68d6a534e44d5d0437397111bedbbc6077e。源码及许可证保存在 third_party/adb-go。
- 配对、连接、启动 scrcpy、文件上传下载、Shell 与音视频/控制流均不调用外部 adb，不启动 adb server，不再建立本地 adb forward。
- 沿用每个 worker 的 HOME/.android/adbkey，兼容 PKCS#1 和 PKCS#8；新用户生成独立 RSA 私钥，权限 0600，损坏密钥报错而非静默重置。配对码不写入文件，也不进入库日志。
- 补充库的配对取消、配对消息长度校验、连接超时关闭、流尾部数据排空、传输写入超时。移除其未使用的内置共享私钥加载器。
- Docker runtime 移除 android-tools，因此不再引入 Python、刷机工具和 libprotobuf。Go 构建版本升为 1.26.3，以满足库要求。
- 下载继续通过 exec:cat 传输，不使用比较测试中较慢的库 PullFile 路径；文件名按 Shell 字面量转义。

## 实测

| 验收 | 结果 |
|---|---|
| Android 测试（race） | 9 个测试通过，含真实 redroid；无数据竞争报告 |
| backend/session 全包回归 | 使用 Node 25 运行通过 |
| 库补丁测试（race） | 4 个测试通过：取消、配对长度限制、EOF 数据保留 |
| 外部工具依赖 | live 测试 PATH 指向空目录，仍可完成连接、控制、文件及音视频 |
| 文件完整性 | Go 测试 1,000,000 字节往返一致；浏览器 1,048,597 字节往返一致，含中文和单引号文件名 |
| 会话隔离 | 同设备两个独立会话，关闭第一个后第二个仍可执行命令并传输音视频 |
| 浏览器音视频 | 10 秒观测 297 次实际画面绘制、469 个音频播放片段，PCM 峰值 0.00408935546875 |
| 控制与 Shell | 浏览器 Home 按键由 Android 前台 activity 确认；Shell 返回预期结果 |
| 断线重连 | 实际停止并启动 redroid，网页识别断线并成功重连 |
| 浏览器异常 | 无 pageerror |
| 镜像 | Linux amd64 完整生产构建成功；仅构建本地测试标签 uniterm/adb-go-test:local，未推送仓库 |

媒体测试使用同一 redroid Android 12 和既有 Big Buck Bunny 测试片段。本轮帧数为功能验收，不是与旧版同期性能 A/B 对比；音频通过浏览器播放节点自动检测，未进行人工听音。

## 镜像体积

Docker inspect 的本地未压缩镜像大小：

- changhui/uniterm:v1.5：102,250,648 字节，约 102.3 MB。
- uniterm/adb-go-test:local：45,530,002 字节，约 45.5 MB。
- 减少 56,720,646 字节，约 55.5%。该数值不是镜像仓库压缩下载大小。

实际检查 runtime：无 adb 和 python3 可执行文件，无 android-tools、python3、python3-pycache-pyc0、libprotobuf 包。连接时只有 gateway 和 worker 进程，无 ADB daemon。

## 边界

redroid 未提供真实 Android 11+ Wi-Fi 配对环境；六位码配对已接入库，但成功的实机配对/TLS 授权仍未验收。已测试本地模拟 TLS 对端在握手后的取消行为，不能将其等同于真机兼容性验证。未覆盖长期弱网或大量并发设备。

证据目录：artifacts/android-native-adb-20261113，包括测试日志、浏览器截图、媒体计数及镜像尺寸。
