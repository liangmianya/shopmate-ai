import { nanoid } from 'nanoid';
import { getWecomAccessToken } from './wecomTokenService.js';

export type WecomKfTextMessage = {
  msgid: string;
  openKfid: string;
  externalUserId: string;
  content: string;
  raw: unknown;
};

type SyncMsgResponse = {
  errcode?: number;
  errmsg?: string;
  next_cursor?: string;
  has_more?: number;
  msg_list?: Array<{
    msgid?: string;
    open_kfid?: string;
    external_userid?: string;
    msgtype?: string;
    text?: {
      content?: string;
    };
  }>;
};

export async function syncWecomKfMessages({
  token,
  openKfid,
  cursor = ''
}: {
  token: string;
  openKfid?: string;
  cursor?: string;
}) {
  const accessToken = await getWecomAccessToken();
  const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cursor,
      token,
      limit: 100,
      open_kfid: openKfid,
      voice_format: 0
    })
  });

  const payload = (await response.json()) as SyncMsgResponse;
  if (payload.errcode && payload.errcode !== 0) {
    throw new Error(`WeCom sync_msg failed: ${payload.errcode} ${payload.errmsg ?? ''}`);
  }

  return {
    nextCursor: payload.next_cursor ?? '',
    hasMore: payload.has_more === 1,
    messages: (payload.msg_list ?? [])
      .filter((item) => item.msgtype === 'text' && item.text?.content && item.external_userid && item.open_kfid && item.msgid)
      .map((item) => ({
        msgid: item.msgid ?? '',
        openKfid: item.open_kfid ?? '',
        externalUserId: item.external_userid ?? '',
        content: item.text?.content ?? '',
        raw: item
      }))
  };
}

export async function sendWecomKfTextMessage({
  toUser,
  openKfid,
  content
}: {
  toUser: string;
  openKfid: string;
  content: string;
}) {
  const accessToken = await getWecomAccessToken();
  const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      touser: toUser,
      open_kfid: openKfid,
      msgid: nanoid(),
      msgtype: 'text',
      text: { content }
    })
  });

  const payload = (await response.json()) as { errcode?: number; errmsg?: string };
  if (payload.errcode && payload.errcode !== 0) {
    throw new Error(`WeCom send_msg failed: ${payload.errcode} ${payload.errmsg ?? ''}`);
  }

  return payload;
}
