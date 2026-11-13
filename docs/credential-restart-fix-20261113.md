# 容器重建后凭证解锁修复

根因：server 初始化在 UNITERM_MASTER_PASSWORD 为空时跳过 AutoUnlock，已有 credentials.meta 的模式和 salt 未载入内存。有效登录 Cookie 在 gateway 重启后依然可用，但登录密码缓存丢失，因此出现 mode 为空、needsSetup=true 的错误状态。

修复：通过 credentials.Store.InitServer 独立加载现存元数据，不依赖登录密码缓存；有密码时尝试解锁，无密码时保留正确的锁定模式供网页输入密码。读取元数据失败时直接返回错误，不创建新元数据覆盖原文件。旧 keychain 模式显示真实的钥匙串丢失状态。

验证：backend/credentials 全包测试通过；新增测试覆盖无密码重启、错误密码、正确密码、损坏元数据、旧 keychain 模式及元数据缺失但密文仍在。Docker 构建通过。

真实 Chromium + Docker：先保存带密码的 SSH 连接，保留浏览器 Cookie 和同一宿主机 /data，连续 docker rm / docker run 两次。每次均验证 master-password 模式、needsSetup=false、未解锁；网页出现密码输入框而非模式未知提示；错误密码被拒绝；原密码成功解锁；读回连接密码与原值一致；credentials.meta 字节完全相同。

这是数据完整性修复，不会让 Cookie 替代主密码。容器重建后没有登录密码缓存时，重新输入原登录/主密码解锁是正常行为，无需增加固定密钥环境变量。

本次只构建本地测试镜像 uniterm/credential-fix:test；未发布新镜像。测试容器与临时数据已清理。
