# Running Agent CS

面向跑步装备个人电商的智能客服与运营 Agent 工作台。

当前 MVP 包含：

- 客户侧 RAG 客服问答
- 商品、FAQ、售后、尺码知识库检索
- 对话保存与转人工摘要
- 运营 Agent 对话分析
- 知识库补充建议草稿
- Agent 工具调用轨迹展示

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

## 演示问题

```text
我平时 42 码，脚有点宽，想买一双半马比赛鞋，推荐哪款？
我穿了一次发现鞋底磨得很厉害，想退货，你们必须给我退。
宽脚能穿竞速鞋吗？
```

## Agent 演示指令

```text
分析今天的客服对话，总结高频问题，并给我知识库补充建议。
```
