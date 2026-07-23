import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { migrate } from './db/database.js';
import chatRouter from './routes/chat.js';
import agentRouter from './routes/agent.js';
import knowledgeRouter from './routes/knowledge.js';
import productsRouter from './routes/products.js';
import settingsRouter from './routes/settings.js';
import wecomRouter from './routes/wecom.js';

migrate();

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'running-agent-cs-backend' });
});

app.use('/api/chat', chatRouter);
app.use('/api/agent', agentRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/products', productsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/channels/wecom', wecomRouter);

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
