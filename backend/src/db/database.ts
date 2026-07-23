import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');
const dbPath = path.join(dataDir, 'app.sqlite');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT,
      price REAL,
      stock INTEGER,
      features TEXT,
      size_guide TEXT,
      target_users TEXT,
      scene TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      source TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      channel TEXT,
      status TEXT,
      intent TEXT,
      emotion TEXT,
      manual_required INTEGER DEFAULT 0,
      summary TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      user_input TEXT NOT NULL,
      intent TEXT,
      skill TEXT,
      status TEXT,
      result TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tool_call_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      tool_name TEXT,
      input TEXT,
      output TEXT,
      status TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS knowledge_suggestions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      reason TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS knowledge_embeddings (
      chunk_id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      vector TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS channel_conversations (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      open_kfid TEXT,
      conversation_id TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(channel, external_user_id, open_kfid)
    );

    CREATE TABLE IF NOT EXISTS channel_messages (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      external_msg_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      raw_payload TEXT,
      created_at TEXT,
      UNIQUE(channel, external_msg_id)
    );
  `);
}

export function resetData() {
  db.exec(`
    DELETE FROM tool_call_logs;
    DELETE FROM agent_tasks;
    DELETE FROM messages;
    DELETE FROM conversations;
    DELETE FROM knowledge_suggestions;
    DELETE FROM knowledge_chunks;
    DELETE FROM products;
    DELETE FROM app_settings;
    DELETE FROM knowledge_embeddings;
    DELETE FROM channel_messages;
    DELETE FROM channel_conversations;
  `);
}
