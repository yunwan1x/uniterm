# uniTerm KoolCenter 插件

适配当前实测 TUF-BE3600 / 3006.102_37307 / aarch64 的离线安装包。插件版本 0.3.0-rc.3。
源码仓库：https://github.com/yunwan1x/uniterm.git。

## 安装与使用

在软件中心的离线安装中上传 output/uniterm-0.3.0-rc.3-arm64.tar.gz，进入 uniTerm 设置页：
1. 默认端口 18888，可调整为未占用的 1024–65535 端口。
2. 首次启用设置 6–24 字节管理员密码，管理员名 admin。
3. 勾选启用，保存并应用，点击“打开 uniTerm”。
4. 后续账号和密码在 uniTerm 内管理；已初始化时首次密码输入框留空。

安装及升级后默认停用，需手动启用。通过 perp 守护和 S98uniterm.sh 开机启动。
只绑定 nvram LAN 地址，worker 仅监听 127.0.0.1；不会添加 WAN 防火墙规则或端口映射。
插件管理页依赖路由器管理员登录，uniTerm 自身另有账号认证。
支持 HTTP / HTTPS 切换，当前部署已开启 HTTPS。跨网访问可沿用现有安全隧道。
浏览器安全上下文要求决定部分远程桌面编解码或浏览器 API 是否可用。
uniTerm 的账号隔离不是操作系统权限沙箱；服务使用路由器管理员权限，账号仅提供给可信使用者。

## 数据与卸载

账号、加密的连接信息和用户工作目录：/koolshare/configs/uniterm/data。
初始密码只暂存在受保护的 bootstrap 文件，初始化后删除；最终 users.json 保存密码哈希。
日志在 /tmp/uniterm.log，每 5 分钟检查，超过 1MiB 时保留末尾 128KiB 后清空当前日志。
卸载会停止服务并删除程序及界面，保留账号和连接数据，便于重装。
文件传输可占用工作目录所在的 JFFS；大文件请显式选择外接存储，避免填满闪存。
插件安装时检查程序大小并预留至少 8MiB 可用空间。

## 构建与适配修改

在 Linux 上使用 Go 1.26.3、Node 22.22.0、wails3 v3.1.0、UPX 5.2.0：
先以 CGO_ENABLED=0 go install -tags server github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0 安装构建工具，
再运行 router-plugin/build.sh。Go 工具、Node、wails3 和 UPX 必须在 PATH 中。
前端完整嵌入 uniterm-server，不需另装 Node、Docker 或 WebKit。
后端使用 server,production 标签、CGO_ENABLED=0、-trimpath、-s -w。
server 模式排除 backend/platform/remote_desktop_linux.go 的 GTK 全局键盘捕获，
改用 remote_desktop_linux_server.go 的无桌面实现；浏览器侧远程键盘输入沿用现有实现。
这消除了纯 Go 构建因 purego 带入的 64 位 libdl/libpthread 动态依赖。
桌面版构建保持原实现。两个 ARM64 程序再经 UPX LZMA 压缩并执行完整性测试。

UPX 减少程序在磁盘上的体积，不相应减少运行内存；启动时需要解压。
详细体积、源提交、包 SHA256、核心测试结果见 output/build-info.json。
验证范围为网关测试、平台层测试、真实路由器上的启动/认证/前端静态资源/账号持久化，
不代表 SSH、RDP、VNC、数据库、串口等所有远程功能已逐一通过。

## 本次产物

离线包约 14.7MiB。程序从合计 72.8MiB 压缩为 14.7MiB，约节省 79.8%。
实测空闲 RSS：网关 8348KiB、工作进程 65540KiB；这是启动与页面读取后的采样，不是峰值上限。
临时测试服务已经停止，插件已安装并开启 HTTPS，未更改防火墙。


## HTTPS（0.2.0）

插件设置页勾选“使用 HTTPS 加密访问”，可以：
- 自动生成带当前 LAN IP、127.0.0.1、router.asus.com 的自签名证书。
- 指定路由器上的 PEM 证书（可包含证书链）和未加密私钥绝对路径。

自动证书位于 /koolshare/configs/uniterm/tls/server.crt，
私钥 server.key 权限 600。卸载保留该目录，以免重装改变信任关系。
自签名证书需浏览器手工确认或安装并信任；域名证书需使用对应域名访问。
HTTPS 使用同一配置端口（默认 18888），不同时提供 HTTP，最低 TLS 1.2。
网关直接处理 TLS，无需额外反向代理，启用后会话 Cookie 带 Secure 标记。
证书错误会导致启动失败，不回退为明文 HTTP。仅本机服务存活探测允许跳过证书验证。
默认自签名证书有效期 825 天；证书到期或 LAN IP 变化时需更新证书。
通过 UNITERM_TLS_CERT_FILE / UNITERM_TLS_KEY_FILE 配置网关内置 HTTPS。

## RDP 优化（0.3.0-rc.1）

默认均衡画质现在始终发送到 RDP 引擎。音频在实际欠载后可将恢复缓冲增加到最多 300ms，总排队上限 750ms。正常播放仍采用较小缓冲。

在真实 Win11、NLA/TLS、1280×720 下，以同一动画和循环测试音进行一分钟对比，两版都未记录音频欠载或丢弃，画面更新量接近。此次未证明正常负载下帧率提高；优化主要修正画质参数及音频对抖动的恢复。Chrome 为无头软件渲染，不代表用户设备 GPU 表现。未覆盖 AVC 视频播放、外网长时间运行或用户原会话的全部负载。

测试发现后台 redroid 负载明显影响宿主 Windows CPU；测试结束后恢复容器，未永久修改其配置。临时 Windows 账号、用户配置、任务和测试文件已删除；保留原 wy 会话。

## 音频线程隔离（0.3.0-rc.2）

支持 AudioWorklet 的安全上下文中，RDP 接收 Worker 和 Android WebSocket Worker 将 PCM 通过独立 MessagePort 直接送到音频渲染线程，绕过 UI 主线程。环形队列负责采样率转换、双声道音量、预缓冲和欠载恢复；队列上限仍为 750ms、恢复目标上限仍为 300ms。启动时保留一包数据加预缓冲，避免 Windows 大音频包提前耗完储备。跨线程待处理 PCM 上限 256KiB，Android 待交付视频上限 16MiB。禁音、挂起、关闭时清除旧音频。旧浏览器保留 AudioBufferSource 播放路径。

浏览器压力测试使用连续 PCM、4K Canvas 绘制、页面滚动及两次各一秒主线程忙等待，通过音频线程监测器检测输出静音缺口。Android 使用独立 WebSocket 测试源验证接收线程，不等同于真机投屏验收。真实 Windows RDP 另以 3840×2160 和连续测试音验证。此次测试不代表真实 4K 编码电影、AVC 硬解或外网长期运行的全部表现。


## 接收与图形调度（0.3.0-rc.3）

RDP 接收与昂贵的图形解码分开：已解析的图形命令进入有上限的顺序队列，接收循环优先处理已到达的网络数据，包括音频。4ms 接收工作预算和队列高水位避免图形饥饿；帧确认仍在真正处理 EndFrame 后发出。图形队列上限为 64MiB / 16384 条命令，音频仍维持 750ms 总队列和 300ms 恢复预留上限，没有采用秒级大缓冲。

WASM .12 同时包含独立 PCM 队列、RDPSND 高优先级、AVC444 YUV 平面桥接及真实 H264 解码能力探测。音频队列溢出只裁掉超出上限的部分。

当前 Windows 主机 WANGYUNNAS 的 `HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services` 下，`AVC444ModePreferred`、`AVCHardwareEncodePreferred` 均设为 DWORD 1。这是 AVC444 和硬件编码的**优先配置**，不等同于证明实际采用 GPU 编码。原值备份保留在 `recovery/WANGYUNNAS-rdp-policy-before.json`；原先两个值均未设置。原 wy 会话未注销，没有重启 Windows 或远程桌面服务。混合旧图形编解码器的配置仍测到欠载，本次通过依赖 AVC444 优先配置。

真实 Win11 / 3840×2160 YouTube 播放，经预热后分别完成两轮各 20 次滚动和侧栏缩略图悬停（持续音对照、视频原声），测量阶段新增欠载、静音及丢弃音频均为 0。正式压缩二进制还通过 4K 主视频加 1280×720/30fps H264 测试片段同时播放、12 次滚动；实际鼠标、键盘扫描码、1080p↔4K 重连亦通过。原生协议测试 154 项通过。

第二路测试使用明确的受控 H264 片段；原生 YouTube 嵌入播放器未成功播放，不能当作通过。侧栏验收观测到动画缩略图，不将它表述成第二个已验证的 YouTube 视频播放器。完整计数和限制见 `output/rdp-acceptance.json`。无头客户端采用软件渲染，本次不承诺 4K60 画面帧率或外网长时间表现。

已部署的访问地址仍为 `https://192.168.50.1:18888`。升级后需强制刷新页面并重新连接 RDP。账号、JWT 密钥、证书和网关二进制均校验保持一致。临时账号、计划任务、测试目录和可再生成缓存已清理；redroid 保持停止。仅保留当前安装包和一版回退包。

安装器在升级时按每个被替换程序的新增占用检查空间，仍保留 8MiB 余量；首次安装仍计算全部程序占用。不会通过删除其他插件的数据来释放空间。
