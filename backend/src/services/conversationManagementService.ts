import { nanoid } from 'nanoid';
import { db } from '../db/database.js';
import { sendWecomAibotMarkdownMessage } from './wecomAibotLongConnectionService.js';

const now = () => new Date().toISOString();

type ConversationRow = {
  id: string;
  conversation_id: string;
  channel: string;
  external_user_id: string;
  open_kfid: string;
  object_type: string;
  display_name: string;
  takeover_status: string;
  updated_at: string;
  status?: string;
  manual_required?: number;
  last_content?: string;
  last_role?: string;
  last_sender_type?: string;
  last_message_at?: string;
};

function mapConversation(row: ConversationRow) {
  const objectType = row.object_type === 'group' ? 'group' : 'single';
  const status = row.status === 'manual_active'
    ? 'manual_active'
    : row.manual_required
      ? 'manual_required'
      : 'bot';

  return {
    id: row.conversation_id,
    channel: row.channel,
    objectId: row.external_user_id,
    objectType,
    displayName: row.display_name || (objectType === 'group' ? `群聊 ${row.external_user_id}` : `用户 ${row.external_user_id}`),
    botId: row.open_kfid || '',
    status,
    lastMessage: row.last_content || '',
    lastMessageRole: row.last_role || '',
    lastMessageSender: row.last_sender_type || '',
    lastMessageAt: row.last_message_at || row.updated_at || ''
  };
}

function getChannelConversation(conversationId: string) {
  const row = db.prepare(`
    SELECT id, conversation_id, channel, external_user_id, open_kfid, object_type, display_name, takeover_status, updated_at
    FROM channel_conversations
    WHERE conversation_id = ?
  `).get(conversationId) as ConversationRow | undefined;

  if (!row) {
    throw new Error('Conversation not found');
  }

  return row;
}

function ensureCoreConversation(conversationId: string, channel: string) {
  const existing = db.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId);
  if (existing) {
    return;
  }

  const timestamp = now();
  db.prepare(`
    INSERT INTO conversations (id, customer_id, channel, status, intent, emotion, manual_required, summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(conversationId, 'channel', channel, 'active', 'product_query', 'neutral', 0, '', timestamp, timestamp);
}

export function listManagedConversations() {
  const rows = db.prepare(`
    SELECT
      cc.id,
      cc.conversation_id,
      cc.channel,
      cc.external_user_id,
      COALESCE(cc.open_kfid, '') AS open_kfid,
      COALESCE(cc.object_type, 'single') AS object_type,
      COALESCE(cc.display_name, '') AS display_name,
      COALESCE(cc.takeover_status, 'bot') AS takeover_status,
      COALESCE(cc.updated_at, '') AS updated_at,
      c.status,
      c.manual_required,
      lm.content AS last_content,
      lm.role AS last_role,
      COALESCE(lm.sender_type, lm.role) AS last_sender_type,
      lm.created_at AS last_message_at
    FROM channel_conversations cc
    LEFT JOIN conversations c ON c.id = cc.conversation_id
    LEFT JOIN channel_messages lm ON lm.id = (
      SELECT cm.id
      FROM channel_messages cm
      WHERE cm.conversation_id = cc.conversation_id
      ORDER BY cm.created_at DESC, cm.rowid DESC
      LIMIT 1
    )
    ORDER BY COALESCE(lm.created_at, cc.updated_at) DESC
  `).all() as ConversationRow[];

  return rows.map(mapConversation);
}

export function getManagedConversationMessages(conversationId: string) {
  getChannelConversation(conversationId);

  const rows = db.prepare(`
    SELECT id, external_msg_id, role, content, COALESCE(sender_type, role) AS sender_type, created_at
    FROM channel_messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(conversationId) as Array<{
    id: string;
    external_msg_id: string;
    role: 'user' | 'assistant';
    content: string;
    sender_type: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    externalMessageId: row.external_msg_id,
    role: row.role,
    senderType: row.role === 'user' ? 'user' : row.sender_type === 'manual' ? 'manual' : 'bot',
    content: row.content || '',
    createdAt: row.created_at
  }));
}

export function takeoverManagedConversation(conversationId: string) {
  const conversation = getChannelConversation(conversationId);
  ensureCoreConversation(conversationId, conversation.channel);
  const timestamp = now();

  db.prepare(`
    UPDATE conversations
    SET status = 'manual_active', manual_required = 1, updated_at = ?
    WHERE id = ?
  `).run(timestamp, conversationId);

  db.prepare(`
    UPDATE channel_conversations
    SET takeover_status = 'manual', updated_at = ?
    WHERE conversation_id = ?
  `).run(timestamp, conversationId);

  return listManagedConversations().find((item) => item.id === conversationId);
}

export function releaseManagedConversation(conversationId: string) {
  const conversation = getChannelConversation(conversationId);
  ensureCoreConversation(conversationId, conversation.channel);
  const timestamp = now();

  db.prepare(`
    UPDATE conversations
    SET status = 'active', manual_required = 0, updated_at = ?
    WHERE id = ?
  `).run(timestamp, conversationId);

  db.prepare(`
    UPDATE channel_conversations
    SET takeover_status = 'bot', updated_at = ?
    WHERE conversation_id = ?
  `).run(timestamp, conversationId);

  return listManagedConversations().find((item) => item.id === conversationId);
}

export function sendManagedManualMessage(conversationId: string, content: string) {
  const conversation = getChannelConversation(conversationId);
  if (conversation.channel !== 'wecom_aibot') {
    throw new Error('Manual sending is only supported for WeCom AIBot long-connection conversations');
  }

  ensureCoreConversation(conversationId, conversation.channel);
  const chatType = conversation.object_type === 'group' ? 2 : 1;
  sendWecomAibotMarkdownMessage({
    chatid: conversation.external_user_id,
    chatType,
    content
  });

  const timestamp = now();
  const externalMsgId = `manual:${nanoid()}`;
  db.prepare(`
    INSERT INTO channel_messages (id, channel, external_msg_id, conversation_id, role, content, sender_type, raw_payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nanoid(), conversation.channel, externalMsgId, conversationId, 'assistant', content, 'manual', JSON.stringify({ source: 'manual_console' }), timestamp);

  db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(nanoid(), conversationId, 'assistant', content, timestamp);

  db.prepare(`
    UPDATE conversations
    SET status = 'manual_active', manual_required = 1, updated_at = ?
    WHERE id = ?
  `).run(timestamp, conversationId);

  db.prepare(`
    UPDATE channel_conversations
    SET takeover_status = 'manual', updated_at = ?
    WHERE conversation_id = ?
  `).run(timestamp, conversationId);

  return {
    message: {
      id: externalMsgId,
      externalMessageId: externalMsgId,
      role: 'assistant' as const,
      senderType: 'manual' as const,
      content,
      createdAt: timestamp
    },
    conversation: listManagedConversations().find((item) => item.id === conversationId)
  };
}
