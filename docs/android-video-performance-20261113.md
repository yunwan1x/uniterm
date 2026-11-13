# uniTerm Android 视频播放实测

日期：2026-11-13。结论：当前本机环境下，720p 30 fps 播放可接近目标帧率；不能据此声称真机、无线网络、60 fps 或高分辨率视频已经验收。

## 环境和方法

- 本机 redroid Android 12，guest 软件 GPU，网络 ADB 走本机回环。浏览器为 headless Chromium，软件图形路径；并非真实手机硬件编码 + Wi-Fi 场景。
- uniTerm 当前固定参数：H.264、最长边 1280、max_fps=30、video_bit_rate=4,000,000。未为本轮修改产品代码。
- 初始 redroid 默认显示为 15 Hz，实测约 14.99 fps。随后使用独立测试容器明确设置 androidboot.redroid_fps=60，dumpsys display 确认 60 Hz。15 fps 是测试设备默认限制，不能作为 uniTerm 的上限。
- 动态测试素材：FFmpeg 自生成 720×1280、30 fps、持续运动图案、帧编号、时间和测试音。另测试 1280×720、30 fps 的 Big Buck Bunny 动画片段。
- 每组预热约 3.5 秒，统计 20 秒。统计真实 canvas 呈现调用和 WebSocket 视频数据包；软件解码计数包含实际使用的 2D 渲染路径。
- “双路录屏”同时运行 Playwright 整页录像和 canvas.captureStream + MediaRecorder。录屏会增加负载，不能将录屏组当成没有观测开销的极限性能。新增 WebCodecs 无录屏对照验证这一点。

## 结果

| 场景 | 绘制 fps | 接收 fps | 帧间隔 P95 ms | 最大帧间隔 ms | >100 ms 次数 | 接收 Mbps（含音频/帧头） |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| WebCodecs，不录屏 | 29.95 | 30.00 | 40.1 | 97.5 | 0 | 3.56 |
| WebCodecs，双路录屏 | 25.98 | 25.93 | 62.9 | 93.2 | 0 | 3.28 |
| 软件解码，双路录屏 | 29.58 | 29.58 | 56.4 | 114.3 | 1 | 3.53 |
| 普通动画，WebCodecs，双路录屏 | 28.08 | 28.08 | 60.1 | 102.2 | 1 | 3.58 |

每组均无浏览器 pageerror，音频均收到非零信号。接收与呈现帧数基本一致（边界允许相差一帧），这 20 秒内没有观察到持续增长的队列积压。

无录屏对照为 29.95 fps，P95 帧间隔约 40 ms；普通动画录屏组 28.08 fps，偶有约 100 ms 的间隔。因此可以说本机 30 fps 视频基本顺畅，但不是每一帧都严格匀速，也未测得“零延迟”。

软件解码录屏组快于 WebCodecs 录屏组不代表软件解码普遍更快：这里包含不同画布/视频录制路径的开销，且使用软件图形环境，不能推广为真实 GPU 的性能排序。

## 视频证据

- android-movie-with-audio.mp4：网页 canvas 实际呈现的 Android 画面，音轨来自网页接收并播放的 Android 音频；不是直接发送源视频。仅转码和加来源说明，不补帧、不加速。录制器可能漏采部分呈现帧，fps 数据来自浏览器测量，不能仅用成片编码帧率反推。
- android-movie-ui.mp4：完整 uniTerm 页面录屏，无音轨，展示连接与实际播放；Playwright 的录屏采样也不等于显示器呈现帧率。
- 原始 webm、metrics.json、首尾截图一并保存在本目录。

## 限制

未测真实 Wi-Fi 的 RTT/抖动、长时间播放、硬件编码手机、1080p/4K 或 60 fps；当前产品本身配置 30 fps 上限。没有测量端到端操作延迟，也没有完成音画同步的精密测量，不能给出端到端延迟毫秒数。

本轮发现的是 redroid 测试环境的刷新率限制，未修改 uniTerm 产品代码。

## 素材及来源

动画节选并缩放自 Big Buck Bunny（截取约 120–155 秒，添加署名），(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org；CC BY 3.0。视频内已署名。
- 官方素材：https://download.blender.org/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4.zip
- 授权说明：https://peach.blender.org/about/
- 授权文本：https://creativecommons.org/licenses/by/3.0/
- redroid 刷新率参数：https://github.com/remote-android/redroid-doc#configuration
