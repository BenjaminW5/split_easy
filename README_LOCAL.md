# SplitEase / BREAD：Windows SQLite 本地模式

已在 2026-11-22 的 Windows 环境实际安装、构建、启动并验证。
入口为 FastAPI `app.local:app`，前端为 React/Vite `VITE_LOCAL_MODE=true`。
无需 PostgreSQL 服务、Docker、Electron 或其他独立软件。本次未创建或推送 GitHub 仓库。

## 当前电脑直接使用

访问 <http://127.0.0.1:5173>。本次调试结束时前后端保持运行。
健康检查：<http://127.0.0.1:8000/health>；API 文档：<http://127.0.0.1:8000/docs>。

程序目录：`E:\Codex\2026-11-22\referenced-chatgpt-conversation-this-is-an-3\outputs\split_easy`。
依赖已经安装。以后停止服务或重启电脑后，可分别双击目录中的
`start-backend.cmd` 和 `start-frontend.cmd`，保持两个窗口打开。
不要在服务已经运行时重复启动；端口占用时应先关闭旧服务。
手动启动的窗口中按 Ctrl+C 停止对应服务。

本次后台服务的日志在本项目工作区的 `work/` 下，文件名为
`backend-restart.stdout.log`、`backend-restart.stderr.log`、
`frontend-restart.stdout.log`、`frontend-restart.stderr.log`。
本次后台服务若需停止，可在 PowerShell 先确认监听者：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8000,5173 |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

再检查相应 PID 的进程命令行，确认是此项目的 uvicorn 或 Vite 后，仅停止对应 PID。
不要结束所有 Python 或 Node 进程。

## 在新目录安装依赖

需要 Python 3.12 和 Node.js/npm 可从终端调用。
实测版本：Python 3.12.14、Node.js 24.22.0、npm 11.19.1。
项目原本把 Node 固定为 20.18.1，因此本机 `npm ci` 有 `EBADENGINE` 提示，
但依赖安装、188 项前端测试和构建全部成功。为保持最少改动，没有修改该版本声明或锁文件。
本机没有 `py` 启动器，以下使用实际可用的 `python`；使用 `npm.cmd` 可避开 PowerShell 的 npm.ps1 执行策略问题。

在解压后的 `split_easy` 根目录打开 PowerShell，首次执行：

```powershell
Set-Location .\backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Set-Location ..\frontend
npm.cmd ci
Set-Location ..
```

`requirements-dev.txt` 包含原运行依赖及 pytest/httpx 测试依赖。
仅运行时可改用 `requirements.txt`。原项目的收据模块间接导入 psycopg，
因此保留驱动包，但 SQLite 模式不会连接 PostgreSQL 服务。
下载的修复 ZIP 不含 `.venv`、`node_modules`、构建产物或本机测试数据库，须先安装依赖。

## 准确的 Windows 手动启动命令

第一个 PowerShell 窗口：

```powershell
Set-Location 'E:\Codex\2026-11-22\referenced-chatgpt-conversation-this-is-an-3\outputs\split_easy\backend'
$env:OCR_PROVIDER = 'mock'
$env:SPLITEASE_SQLITE_PATH = Join-Path (Get-Location).Path 'splitease.db'
.\.venv\Scripts\python.exe -m uvicorn app.local:app --host 127.0.0.1 --port 8000
```

第二个 PowerShell 窗口：

```powershell
Set-Location 'E:\Codex\2026-11-22\referenced-chatgpt-conversation-this-is-an-3\outputs\split_easy\frontend'
$env:VITE_LOCAL_MODE = 'true'
$env:VITE_API_URL = 'http://127.0.0.1:8000'
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

若解压在其他位置，仅替换上面两个目录。打开 <http://127.0.0.1:5173>。
两个服务都只监听本机；`--strictPort` 防止前端悄悄换端口造成跨域失败。
启动脚本已经设置相同变量。原项目的 `.env` 不会由此 Uvicorn 启动方式自动加载；
后端变量请在启动前设置。

## 构建与测试

后端目录：

```powershell
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -m pytest tests/test_split_local.py tests/test_settlement_service.py tests/test_allocation.py tests/test_receipts_service.py tests/test_receipts_ocr.py -k 'not full_app' -q
```

前端目录，先跑现有全功能路由测试，再构建本地模式：

```powershell
Remove-Item Env:VITE_LOCAL_MODE -ErrorAction SilentlyContinue
npm.cmd test -- --run
$env:VITE_LOCAL_MODE = 'true'
$env:VITE_API_URL = 'http://127.0.0.1:8000'
npm.cmd run build
```

构建输出在 `frontend/dist/`。Vite 环境变量在构建时写入，修改后要重新构建。
现有前端路由测试包含完整版路由，所以测试时不要强制开启本地模式；
真实本地模式另外通过浏览器和 HTTP 联调验证。

### 后端健康检查

- 真正运行的 `/health` 返回 HTTP 200、`{"status":"ok"}`。
- `pip check` 通过，无依赖冲突。
- 本地模式、分账、金额分配、收据解析和 OCR 的选定测试共 **182 passed**。
- 其中本地模式文件有 10 项通过；明确排除其中 2 项需 PostgreSQL 的完整版测试。
- 其他需要 PostgreSQL 的集成测试未执行，不能据此声称完整版全部通过。
- 存在 1 条上游 Starlette/AnyIO 弃用提示，不影响本次测试。

### 前端构建

- `tsc --noEmit && vite build` 成功，67 个模块。
- 本地模式构建结果：HTML 0.46 kB、CSS 35.17 kB、JS 170.85 kB（未压缩传输大小）。
- 前端现有 **25 个测试文件、188 项测试全部通过**。
- 保留原依赖版本；没有做全项目格式化、依赖升级或安全审计。

### 前后端交互

- Chrome 真正打开本地模式，初始示例账单自动算出 AUD 73.60。
- 把披萨单价改为 AUD 25.00，修改标题和备注，自动重算为 AUD 74.75。
- Alex 18.98、Blair 18.97、Casey 36.80，三人金额相加为 74.75。
- 点击保存后从历史页面读取成功；重启后端与前端、刷新页面后记录仍存在。
- 本机保留一条明确标注 `Local verification 2026-11-22` 的演示记录；无真实付款。
- 真正 HTTP 联调的 9 组检查通过：健康、前端响应、两个本机来源的 CORS、
  重启持久化、金额计算、模拟 OCR、保存/读取/分页/照片、临时记录删除、非法输入校验。
- HTTP 临时测试记录已清理。模拟 OCR 返回 6 个示例菜品、总额 107.00。
- 浏览器最后一次控制台错误检查为空。交付目录附页面截图和 `live-checks.json`。
- 两个 `.cmd` 启动文件已实际用于重启服务并通过上述联调。

## 修改文件

| 文件 | 修改及原因 |
| --- | --- |
| `frontend/tsconfig.json` | 新增缺失的 TypeScript 工程配置，保留严格类型检查，修复 `npm run build` 仅显示 tsc 帮助并退出的问题。 |
| `backend/app/local.py` | 默认 CORS 增加 `http://127.0.0.1:5173`，兼容两种本机访问地址；保留 `CORS_ORIGINS` 覆盖能力。 |
| `backend/tests/test_split_local.py` | 新增健康和跨域回归测试，同时验证外部来源仍被拒绝。 |
| `backend/requirements-dev.txt` | 固定本次使用的 pytest/httpx 测试依赖，引用原运行依赖。 |
| `start-backend.cmd` | 固定工作目录、SQLite 数据位置及本机监听地址，启动现有后端。 |
| `start-frontend.cmd` | 启动现有前端，明确本地模式、API 地址和固定端口。 |
| `.gitignore` | 排除本机依赖、缓存、数据库、构建产物及私有环境文件。 |
| `README_LOCAL.md` | 安装、Windows 启动、构建、复测步骤和验证结果。 |

除上述两处已有文件的修改外，没有更改分账算法或页面业务逻辑。
修复压缩包还排除了原包自带的 Python 字节码缓存；原上传 ZIP 未被修改。

## 模式范围与数据位置

SQLite 文件为 `backend/splitease.db`。备份时先停止后端，再复制此文件。
数据库包含保存的账单、备注和附加照片；重启服务不会清除这些内容。
未保存的编辑状态仍在浏览器内存中，刷新页面会重置。

本地模式支持单账单分账、历史、备注及照片；未启用完整版的用户/群组/多人共享数据库。
默认 OCR 是模拟模式，每张图片都会得到同一组样例，不是真实识别。
真实收据识别需要单独设置 `OCR_PROVIDER=ocrspace` 和 `OCR_SPACE_API_KEY` 并联网；本次未配置或验证真实 OCR。
汇率换算是原项目的联网附加功能，基础分账和保存以 AUD 为准，不依赖汇率服务。

本交付是可运行源码和开发启动方式，不是 Windows EXE 安装包，也没有发布 GitHub。
