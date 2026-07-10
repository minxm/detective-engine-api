# detective-engine-api

AI 推理侦探游戏后端 — CloudBase 云托管 + 可替换存储层。

## 架构

```
浏览器 → VITE_API_BASE (/api/*) → CloudBase Run（容器型云托管）
                    ├── DatabaseAdapter (memory | cloudbase | mongodb)
                    ├── KvAdapter (memory | edgeone)
                    ├── BlobAdapter (local | cloudbase | edgeone)
                    └── CloudBase Auth 验证
                              ↓
                         硅基流动 AI
```

> 历史方案使用独立 SCF Web 函数，已迁移至同一 CloudBase 环境的云托管。回滚见 [deploy-scf.yml](.github/workflows/deploy-scf.yml)（仅手动触发）。

## 适配器切换

| 环境变量 | 可选值 | 说明 |
|---------|--------|------|
| `DB_ADAPTER` | `memory`, `cloudbase`, `mongodb` | 业务数据库（生产推荐 `cloudbase`） |
| `KV_ADAPTER` | `memory`, `edgeone` | 任务缓存、在线人数 |
| `BLOB_ADAPTER` | `local`, `cloudbase`, `edgeone` | AI 图片存储（云托管生产推荐 `cloudbase`） |

### CloudBase 文档型数据库（推荐）

```env
DB_ADAPTER=cloudbase
TCB_ENV_ID=your-env-id
TCB_SECRET_ID=...
TCB_SECRET_KEY=...
TCB_REGION=ap-shanghai
```

首次部署前在控制台或通过脚本创建集合：

```bash
npm run init:tcb-collections
```

需在 TCB 控制台创建以下集合（名称必须一致），权限建议 **仅管理端可读写**：

`users` · `cases` · `sessions` · `history` · `leaderboard` · `inventory` · `ai_logs` · `claims` · `login_audits` · `generation_jobs` · `online_presence` · `refill_jobs`

### MongoDB（可选，自建实例）

```env
DB_ADAPTER=mongodb
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=detective
```

### CloudBase 认证

```env
TCB_ENV_ID=your-env-id
TCB_SECRET_ID=...
TCB_SECRET_KEY=...
TCB_PUBLIC_ENV_ID=your-env-id   # 前端用
```

前端携带 `Authorization: Bearer <accessToken>`，后端通过 CloudBase HTTP API 验证。

### 用户角色

用户表 `users` 含 `role` 字段：

| 值 | 说明 |
|----|------|
| `user` | 普通用户（默认） |
| `admin` | 管理员，可访问 `/admin` 与库存补货 |

## 本地开发

```bash
cp .env.example .env
npm install
npm run dev
```

## 部署到 CloudBase 云托管

云托管默认域名示例：`https://detective-engine-api-xxxxx.ap-shanghai.run.tcloudbase.com`

前端 `.env.production` 中的 `VITE_API_BASE` 应指向 `{默认域名}/api`。

### GitHub Actions 自动部署（推荐）

仓库 `Settings → Secrets → Actions` 添加：

| Secret | 说明 |
|--------|------|
| `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` | 腾讯云 API 密钥（CAM） |
| `TCB_ENV_ID` | CloudBase 环境 ID |
| `CLOUDRUN_SERVICE_NAME` | 可选，默认 `detective-engine-api` |
| `SILICONFLOW_API_KEY` 及 `AI_*` / `TCB_*` | 同 `.env.example` |
| `DB_ADAPTER` | 生产推荐 `cloudbase` |

push 到 `main` 后 Actions 会：

1. `npm run build` 编译 TypeScript
2. 使用根目录 `Dockerfile` 通过 `@cloudbase/cli` 部署容器型云托管（端口 9000）
3. 通过 tcbr API 同步环境变量与资源配置（2GB 内存、0–5 副本）

部署日志会输出 `API base (set VITE_API_BASE)`，请将该地址写入前端仓库的 `.env.production` 并重新构建 `dist/`。

### 本地手动部署

```bash
npm run build
# 设置 TENCENT_SECRET_ID、TENCENT_SECRET_KEY、TCB_ENV_ID 等环境变量
npm run deploy:cloudrun
```

### 控制台建议配置

首次部署后，在 [云托管控制台](https://console.cloud.tencent.com/tcb/env/cloudrun) 确认：

- **公网访问**：已开启
- **请求超时**：建议 600s（案件生成、生图耗时较长）
- **跨域**：前端域名已加入 CloudBase 环境「安全来源」列表

### 停用旧 SCF 函数

迁移验证通过后，在 [SCF 控制台](https://console.cloud.tencent.com/scf) 删除或停用原 Web 函数，避免重复计费。

## API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/auth/config | 认证配置（前端初始化） |
| POST | /api/auth/heartbeat | 在线心跳 |
| POST | /api/case/create | 开始案件 |
| GET | /api/case/status | 轮询生成 |
| POST | /api/interrogate | SSE 审讯 |
| POST | /api/score | AI 评分 |
| GET | /api/history | 历史 |
| GET | /api/rank | 排行榜 |
| GET | /api/admin/dashboard | 运营面板 |
