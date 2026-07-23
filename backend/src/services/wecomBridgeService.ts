import { nanoid } from 'nanoid';
import { db } from '../db/database.js';
import { handleChat } from './chatService.js';
import { getWecomSettings } from './settingsService.js';
import { sendWecomKfTextMessage, syncWecomKfMessages, type WecomKfTextMessage } from './wecomKfService.js';

const now = () => new Date().toISOString();
const CHANNEL = 'wecom_kf';

function getOrCreateConversation(message: WecomKfTextMessage) {
  const existing = db
    .prepare('SELECT conversation_id FROM channel_conversations WHERE channel = ? AND external_user_id = ? AND open_kfid = ?')
    .get(CHANNEL, message.externalUserId, message.openKfid) as { conversation_id: string } | undefined;

  if (existing) {
    return existing.conversation_id;
  }

  const id = nanoid();
  const timestamp = now();
  db.prepare(`
    INSERT INTO channel_conversations (id, channel, external_user_id, open_kfid, conversation_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nanoid(), CHANNEL, message.externalUserId, message.openKfid, id, timestamp, timestamp);

  return id;
}

function hasProcessedMessage(msgid: string) {
  const row = db
    .prepare('SELECT id FROM channel_messages WHERE channel = ? AND external_msg_id = ?')
    .get(CHANNEL, msgid);
  return Boolean(row);
}

function saveChannelMessage(message: WecomKfTextMessage, conversationId: string, role: 'user' | 'assistant', content: string, externalMsgId = message.msgid) {
  db.prepare(`
    INSERT OR IGNORE INTO channel_messages (id, channel, external_msg_id, conversation_id, role, content, raw_payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nanoid(), CHANNEL, externalMsgId, conversationId, role, content, JSON.stringify(message.raw), now());
}

async function processTextMessage(message: WecomKfTextMessage) {
  if (hasProcessedMessage(message.msgid)) {
    return;
  }

  const conversationId = getOrCreateConversation(message);
  saveChannelMessage(message, conversationId, 'user', message.content);

  const result = await handleChat(message.content, [], conversationId);
  const reply = result.manualRequired
    ? `${result.answer}\n\n这个问题我已经帮你记录，会有人工客服继续跟进。`
    : result.answer;

  await sendWecomKfTextMessage({
    toUser: message.externalUserId,
    openKfid: message.openKfid,
    content: reply
  });

  saveChannelMessage(message, conversationId, 'assistant', reply, `reply:${message.msgid}`);
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
