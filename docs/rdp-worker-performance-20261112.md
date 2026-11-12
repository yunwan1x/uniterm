# RDP Worker、H.264 与 WebGL2：Linux 验收

日期：2026-11-12。范围：本地实现与 Linux RDP 验收，未发布 Docker 镜像。

## 实现

- 默认把 IronRDP WASM、连接、协议解码和帧缓冲合成移到 Dedicated Worker。
  键鼠、剪贴板、文件通道、音频及设备扩展通过消息桥接；UI 保留 Web Audio
  和浏览器设备授权。Worker 不可用时自动重连到原有主线程客户端。
- 增加 AVC420/WebCodecs。仅在安全上下文、跨源隔离、共享内存及解码能力探测
  都满足时声明 AVC。异步 VideoDecoder 在独立子 Worker 中工作，协议 Worker
  通过有超时的共享缓冲完成同步解码接口；UI 线程从不 Atomics.wait。
  独立 surface 保留独立解码状态，最多 16 个；输出缓冲上限 64 MiB。
  未声明 AVC444，也未声称实现零拷贝。
- 保留所有协议增量及解码顺序。只合并显示快照，最多一张未确认快照，另有有界
  的 dirty 状态；同一时刻最多一次快照生成。提交间隔随显示确认耗时在 16–100ms
  间调整，不修改服务器码率或偷偷降低分辨率。
- 增加 WebGL2 完整画面纹理合成、缩放及纹理复用。自动避开 SwiftShader、llvmpipe
  等软件 GPU；不支持或上下文丢失时恢复 Canvas2D。没有增加用户模式开关。
- 修复更换 canvas 后尺寸观察器的重新绑定，保留重连、分辨率和数值缩放行为。
- 网关/Vite 添加 COOP same-origin 与 COEP credentialless。WebCodecs 共享内存要求
  HTTPS 或 localhost；普通不安全 HTTP 或未隔离部署自动使用 Worker＋非 AVC 编码。
  这些头会隔离 window.opener，并影响跨源嵌入；没有降低浏览器隔离要求。

故障测试发现 IronRDP 会容忍单个不可解码图面，单纯返回 Rust 解码错误不足以触发
回退。因此 WebCodecs 致命错误另行通知 UI，终止该解码器并仅重试一次非 AVC 连接，
避免“已协商 AVC、画面却不再更新”。

## 同条件性能结果

同一 xrdp 0.10.6.1（RFX、x264）、xorgxrdp 0.10.4、1920×1080 Linux 桌面、
96 张图片页、同一 Chromium 客户端。链路只对测试连接的服务端→客户端方向限速
20 Mbps；每 2.5 秒在 scrollY=0/900 间跳转，6 次。基线为本次修改前的 GFX/RFX
版本，已包含上一轮按帧合成优化，不是旧的逐块刷屏版本。

| 指标 | 原版 GFX/RFX | Worker＋RFX 回退 | Worker＋AVC420 |
|---|---:|---:|---:|
| 6 次更新接收数据 | 2,770,457 B | 2,776,176 B | 569,497 B |
| 更新完成延迟中位数 | 336.45ms | 341.05ms | 115.70ms |
| 主线程 >50ms 长任务 | 6 次，58–62ms | 0 次 | 0 次 |
| 每次跳页显示提交 | 1 次 | 1 次 | 1 次 |

AVC420 本轮数据量减少 **79.4%**，更新完成延迟中位数降低 **65.6%**。
仅 Worker＋RFX 的延迟约增加 4.6ms，收益主要是避免解码阻塞网页主线程；不能声称
Worker 本身令协议解码更快。

延迟从远端页面执行滚动到浏览器 Canvas 提交计时，使用同宿主机时间基准；不包含
用户输入到服务器的传输时间，也不测 GPU 最终显示时间。H.264 和 RFX 都是有损路径，
这里不是同画质的编码器比较，不应外推为普遍 60fps 或 Windows 性能结论。

## 验收证据

- xrdp 日志实际出现 `starting h264 codec session gfx` 与 `using x264`，客户端
  `avcFrames` 非零；不是仅声明能力。
- 真实应用键盘输入、鼠标滚动、浮动键盘开关、1280×720 分辨率重连及 100%
  数值缩放通过。
- UI 阻塞 700ms、远端持续滚动时，实测未确认快照最多 1 张。
- 强制 WebGL2 路径在软件 GPU 上显示 Linux 桌面；注入上下文丢失后自动重连
  Canvas2D。该项是功能测试，不是物理 GPU 加速证明。
- 注入 AVC 解码失败、Worker 启动失败后自动恢复；取消跨源隔离后回退 Worker＋RFX。
- 浏览器合成测试检查 RGBA 色块、上下方向、尺寸变更、纹理复用和销毁；真实
  WebCodecs 测试包括关键帧/增量帧、两个独立图面、reset 和损坏输入拒绝。
- 前端相关测试 **89 项通过**；Rust EGFX **68 项**、Web 原生兼容子集 **35 项**通过。
  原生 Web 测试排除 29 个依赖浏览器 JS 环境的测试，并未把这些计为通过。
- 网关测试通过，前端和 Go 服务端生产构建通过。全项目 vue-tsc 仍有既有类型错误；
  本次 RDP 文件未出现类型错误。
- 完整补丁可干净应用到固定 IronRDP 基线，发布依赖为 `0.5.1-uniterm.6`。

测试主机只有软件 GPU。自动选择 Canvas2D；WebGL2 的真实硬件收益尚未测量。
测试中的 WebGL2 软件绘制没有胜过 Canvas2D，因此没有在软件 GPU 上强制启用。

## 文件

- 仓库原始汇总：`tools/ironrdp/results/worker-pipeline.json`
- 复现说明和驱动：`tools/ironrdp/worker/README.md`
- 本机完整证据：`/root/changhui/poc/bookstark/artifacts/rdp-worker-20261112/`
- 视频：`rdp-worker-before-after.mp4`，左侧基线、右侧 Worker＋AVC420。
  两次独立运行使用相同的真实鼠标滚动脚本，按真实时间播放，没有加速；
  录像只供观察连续滚动，不用于精确延迟计算。
