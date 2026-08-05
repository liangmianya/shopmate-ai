# Running Agent CS

面向个人电商的智能客服与运营 Agent 工作台。默认提供通用电商业务提示词，可在系统设置中改为任意垂直领域。

当前 MVP 包含：

- 客户侧 RAG 客服问答
- 商品、FAQ、售后、尺码知识库检索
- 对话保存与转人工摘要
- 运营 Agent 按需维护商品库、分析客服数据、生成报表或创建知识库草稿
- Agent 工具调用轨迹展示
- 可持久化的业务系统提示词配置

## 启动

```bash
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`，后端默认运行在 `http://localhost:4000`。

## 大模型配置

客服接口 `/api/chat` 会优先调用 OpenAI 兼容的 Chat Completions API；未配置或调用失败时，会自动回退到本地 RAG 规则回复，页面仍可正常演示。

在项目根目录创建 `.env` 或在启动前设置环境变量：

```bash
OPENAI_API_KEY=你的 API Key
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

也可以使用通用变量名接入其他 OpenAI 兼容服务：

```bash
LLM_API_KEY=你的 API Key
LLM_MODEL=你的模型名
LLM_BASE_URL=https://你的服务地址/v1
```

设置页还支持单独配置 Embedding 服务，用于客服 RAG 的向量混合召回：

```bash
EMBEDDING_API_KEY=你的 Embedding API Key
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
```

配置后，客服检索会优先调用 `{EMBEDDING_BASE_URL}/embeddings`，把知识库片段向量缓存到本地 SQLite 的 `knowledge_embeddings` 表，并使用“关键词分数 + 向量相似度”排序。未配置或调用失败时，会自动回退到关键词检索。

## 业务系统提示词

打开前端侧栏的“系统设置”，在“业务系统提示词”中定义店铺所属领域、服务范围、话术风格、规则和边界。保存后，运营 Agent 与智能客服都会在后续大模型请求中使用该配置；提示词保存在本地 SQLite 的 `app_settings` 表中。

默认提示词是通用电商版本。需要改为家居、美妆、数码或其他领域时，直接替换提示词内容并保存；“恢复默认”会删除自定义配置并还原通用电商默认值。

## 企业微信智能机器人长连接

渠道接入按企业微信开发者文档“智能机器人长连接”配置。进入企业微信智能机器人配置页，开启 API 模式并选择“长连接”，获取 BotID 和长连接专用 Secret。

可以在前端“渠道接入”页面保存，也可以通过环境变量配置：

```bash
WECOM_BOT_ID=智能机器人的 BotID
WECOM_AIBOT_SECRET=长连接专用 Secret
```

后端启动后会连接 `wss://openws.work.weixin.qq.com`，发送 `aibot_subscribe` 完成订阅，并每 30 秒发送一次 `ping` 保活。收到 `aibot_msg_callback` 文本消息后，会复用当前客服 RAG/LLM 流程生成回复，并通过 `aibot_respond_msg` 在同一条长连接主动推送结果。

注意：长连接模式与“设置接收消息回调地址”模式二选一；长连接不使用回调 URL、Token 或 EncodingAESKey。同一个机器人同一时间只能保持一个有效长连接，部署时不要为同一个 BotID 同时启动多个后端实例。

## 商品库

商品库支持单条新建、批量导入和删除。商品字段包含商品名、商品类型、品牌、特性、库存、价格和购买链接；批量导入时使用 `|` 分隔字段：

```text
商品名 | 商品类型 | 品牌 | 特性 | 库存 | 价格 | 购买链接
多效修护眼霜 | 眼部护理 | VitaSkin | 淡化黑眼圈，改善干纹 | 86 | 199 | https://example.com/products/eye-cream
```

系统会按“商品名 + 品牌 + 商品类型”跳过重复商品，避免重复点击或重复导入造成多份相同商品。

## 演示问题

```text
我想买一款适合通勤用的商品，预算 200 左右，有推荐吗？
我收到后发现不太合适，想退货，需要满足什么条件？
这个商品有购买链接吗？
```

## Agent 演示指令

```text
帮我补充一个商品：3CE 品牌腮红，库存 10，价格 99，特点非常自然，适合油皮。
统计当前商品库里库存最多的 10 个商品，用表格展示。
分析今天的客服对话，总结高频问题；如果发现明确知识缺口，再给我知识库补充建议。
```
