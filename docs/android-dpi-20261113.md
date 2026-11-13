# Android 分辨率与 DPI 联动验收（2026-11-13）

设备预设同时应用 wm size 和 wm density，DPI 可单独调整，自定义支持宽、高、DPI。设备默认同时清除尺寸和密度 override。逻辑 DPI 限制 120–960，尺寸限制 320–4096；旧客户端不传 DPI 时保留原密度。

DPI 是 uniTerm 的建议逻辑密度，不是物理 PPI 或厂商保证的出厂默认值。iPhone 用 3×布局对应 Android 480 DPI，iPad 用 2×布局对应 320 DPI；三星手机建议 560 DPI，三星平板建议 320 DPI。Android 的 dp 换算基准见 https://developer.android.com/training/multiscreen/screendensities 。原生像素规格来源保存在 frontend/src/android/devicePresets.ts。

## 真实浏览器与 redroid 验收

在隔离的 redroid（原生 1440×2560）中，通过 uniTerm UI 选择并应用，然后独立使用 wm size / wm density 读取设备实际状态：

| 预设 | 读取到的远端尺寸 | 读取到的 DPI | 结果 |
|---|---|---:|---|
| iPhone 17 | 1206×2622 | 480 | 通过 |
| iPhone 17 Pro Max | 1320×2868 | 480 | 通过 |
| Galaxy S26 Ultra | 1440×3120 | 560 | 通过 |
| iPad Pro 11″ M5 | 1668×2420 | 320 | 通过 |
| iPad Pro 13″ M5 | 2064×2752 | 320 | 通过 |
| Galaxy Tab S11 Ultra | 1848×2960 | 320 | 通过 |
| 自定义 | 900×1600 | 400 | 通过 |

- DPI=119 被前端拒绝，实际设备保持 400 DPI。
- 恢复默认后，size 与 density 均没有 Override 项。
- 每个预设应用后连接仍保持，浏览器无异常。
- 初次脚本对成功的 204 响应调用 text() 导致 Playwright 错误，已修正为只读取失败响应正文后重新完成全套测试。

## 设备限制与回退

原测试 redroid 的物理尺寸为 720×1280。申请 1206×2622 时 Android 自动截断到 1206×2560，DPI=480 已应用。后端读取实际值发现不匹配，返回失败并恢复修改前的 720×1280 / 320 DPI。真实浏览器测试在清理步骤之前确认两项已恢复，未把系统截断误报为成功。

后端在修改前保存原 override，应用后同时校验尺寸和密度；失败时恢复并再次校验。超时、断连等导致无法确认恢复时，会明确提示使用设备默认恢复，不保证断连期间回退必然成功。

## 其他验证

Go TestAndroid 全部通过，包括合法/非法 DPI、系统拒绝密度、静默忽略密度后的回退，以及同时重置两项。前端生产构建与 server 构建通过；全量 vue-tsc 仍有既存 570 项错误，本次 AndroidTabContent/devicePresets 无错误。git diff --check 通过。

浏览器视频仍受既有 max_size=1280 编码设置约束：UI 的画面尺寸是传输分辨率，不能用它代替远端 wm size 读取结果。本次不修改视频编码上限或旋转逻辑，也不是对实体 iPhone/Samsung OS 的模拟。

所有测试覆盖的是 redroid，实体机是否接受尺寸仍依赖系统限制。临时测试 redroid 已删除，原 redroid 的显示设置恢复后停止，测试网关和临时凭据已清理。未提交或推送镜像。
