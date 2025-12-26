# 安装流程优化方案

## 背景

根据 `docs/ISSUE.md` 中的高频问题分析，当前安装流程存在以下核心问题：

- **"Connected, Service Not Started"** - 最高频问题
- **Node 路径找不到** - 用户使用 NVM/asdf/fnm/volta 等版本管理器
- **命令找不到** - Apple Silicon Mac 用户
- **权限问题** - Windows `run_host.bat` 拒绝访问
- **pnpm 不运行 postinstall** - 导致自动注册失败

### 根本原因

1. **postinstall 不可靠**：pnpm v7+ 默认禁用 postinstall
2. **Node 环境依赖**：`run_host.sh` 需要找到 Node，但用户环境各异
3. **命名不一致**：代码中 `COMMAND_NAME = 'chrome-mcp-bridge'`，但 bin 是 `mcp-chrome-bridge`
4. **端口不一致**：扩展侧默认 12306，部分文档/代码出现 56889

### 为什么需要 Native Host？

这是 Chrome 安全模型的限制：

- 扩展无法监听本地端口（不能作为服务端）
- 外部进程无法直接与扩展通信
- 扩展无法自动安装本地组件

因此，只要目标是"让本机 MCP 客户端连接并驱动浏览器"，就必须有一个本机组件作为桥梁。

---

## 优化方案概述

采用**两步走策略**：

| 阶段          | 目标           | 内容                                          |
| ------------- | -------------- | --------------------------------------------- |
| Phase 1: 止血 | 减少安装失败率 | 修复一致性问题 + doctor 命令 + 改进 Node 查找 |
| Phase 2: 根治 | 消除 Node 依赖 | 预编译二进制 + optionalDependencies           |
| Phase 3: 分发 | 简化安装       | Homebrew/winget 支持                          |

### 对现有 npm install 的影响

**完全向后兼容**，且更加健壮：

```bash
# 改进后
npm install -g mcp-chrome-bridge
# - 止血方案：Node 查找更健壮，有 doctor 命令诊断
# - 根治方案：自动下载预编译二进制，不依赖用户 Node 环境
```

---

## Phase 1: 止血方案

### 1.1 修复一致性问题

#### 命令名统一为 `mcp-chrome-bridge`

| 文件                                        | 修改内容                                                      |
| ------------------------------------------- | ------------------------------------------------------------- |
| `app/native-server/src/scripts/constant.ts` | `COMMAND_NAME` 改为 `mcp-chrome-bridge`                       |
| `app/native-server/src/cli.ts`              | 统一使用常量，移除硬编码                                      |
| `app/native-server/package.json`            | 添加 `"chrome-mcp-bridge": "./dist/cli.js"` alias（向后兼容） |

#### 端口统一为 `12306`

| 文件                                      | 修改内容                      |
| ----------------------------------------- | ----------------------------- |
| `docs/mcp-cli-config.md`                  | 56889 → 12306                 |
| `app/native-server/src/constant/index.ts` | `NATIVE_SERVER_PORT` → 12306  |
| `packages/shared/src/constants.ts`        | `DEFAULT_SERVER_PORT` → 12306 |

#### 文档统一

- `README.md` / `README_zh.md`
- `docs/TROUBLESHOOTING.md` / `docs/TROUBLESHOOTING_zh.md`
- `docs/WINDOWS_INSTALL_zh.md`
- `app/native-server/install.md`

### 1.2 添加 `doctor` 诊断命令

#### CLI 接口

```bash
mcp-chrome-bridge doctor [--json] [--fix] [--browser chrome|chromium|all]
```

#### 检查项

1. **安装与版本** - 版本号、平台、架构、运行路径
2. **注册状态** - manifest 文件存在性和内容校验
3. **Windows 注册表** - 检查 `HKCU/.../NativeMessagingHosts/<HOST_NAME>`
4. **宿主权限** - `run_host.sh/.bat` 是否可执行
5. **Node 路径** - `node_path.txt` 是否有效
6. **运行态连通** - 可选 ping 检查
7. **日志定位** - 输出日志目录路径

#### 输出示例

```
mcp-chrome-bridge doctor v1.0.30

[OK]    Installation: v1.0.30, darwin-arm64
[OK]    Chrome manifest: /Users/xxx/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.chromemcp.nativehost.json
[OK]    Manifest content: valid
[ERROR] Node path: /usr/local/bin/node not found
        Fix: Run `mcp-chrome-bridge register` or set CHROME_MCP_NODE_PATH
[OK]    Host permissions: run_host.sh is executable

Next steps:
  1. mcp-chrome-bridge register --detect
  2. Reload Chrome extension
```

#### 文件变更

- **新增**: `app/native-server/src/scripts/doctor.ts`
- **修改**: `app/native-server/src/cli.ts`

### 1.3 改进 Node 查找逻辑

#### 查找顺序（`run_host.sh`）

```bash
# 0. 环境变量覆盖（新增）
CHROME_MCP_NODE_PATH

# 1. 安装时写入的路径
node_path.txt

# 2. Volta（新增）
$VOLTA_HOME/bin/node
~/.volta/bin/node

# 3. asdf（新增）
$ASDF_DATA_DIR/installs/nodejs/*/bin/node

# 4. fnm（新增）
$FNM_DIR/node-versions/*/installation/bin/node

# 5. NVM（现有）
~/.nvm/...

# 6. 常见路径（现有）
/opt/homebrew/bin/node
/usr/local/bin/node

# 7. 系统查找
command -v node
$PATH 遍历
```

#### 文件变更

- `app/native-server/src/scripts/run_host.sh`
- `app/native-server/src/scripts/run_host.bat`

---

## Phase 2: 根治方案

### 2.1 技术方案：Node SEA + 外置资源

使用 Node.js 22+ 的 Single Executable Application：

- 主程序打包成独立可执行文件
- `better-sqlite3` 的 `.node` 原生模块外置到 `resources/` 目录
- 运行时通过 bootstrap 设置 `NODE_PATH`

### 2.2 平台矩阵

| 平台    | 架构  | 优先级 |
| ------- | ----- | ------ |
| macOS   | arm64 | P0     |
| macOS   | x64   | P0     |
| Windows | x64   | P0     |
| Linux   | x64   | P1     |
| Linux   | arm64 | P2     |

### 2.3 产物结构

```
mcp-chrome-bridge-darwin-arm64.tar.gz
├── mcp-chrome-bridge              # SEA 可执行文件
└── resources/
    └── node_modules/
        └── better-sqlite3/
            └── build/Release/better_sqlite3.node
```

### 2.4 npm 分发：optionalDependencies

```json
{
  "name": "mcp-chrome-bridge",
  "optionalDependencies": {
    "@mcp-chrome-bridge/native-darwin-arm64": "x.x.x",
    "@mcp-chrome-bridge/native-darwin-x64": "x.x.x",
    "@mcp-chrome-bridge/native-win32-x64": "x.x.x",
    "@mcp-chrome-bridge/native-linux-x64": "x.x.x"
  }
}
```

**优势**：

- 不依赖 postinstall 脚本
- pnpm 禁用 scripts 也能正确安装
- manifest 指向平台包里的二进制

### 2.5 CI/CD 构建

新增 `.github/workflows/release-native.yml`：

1. 矩阵构建：macOS-arm64, macOS-x64, Windows-x64, Linux-x64
2. 每个平台执行 `pnpm install --prod`
3. 构建 TypeScript → dist
4. SEA 打包
5. 收集 resources
6. 打包上传到 GitHub Release

---

## Phase 3: 分发渠道

### 3.1 Homebrew (macOS/Linux)

创建 tap 仓库，用户安装命令：

```bash
brew tap anthropics/mcp-chrome
brew install mcp-chrome-bridge
mcp-chrome-bridge register --detect
```

### 3.2 winget (Windows)

Portable 模式分发：

```powershell
winget install anthropics.mcp-chrome-bridge
mcp-chrome-bridge register --detect
```

### 3.3 Linux

提供 tar.gz 下载 + 安装文档，后续考虑 deb/rpm。

---

## 任务拆解

### Phase 1: 止血（预计 1-2 周）

#### Task 1.1: 修复命令名一致性

- [ ] 修改 `app/native-server/src/scripts/constant.ts` 中的 `COMMAND_NAME`
- [ ] 修改 `app/native-server/src/cli.ts` 使用常量
- [ ] 在 `package.json` 添加 `chrome-mcp-bridge` alias
- [ ] 验证：安装后 `mcp-chrome-bridge -v` 和 `chrome-mcp-bridge -v` 都能工作

#### Task 1.2: 修复端口一致性

- [ ] 修改 `app/native-server/src/constant/index.ts` 端口为 12306
- [ ] 修改 `packages/shared/src/constants.ts` 端口为 12306
- [ ] 更新 `docs/mcp-cli-config.md`
- [ ] 验证：默认配置端口一致

#### Task 1.3: 更新文档

- [ ] 更新 `README.md` / `README_zh.md`
- [ ] 更新 `docs/TROUBLESHOOTING.md` / `docs/TROUBLESHOOTING_zh.md`
- [ ] 更新 `docs/WINDOWS_INSTALL_zh.md`
- [ ] 更新 `app/native-server/install.md`

#### Task 1.4: 实现 doctor 命令

- [ ] 创建 `app/native-server/src/scripts/doctor.ts`
- [ ] 实现版本检查
- [ ] 实现 manifest 检查
- [ ] 实现 Windows 注册表检查
- [ ] 实现权限检查
- [ ] 实现 Node 路径检查
- [ ] 实现 JSON 输出格式
- [ ] 在 `cli.ts` 注册 doctor 子命令
- [ ] 编写测试用例

#### Task 1.5: 改进 Node 查找

- [ ] 修改 `run_host.sh` 添加 Volta/asdf/fnm 支持
- [ ] 添加 `CHROME_MCP_NODE_PATH` 环境变量支持
- [ ] 修改 `run_host.bat` 同步改进
- [ ] 改进日志输出（显示查找过程）
- [ ] 测试各版本管理器场景

### Phase 2: 根治（预计 2-4 周）

#### Task 2.1: 搭建 CI 构建

- [ ] 创建 `.github/workflows/release-native.yml`
- [ ] 配置矩阵构建（4 平台）
- [ ] 测试构建流程

#### Task 2.2: 实现 Node SEA 打包

- [ ] 研究 Node SEA 打包 better-sqlite3 的最佳实践
- [ ] 实现 bootstrap 脚本设置 `NODE_PATH`
- [ ] 实现资源收集脚本
- [ ] 测试各平台可执行文件

#### Task 2.3: 创建平台包

- [ ] 创建 `packages/native-darwin-arm64/package.json`
- [ ] 创建 `packages/native-darwin-x64/package.json`
- [ ] 创建 `packages/native-win32-x64/package.json`
- [ ] 创建 `packages/native-linux-x64/package.json`
- [ ] 配置 npm 发布流程

#### Task 2.4: 修改 manifest 生成

- [ ] 修改 `app/native-server/src/scripts/utils.ts`
- [ ] 实现 `resolveNativeBinary()` 函数
- [ ] manifest `path` 指向平台包二进制
- [ ] 测试安装后 manifest 正确

### Phase 3: 分发（预计 1-2 周）

#### Task 3.1: Homebrew

- [ ] 创建 `homebrew-mcp-chrome` 仓库
- [ ] 编写 Formula
- [ ] 配置自动更新 PR
- [ ] 编写安装文档

#### Task 3.2: winget

- [ ] 准备 portable 包
- [ ] 生成 winget manifests
- [ ] 提交到 `microsoft/winget-pkgs`
- [ ] 编写安装文档

#### Task 3.3: 文档更新

- [ ] 创建 `docs/INSTALL_HOMEBREW.md`
- [ ] 创建 `docs/INSTALL_WINGET.md`
- [ ] 更新主 README 安装说明

---

## 关键文件清单

### 需要修改的文件

```
app/native-server/src/scripts/constant.ts      # 命令名常量
app/native-server/src/scripts/postinstall.ts   # 打印提示
app/native-server/src/cli.ts                   # CLI 入口
app/native-server/src/scripts/run_host.sh      # Node 查找
app/native-server/src/scripts/run_host.bat     # Node 查找（Windows）
app/native-server/src/constant/index.ts        # 端口常量
app/native-server/src/scripts/utils.ts         # manifest 生成
app/native-server/package.json                 # bin alias
packages/shared/src/constants.ts               # 共享常量
README.md
README_zh.md
docs/mcp-cli-config.md
docs/TROUBLESHOOTING.md
docs/TROUBLESHOOTING_zh.md
docs/WINDOWS_INSTALL_zh.md
app/native-server/install.md
```

### 需要新增的文件

```
app/native-server/src/scripts/doctor.ts        # doctor 命令
.github/workflows/release-native.yml           # CI 构建
packages/native-darwin-arm64/package.json      # 平台包
packages/native-darwin-x64/package.json
packages/native-win32-x64/package.json
packages/native-linux-x64/package.json
docs/INSTALL_HOMEBREW.md
docs/INSTALL_WINGET.md
```
