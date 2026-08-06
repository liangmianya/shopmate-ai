import { db } from '../db/database.js';

export type MaintenanceScope = 'business' | 'factory';

type CountResult = { count: number };

export type MaintenanceSummary = {
  products: number;
  knowledgeChunks: number;
  embeddings: number;
  orphanEmbeddings: number;
  suggestions: number;
  conversations: number;
  messages: number;
  channelConversations: number;
  channelMessages: number;
  agentTasks: number;
  toolCallLogs: number;
  settings: number;
  agentSkills: number;
};

export type DeletionResult = {
  requestedCount: number;
  deletedCount: number;
  embeddingDeletedCount: number;
};

function count(table: string) {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountResult).count;
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function getMaintenanceSummary(): MaintenanceSummary {
  const orphanEmbeddings = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM knowledge_embeddings embedding
    WHERE NOT EXISTS (SELECT 1 FROM knowledge_chunks chunk WHERE chunk.id = embedding.chunk_id)
      AND NOT EXISTS (
        SELECT 1
        FROM products product
        WHERE embedding.chunk_id = 'product:' || product.id
      )
  `).get() as CountResult).count;

  return {
    products: count('products'),
    knowledgeChunks: count('knowledge_chunks'),
    embeddings: count('knowledge_embeddings'),
    orphanEmbeddings,
    suggestions: count('knowledge_suggestions'),
    conversations: count('conversations'),
    messages: count('messages'),
    channelConversations: count('channel_conversations'),
    channelMessages: count('channel_messages'),
    agentTasks: count('agent_tasks'),
    toolCallLogs: count('tool_call_logs'),
    settings: count('app_settings'),
    agentSkills: count('agent_skills')
  };
}

export function deleteProductsByIds(ids: string[]): DeletionResult {
  const targetIds = uniqueIds(ids);
  const deleteProduct = db.prepare('DELETE FROM products WHERE id = ?');
  const deleteEmbedding = db.prepare('DELETE FROM knowledge_embeddings WHERE chunk_id = ?');
  let deletedCount = 0;
  let embeddingDeletedCount = 0;

  db.transaction(() => {
    for (const id of targetIds) {
      embeddingDeletedCount += deleteEmbedding.run(`product:${id}`).changes;
      deletedCount += deleteProduct.run(id).changes;
    }
  })();

  return { requestedCount: targetIds.length, deletedCount, embeddingDeletedCount };
}

export function deleteKnowledgeByIds(ids: string[]): DeletionResult {
  const targetIds = uniqueIds(ids);
  const deleteKnowledge = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?');
  const deleteEmbedding = db.prepare('DELETE FROM knowledge_embeddings WHERE chunk_id = ?');
  let deletedCount = 0;
  let embeddingDeletedCount = 0;

  db.transaction(() => {
    for (const id of targetIds) {
      embeddingDeletedCount += deleteEmbedding.run(id).changes;
      deletedCount += deleteKnowledge.run(id).changes;
    }
  })();

  return { requestedCount: targetIds.length, deletedCount, embeddingDeletedCount };
}

export function deleteSuggestionsByIds(ids: string[]) {
  const targetIds = uniqueIds(ids);
  const remove = db.prepare('DELETE FROM knowledge_suggestions WHERE id = ?');
  let deletedCount = 0;
  db.transaction(() => {
    for (const id of targetIds) {
      deletedCount += remove.run(id).changes;
    }
  })();
  return { requestedCount: targetIds.length, deletedCount };
}

export function deleteConversationsByIds(ids: string[]) {
  const targetIds = uniqueIds(ids);
  const deleteChannelMessages = db.prepare('DELETE FROM channel_messages WHERE conversation_id = ?');
  const deleteChannelConversations = db.prepare('DELETE FROM channel_conversations WHERE conversation_id = ?');
  const deleteMessages = db.prepare('DELETE FROM messages WHERE conversation_id = ?');
  const deleteConversation = db.prepare('DELETE FROM conversations WHERE id = ?');
  let deletedCount = 0;
  let messageDeletedCount = 0;

  db.transaction(() => {
    for (const id of targetIds) {
      messageDeletedCount += deleteChannelMessages.run(id).changes;
      deleteChannelConversations.run(id);
      messageDeletedCount += deleteMessages.run(id).changes;
      deletedCount += deleteConversation.run(id).changes;
    }
  })();

  return { requestedCount: targetIds.length, deletedCount, messageDeletedCount };
}

export function clearAgentHistory() {
  let toolCallLogs = 0;
  let agentTasks = 0;
  db.transaction(() => {
    toolCallLogs = db.prepare('DELETE FROM tool_call_logs').run().changes;
    agentTasks = db.prepare('DELETE FROM agent_tasks').run().changes;
  })();
  return { agentTasks, toolCallLogs };
}

export function cleanupOrphanEmbeddings() {
  const deletedCount = db.prepare(`
    DELETE FROM knowledge_embeddings
    WHERE NOT EXISTS (SELECT 1 FROM knowledge_chunks chunk WHERE chunk.id = knowledge_embeddings.chunk_id)
      AND NOT EXISTS (
        SELECT 1
        FROM products product
        WHERE knowledge_embeddings.chunk_id = 'product:' || product.id
      )
  `).run().changes;
  return { deletedCount };
}

export function factoryReset(scope: MaintenanceScope) {
  const before = getMaintenanceSummary();
  db.transaction(() => {
    db.exec(`
      DELETE FROM channel_messages;
      DELETE FROM channel_conversations;
      DELETE FROM messages;
      DELETE FROM conversations;
      DELETE FROM tool_call_logs;
      DELETE FROM agent_tasks;
      DELETE FROM knowledge_suggestions;
      DELETE FROM knowledge_embeddings;
      DELETE FROM knowledge_chunks;
      DELETE FROM products;
    `);
    if (scope === 'factory') {
      db.exec(`
        DELETE FROM app_settings;
        DELETE FROM agent_skills;
      `);
    }
  })();

  return { scope, before, summary: getMaintenanceSummary() };
}
