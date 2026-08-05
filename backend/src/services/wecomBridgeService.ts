import { nanoid } from 'nanoid';
import { db } from '../db/database.js';
import { handleChat } from './chatService.js';
import { getWecomSettings } from './settingsService.js';
import { sendWecomKfTextMessage, syncWecomKfMessages, type WecomKfTextMessage } from './wecomKfService.js';

const now = () => new Date().toISOString();
const CHANNEL = 'wecom_kf';
const AIBOT_CHANNEL = 'wecom_aibot';

export type WecomAibotTextMessage = {
  msgid: string;
  aibotid: string;
  chatid: string;
  chattype: 'single' | 'group' | string;
  userId: string;
  content: string;
  raw: unknown;
};

type ChannelTextMessage = {
  msgid: string;
  openKfid: string;
  externalUserId: string;
  objectType?: 'single' | 'group' | string;
  displayName?: string;
  content: string;
  raw: unknown;
};

function getDisplayName(message: ChannelTextMessage) {
  if (message.displayName) {
    return message.displayName;
  }

  return message.objectType === 'group'
    ? `群聊 ${message.externalUserId}`
    : `用户 ${message.externalUserId}`;
}

function getOrCreateConversation(channel: string, message: ChannelTextMessage) {
  const existing = db
    .prepare('SELECT conversation_id FROM channel_conversations WHERE channel = ? AND external_user_id = ? AND open_kfid = ?')
    .get(channel, message.externalUserId, message.openKfid) as { conversation_id: string } | undefined;
  const timestamp = now();

  if (existing) {
    db.prepare(`
      UPDATE channel_conversations
      SET object_type = ?, display_name = ?, updated_at = ?
      WHERE channel = ? AND external_user_id = ? AND open_kfid = ?
    `).run(message.objectType || 'single', getDisplayName(message), timestamp, channel, message.externalUserId, message.openKfid);
    return existing.conversation_id;
  }

  const id = nanoid();
  db.prepare(`
    INSERT INTO channel_conversations (id, channel, external_user_id, open_kfid, conversation_id, object_type, display_name, takeover_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nanoid(), channel, message.externalUserId, message.openKfid, id, message.objectType || 'single', getDisplayName(message), 'bot', timestamp, timestamp);

  return id;
}

function hasProcessedMessage(channel: string, msgid: string) {
  const row = db
    .prepare('SELECT id FROM channel_messages WHERE channel = ? AND external_msg_id = ?')
    .get(channel, msgid);
  return Boolean(row);
}

function saveChannelMessage(
  channel: string,
  message: ChannelTextMessage,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  senderType: 'user' | 'bot' | 'manual' = role === 'user' ? 'user' : 'bot',
  externalMsgId = message.msgid
) {
  db.prepare(`
    INSERT OR IGNORE INTO channel_messages (id, channel, external_msg_id, conversation_id, role, content, sender_type, raw_payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nanoid(), channel, externalMsgId, conversationId, role, content, senderType, JSON.stringify(message.raw), now());
}

function saveCoreMessage(conversationId: string, role: 'user' | 'assistant', content: string) {
  db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(nanoid(), conversationId, role, content, now());
}

function getConversationStatus(conversationId: string) {
  const row = db
    .prepare('SELECT status FROM conversations WHERE id = ?')
    .get(conversationId) as { status: string } | undefined;
  return row?.status ?? 'active';
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

async function processTextMessage(message: WecomKfTextMessage) {
  if (hasProcessedMessage(CHANNEL, message.msgid)) {
    return;
  }

  const conversationId = getOrCreateConversation(CHANNEL, message);
  saveChannelMessage(CHANNEL, message, conversationId, 'user', message.content);

  if (getConversationStatus(conversationId) === 'manual_active') {
    ensureCoreConversation(conversationId, CHANNEL);
    saveCoreMessage(conversationId, 'user', message.content);
    return;
  }

  const result = await handleChat(message.content, [], conversationId);
  const reply = result.manualRequired
    ? `${result.answer}\n\n这个问题我已经帮你记录，会有人工客服继续跟进。`
    : result.answer;

  await sendWecomKfTextMessage({
    toUser: message.externalUserId,
    openKfid: message.openKfid,
    content: reply
  });

  saveChannelMessage(CHANNEL, message, conversationId, 'assistant', reply, 'bot', `reply:${message.msgid}`);
}

export async function processWecomKfEvent({ token, openKfid }: { token: string; openKfid?: string }) {
  const settings = getWecomSettings();
  if (!settings.enabled) {
    return;
  }

  let cursor = '';
  let hasMore = true;

  while (hasMore) {
    const result = await syncWecomKfMessages({
      token,
      openKfid: openKfid || settings.openKfid,
      cursor
    });

    for (const message of result.messages) {
      await processTextMessage(message);
    }

    cursor = result.nextCursor;
    hasMore = result.hasMore;
  }
}

export async function processWecomAibotTextMessage(message: WecomAibotTextMessage) {
  const channelMessage: ChannelTextMessage = {
    msgid: message.msgid,
    openKfid: message.aibotid,
    externalUserId: message.chattype === 'group' && message.chatid ? message.chatid : message.userId,
    objectType: message.chattype === 'group' ? 'group' : 'single',
    displayName: message.chattype === 'group' && message.chatid ? `群聊 ${message.chatid}` : `用户 ${message.userId}`,
    content: message.content,
    raw: message.raw
  };

  if (hasProcessedMessage(AIBOT_CHANNEL, channelMessage.msgid)) {
    return { status: 'duplicate' as const };
  }

  const conversationId = getOrCreateConversation(AIBOT_CHANNEL, channelMessage);
  saveChannelMessage(AIBOT_CHANNEL, channelMessage, conversationId, 'user', channelMessage.content);

  if (getConversationStatus(conversationId) === 'manual_active') {
    ensureCoreConversation(conversationId, AIBOT_CHANNEL);
    saveCoreMessage(conversationId, 'user', channelMessage.content);
    return {
      status: 'manual_active' as const,
      conversationId
    };
  }

  const result = await handleChat(channelMessage.content, [], conversationId);
  const reply = result.manualRequired
    ? `${result.answer}\n\n这个问题我已经帮你记录，会有人工客服继续跟进。`
    : result.answer;

  saveChannelMessage(AIBOT_CHANNEL, channelMessage, conversationId, 'assistant', reply, 'bot', `reply:${channelMessage.msgid}`);

  return {
    status: 'replied' as const,
    conversationId,
    reply
  };
}
