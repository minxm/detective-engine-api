# detective-engine-api

AI 推理侦探游戏后端 — EdgeOne Cloud Functions + 可替换存储层。

## 架构

```
浏览器 → /api/* → Cloud Functions
                    ├── DatabaseAdapter (memory | mongodb)
                    ├── KvAdapter (memory | edgeone)
                    ├── BlobAdapter (local | edgeone)
                    └── CloudBase Auth 验证
                              ↓
                         硅基流动 AI
```

## 适配器切换

| 环境变量 | 可选值 | 说明 |
|---------|--------|------|
| `DB_ADAPTER` | `memory`, `mongodb` | 业务数据库（推荐 MongoDB 生产） |
| `KV_ADAPTER` | `memory`, `edgeone` | 任务缓存、在线人数 |
| `BLOB_ADAPTER` | `local`, `edgeone` | AI 图片 URL 存储（案件生成时必调生图并上传） |

### MongoDB

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

首次登录自动创建用户，默认 `role: user`。提升为管理员示例（MongoDB）：

```js
db.users.updateOne({ _id: "用户ID" }, { $set: { role: "admin" } })
```

本地 memory 模式可直接编辑 `data/store.json` 中对应用户的 `role` 字段。

### EdgeOne KV

```env
KV_ADAPTER=edgeone
EO_SECRET_ID=...
EO_SECRET_KEY=...
EO_ZONE_ID=zone-xxx
KV_NAMESPACE=detective-kv
```

### EdgeOne Blob

```env
BLOB_ADAPTER=edgeone
BLOB_PUBLIC_BASE_URL=https://your-domain/blobs
EO_BLOB_UPLOAD_URL=https://your-blob-gateway
EO_BLOB_UPLOAD_TOKEN=...
```

案件生成时会固定调用 `AI_IMAGE_MODEL` 生图并上传 Blob（本地/线上一致，需配置 `SILICONFLOW_API_KEY`）。

## 本地开发

```bash
cp .env.example .env
npm install
npm run dev
```

## 部署到腾讯云 SCF

触发器 URL 示例：`https://1450903261-2c7ic9hgxq.ap-shanghai.tencentscf.com`

前端 `.env.production` 中的 `VITE_API_BASE` 应指向 `{触发器URL}/api`。

### 方式一：GitHub Actions 自动部署

仓库 `Settings → Secrets → Actions` 添加：

| Secret | 示例 / 说明 |
|--------|-------------|
| `TENCENT_SECRET_ID` | 腾讯云 API 密钥 |
| `TENCENT_SECRET_KEY` | 腾讯云 API 密钥 |
| `SCF_REGION` | `ap-shanghai` |
| `SCF_FUNCTION_NAME` | 控制台中的函数名 |
| `SCF_NAMESPACE` | `default` |
| `SILICONFLOW_API_KEY` | 硅基流动密钥 |
| `SILICONFLOW_BASE_URL` | `https://api.siliconflow.cn/v1` |
| `AI_CHAT_MODEL` / `AI_CASE_MODEL` / `AI_EVALUATE_MODEL` / `AI_IMAGE_MODEL` | 同 `.env.example` |
| `TCB_ENV_ID` / `TCB_PUBLIC_ENV_ID` / `TCB_REGION` | CloudBase |
| `TCB_SECRET_ID` / `TCB_SECRET_KEY` | CloudBase 服务端密钥 |
| `DB_ADAPTER` | 生产推荐 `mongodb`，测试可用 `memory` |
| `MONGODB_URI` / `MONGODB_DB` | MongoDB 连接（如启用） |
| `KV_ADAPTER` / `BLOB_ADAPTER` | 可选，默认可填 `memory` / `local` |

push 到 `main` 后 Actions 自动打包，并通过腾讯云官方 CLI（`tccli`）更新云函数。入口：`cloud-functions/index.main`，运行时 Node.js 20。

### 方式二：控制台手动上传

```bash
npm run package:scf
```

生成 `function.zip`，在 [SCF 控制台](https://console.cloud.tencent.com/scf) 上传代码包，并配置环境变量（同 `.env.example`）。

部署成功后访问根路径应返回 JSON（`service: detective-engine-api`），而不是 Hello World。

> **注意**：SCF 上使用 `DB_ADAPTER=memory` 数据不持久，生产请用 MongoDB。

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
