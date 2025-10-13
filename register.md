# Native Messaging 注册与安装优化方案（不退化保障）

本方案在现有实现基础上，聚焦“路径不稳定、执行权限不足、注册失败后无自愈”三类高频问题，确保在 npm/pnpm 全局安装与多平台下提升首启成功率，同时保证“不比当前更差”。

目标：

- 稳定可执行路径：不依赖包管理器全局目录（只读/搬迁/路径哈希）。
- 统一修复权限与 Node 路径：即装即用，尽量减少用户手动介入。
- postinstall 自动注册优先，失败时提供一键自愈（doctor/fix）。
- 保持与当前实现兼容，渐进式落地；任何一步失败都不阻断安装，不降低成功率。

---

## 1. 现状与问题

- Manifest 指向包目录 `run_host.sh/.bat`：
  - 在 pnpm store 或受限目录中可能只读/被 GC/路径不稳定，导致 Chrome 无法拉起宿主。
- 执行权限与隔离标记：
  - mac/Linux 缺少执行位；macOS 存在 `com.apple.quarantine`；Windows 偶发只读属性。
- Node 路径不可见：
  - Chrome 启动上下文 PATH 与交互 shell 不同，找不到 node；NVM 等版本管理器加剧不稳定。
- 自动注册失败缺少自愈：
  - postinstall 失败后用户无清晰修复路径；Windows 注册表/manifest 偏差不易诊断。

---

## 2. 关键优化策略（与现有实现兼容）

1. 稳定落点目录（用户级）

- 将宿主入口文件复制到用户可写的稳定目录，并让 Manifest `path` 永远指向此目录：
  - macOS: `~/Library/Application Support/ChromeMcpBridge/host/`
  - Linux: `~/.local/share/chrome-mcp-bridge/host/`
  - Windows: `%LOCALAPPDATA%\ChromeMcpBridge\host\`
- 复制文件：`run_host.sh|run_host.bat`、`index.js`、`cli.js`、`node_path.txt`（见下文）。
- 原有指向包目录的路径仍可保留为兜底（不推荐），仅当稳定目录不可用时使用。

2. Node 路径写死 + 多层兜底

- 在 postinstall 与 register 阶段写入 `node_path.txt`（内容为 `process.execPath`）。
- 包装器优先使用 `node_path.txt` 找到 Node；若缺失，则按以下顺序兜底：
  - macOS/Linux: NVM 默认/最新版本 → 常见路径（`/opt/homebrew/bin/node`、`/usr/local/bin/node`）→ `command -v node` → PATH 遍历。
  - Windows: `where node.exe` → 常见路径（`%ProgramFiles%\nodejs\node.exe` 等）。

3. 统一修复执行权限与隔离标记

- macOS/Linux：复制后立即 `chmod 755`；若存在隔离标记：`xattr -d com.apple.quarantine <文件>`。
- Windows：移除只读属性，确保 .bat 可执行；路径含空格全程加引号。

4. 用户级注册优先，系统级可选

- 默认写入“用户级”清单与（Windows）HKCU 注册表，无需管理员权限，成功率最高。
- 提供 `--system` 选项写入系统级目录/注册表，仅在用户显式选择时执行。

5. 注册即测 + 一键自愈

- 注册完成后做“轻量自检”：以 stdio 方式快速拉起宿主并校验退出码/日志存在。
- 失败则自动执行“权限修复 + 重新写 manifest + 重试”一次；仍失败时打印 `doctor --fix` 指令与日志路径。

---

## 3. postinstall 自动注册流程（增强版）

不改变“自动注册”的产品形态，仅增强稳健性与可观测：

步骤：

1. Debug 信息输出（不影响安装）。
2. 复制宿主文件到“稳定目录”，写入 `node_path.txt`，并执行：
   - mac/Linux：`chmod 755`，如有必要 `xattr -d`。
   - Windows：去只读，确保可执行；日志目录创建失败不报错，降级用户日志目录。
3. 写“用户级” Manifest（与当前实现兼容），Windows 同步写 HKCU 注册表；路径一律加引号。
4. 立即执行“快速自检”（尝试 stdio ping）：
   - 成功：结束。
   - 失败：自动进行一次“修权限→重写→重试”；仍失败则提示 `doctor --fix` 与日志定位。

失败不阻断安装：postinstall 任何一步失败都仅记录并给出指令提示，不 `process.exit(1)`。

---

## 4. CLI 兜底与自愈

新增/强化命令（命名以实际 bin 为准，例如 `mcp-chrome-bridge`）：

- `register`：重复执行“复制→修权限→用户级注册→快速自检”，可安全重入。
- `register --system`：系统级注册（需要管理员权限，不自动提权），结束后自检。
- `doctor`：仅诊断并打印状态：
  - Manifest 是否存在且 JSON 有效；`path` 是否存在且可执行；
  - Windows 注册表是否指向正确路径；
  - `node_path.txt` 是否有效；
  - 轻量自检结果与日志定位。
- `doctor --fix`：在用户确认后执行修复：
  - 重建稳定目录文件/权限；
  - 重写 Manifest/HKCU；
  - 回写 `node_path.txt`；
  - 重新自检并输出结果。

---

## 5. 跨平台细节清单

macOS

- 稳定目录：`~/Library/Application Support/ChromeMcpBridge/host/`
- 权限：`chmod 755`；隔离：`xattr -d com.apple.quarantine`（忽略失败）。
- Node 兜底：NVM 默认/最新 → `/opt/homebrew/bin/node` → `/usr/local/bin/node` → `command -v node`。
- Manifest：用户级 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` 或 Chromium 变体路径。

Windows

- 稳定目录：`%LOCALAPPDATA%\ChromeMcpBridge\host\`
- 权限：移除只读；路径加引号；兼容非 ASCII 路径。
- Node 兜底：`where node.exe` → 常见路径（`%ProgramFiles%\nodejs\node.exe`、`%LOCALAPPDATA%\Programs\nodejs\node.exe`）。
- Manifest：用户级清单 + HKCU 注册表（系统级为可选）。

Linux

- 稳定目录：`~/.local/share/chrome-mcp-bridge/host/`
- 权限：`chmod 755`。
- Node 兜底：NVM 默认/最新 → `/usr/local/bin/node` → `command -v node`。
- Manifest：`~/.config/google-chrome/NativeMessagingHosts/` 或 `~/.config/chromium/NativeMessagingHosts/`；snap/flatpak 变体在 `doctor` 文档提示引导。

---

## 6. 兼容性与“不退化”保障

- 不改变现有消息协议、扩展 ID、工具能力与调用链路。
- Manifest 写入失败、权限修复失败、复制失败均不阻断安装（仅提示）；
- 保留原有路径为兜底（低优先级），避免“老路径仍然有效”的场景被意外断开；
- 注册完成后自检仅作为诊断动作，不改变既有状态；
- 所有路径/权限变更均限定在“用户目录”，不侵入系统目录，失败概率更低。

风险评估与规避：

- 若用户目录写入失败：
  - 仍尝试使用“原有包目录路径”写 Manifest（低优先级兜底），并在 doctor 提示迁移命令。
- 若找不到 Node：
  - `node_path.txt` 为首选信号；无则多层兜底；仍失败时仅提示安装 Node 或手动指定，**不覆盖现有可用配置**。

---

## 7. 变更项概览（实现指引）

- postinstall（增强）：
  - 复制宿主文件到稳定目录；写入 `node_path.txt`；修权限/去隔离；写用户级 Manifest/HKCU；快速自检，失败时自动修复一次；失败仅提示。
- CLI：
  - `register`/`register --system`：对齐 postinstall 逻辑，可重复执行。
  - `doctor`/`doctor --fix`：诊断与自愈闭环。
- 包装器（run_host.sh/.bat）：
  - 已具备多层 Node 探测；建议增加 `/usr/bin/env node`（mac/Linux）与更多版本管理器 shim 的探测，增强鲁棒性（可选）。

以上为“代码指导建议”，落地时逐步灰度，确保每一步上线都不会降低现有用户的成功率。

---

## 8. 验收与回滚

验收标准：

- 新用户（npm/pnpm 全局安装）首启成功率显著提升；
- 失败用户运行 `doctor --fix` 后绝大多数恢复；
- Windows/macOS/Linux 三平台全覆盖，用户级安装无管理员权限要求。

回滚方案：

- 若出现异常案例，可切回“Manifest 指向包目录”的旧策略（已保留兜底）并关闭稳定目录复制步骤；
- 所有 CLI 变更支持开关/灰度，便于快速回退。

---

## 9. 常见问题对照（与 docs/ISSUE 总结对应）

- “权限问题/需要 chmod -R 755” → 复制到用户目录后统一执行 `chmod 755`，macOS 同时去隔离标记；Windows 去只读。
- “Node 路径问题/需要重装 Node 到默认路径” → 写入 `node_path.txt`，包装器优先使用；多层兜底，无需用户重装。
- “连接不上/服务未启动” → Manifest 永远指向稳定目录可执行入口；注册即测；失败自动一次修复并提示 doctor 自愈。

---

附：与当前实现的关系

- 完全复用现有扩展与原生消息协议；仅优化注册与可执行入口的可用性与稳健性。
- postinstall 仍为“自动注册优先、失败兜底”的策略，不改变用户习惯。

---

## 10. 连接保活方案（浏览器不退出即不断开）

目标：在用户未退出浏览器的前提下，尽最大可能维持与 Native Host 的长连接与服务可用性；当连接意外断开时，快速、静默地自恢复。遵循 MV3 生态约束，分层设计，优先不影响性能与电量。

方案分层：

1. 扩展侧保活（首选）

- 长连接管理：
  - 建立后启动心跳（例如每 20–30s 发送 `PING_NATIVE`），原生返回 `PONG`；若 2–3 个心跳周期未收到响应，视为断开，进入重连。
  - `nativePort.onDisconnect` 触发指数退避重连（例如 0.5s → 1s → 2s → 4s，上限 30s），避免风暴与空转。
- 唤醒机制：
  - Offscreen Document（需已有 `offscreen` 权限）：在首次连接后创建一个轻量 Offscreen 页面，内部定时 postMessage 唤起背景并转发心跳。若 Offscreen 创建失败（或策略限制），不影响使用，降级到 Alarms。
  - chrome.alarms 兜底：创建 `keepalive` 周期性闹钟（建议 1 分钟）。闹钟触发时调用 `ensureConnected()` 与一次 `PING_NATIVE`，以便在 Service Worker 被回收后尽快重建连接。
- 断线时体验：
  - UI 状态通过现有 `SERVER_STATUS_CHANGED` 广播同步；
  - 工具执行入口在断线时快速返回“服务重连中，请稍后重试”提示（不长时间卡死）。

2. 原生宿主侧配合

- 心跳响应：
  - 接收 `PING_NATIVE` 立即回应 `PONG`，并更新 `lastSeen` 时间。
- 进程生命周期：
  - 在 Native Messaging 管道关闭（stdin 结束）时按当前逻辑清理并退出（Chrome 端口关闭后宿主保活并不可靠，依赖扩展维持端口更稳）。
  - Fastify 服务器仅在收到 `STOP` 或宿主退出时关闭。

开关与安全：

- 在扩展 Options 中增加“连接保活”开关（默认开启）。
- 心跳间隔、退避上限提供可调参数（存储于 `chrome.storage.local`）。
- 保活仅在浏览器前台存活期间有效；浏览器退出即清理。

不退化保障：

- Offscreen/Alarms 任一失败均不影响基础连接逻辑；仅作为保活增强。
- 未开启保活时行为等同当前版本；开启后若出现异常，可一键关闭恢复旧行为。
- 重连逻辑仅在断线时触发，避免对稳定连接施加额外压力。

验收口径：

- 正常使用下，浏览器不退出的情况下，连接持续 ≥ 8 小时不间断（以心跳监控数据为准）。
- 断网/休眠/唤醒后 30 秒内自动恢复连接。
- CPU、内存与电量影响可忽略（心跳 20–30s 一次，Offscreen 页面仅做计时与消息转发）。

实施建议（代码层面）：

- 扩展端 `background/native-host.ts`：
  - `startKeepAlive(port)`：创建心跳定时器；
  - `stopKeepAlive()`：清理定时器；
  - `scheduleReconnect()`：指数退避重连；
  - `ensureConnected()`：判定端口状态并尝试连接；
  - 监听 `onStartup/onInstalled`、`alarms.onAlarm` 执行 `ensureConnected()`；
  - Offscreen：`chrome.offscreen.createDocument` 与“已存在”检查；失败静默降级。
- 原生端 `NativeMessagingHost`：
  - 处理 `PING_NATIVE`，快速 `PONG`；记录 `lastSeen`（仅日志/监控用）。
