import { nanoid } from 'nanoid';
import WebSocket from 'ws';
import { getWecomSettings } from './settingsService.js';
import { processWecomAibotTextMessage } from './wecomBridgeService.js';

const WECOM_AIBOT_WS_URL = 'wss://openws.work.weixin.qq.com';
const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 5_000;

type WecomAibotPacket = {
  cmd?: string;
  headers?: {
    req_id?: string;
  };
  errcode?: number;
  errmsg?: string;
  body?: {
    msgid?: string;
    aibotid?: string;
    chatid?: string;
    chattype?: 'single' | 'group' | string;
    from?: {
      userid?: string;
    };
    msgtype?: string;
    text?: {
      content?: string;
    };
    event?: {
      eventtype?: string;
    };
  };
};

let socket: WebSocket | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let reconnectTimer: NodeJS.Timeout | undefined;
let stopped = true;

function reqId(prefix: string) {
  return `${prefix}_${nanoid()}`;
}

function clearTimer(timer: NodeJS.Timeout | undefined) {
  if (timer) {
    clearTimeout(timer);
  }
}

function clearIntervalTimer(timer: NodeJS.Timeout | undefined) {
  if (timer) {
    clearInterval(timer);
  }
}

function sendPacket(packet: WecomAibotPacket) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('WeCom AIBot long connection is not open');
  }

  socket.send(JSON.stringify(packet));
}

function sendSubscribe(botId: string, secret: string) {
  sendPacket({
    cmd: 'aibot_subscribe',
    headers: { req_id: reqId('subscribe') },
    body: {
      bot_id: botId,
      secret
    } as WecomAibotPacket['body'] & { bot_id: string; secret: string }
  });
}

function startHeartbeat() {
  clearIntervalTimer(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      sendPacket({
        cmd: 'ping',
        headers: { req_id: reqId('ping') }
      });
    } catch (error) {
      console.error('WeCom AIBot heartbeat failed:', error);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectWecomAibot();
  }, RECONNECT_DELAY_MS);
}

function respondWelcome(reqIdValue: string) {
  sendPacket({
    cmd: 'aibot_respond_welcome_msg',
    headers: { req_id: reqIdValue },
    body: {
      msgtype: 'text',
      text: {
        content: '您好！我是智能助手，有什么可以帮您？'
      }
    }
  });
}

function respondStream(reqIdValue: string, streamId: string, content: string, finish: boolean) {
  sendPacket({
    cmd: 'aibot_respond_msg',
    headers: { req_id: reqIdValue },
    body: {
      msgtype: 'stream',
      stream: {
        id: streamId,
        finish,
        content
      }
    } as WecomAibotPacket['body'] & {
      stream: {
        id: string;
        finish: boolean;
        content: string;
      };
    }
  });
}

async function handleMessageCallback(packet: WecomAibotPacket) {
  const body = packet.body;
  const callbackReqId = packet.headers?.req_id;
  const content = body?.text?.content?.trim();

  if (!body?.msgid || !body.aibotid || !body.from?.userid || !callbackReqId || body.msgtype !== 'text' || !content) {
    return;
  }

  try {
    const result = await processWecomAibotTextMessage({
      msgid: body.msgid,
      aibotid: body.aibotid,
      chatid: body.chatid ?? '',
      chattype: body.chattype ?? 'single',
      userId: body.from.userid,
      content,
      raw: packet
    });

    if (result.status === 'replied') {
      const streamId = `stream_${body.msgid}`;
      respondStream(callbackReqId, streamId, result.reply, true);
    }
  } catch (error) {
    console.error('WeCom AIBot message processing failed:', error);
    const streamId = `stream_${body.msgid}`;
    respondStream(callbackReqId, streamId, '抱歉，当前客服助手处理失败，请稍后再试。', true);
  }
}

function handleEventCallback(packet: WecomAibotPacket) {
  const eventType = packet.body?.event?.eventtype;
  const callbackReqId = packet.headers?.req_id;

  if (eventType === 'enter_chat' && callbackReqId) {
    try {
      respondWelcome(callbackReqId);
    } catch (error) {
      console.error('WeCom AIBot welcome response failed:', error);
    }
  }

  if (eventType === 'disconnected_event') {
    console.warn('WeCom AIBot disconnected_event received from server');
  }
}

function handleIncoming(data: WebSocket.RawData) {
  let packet: WecomAibotPacket;

  try {
    packet = JSON.parse(data.toString()) as WecomAibotPacket;
  } catch {
    console.warn('WeCom AIBot ignored non-JSON websocket message');
    return;
  }

  if (packet.errcode && packet.errcode !== 0) {
    console.error(`WeCom AIBot command failed: ${packet.errcode} ${packet.errmsg ?? ''}`);
    return;
  }

  if (packet.cmd === 'aibot_msg_callback') {
    handleMessageCallback(packet).catch((error) => {
      console.error('WeCom AIBot callback handler failed:', error);
    });
    return;
  }

  if (packet.cmd === 'aibot_event_callback') {
    handleEventCallback(packet);
  }
}

function connectWecomAibot() {
  const settings = getWecomSettings();
  if (!settings.enabled || !settings.botId || !settings.secret) {
    return;
  }

  stopped = false;
  clearTimer(reconnectTimer);
  reconnectTimer = undefined;

  const currentSocket = new WebSocket(WECOM_AIBOT_WS_URL);
  socket = currentSocket;

  currentSocket.on('open', () => {
    try {
      sendSubscribe(settings.botId, settings.secret);
      startHeartbeat();
      console.log('WeCom AIBot long connection opened');
    } catch (error) {
      console.error('WeCom AIBot subscribe failed:', error);
      currentSocket.close();
    }
  });

  currentSocket.on('message', handleIncoming);

  currentSocket.on('close', () => {
    if (socket !== currentSocket) {
      return;
    }

    clearIntervalTimer(heartbeatTimer);
    heartbeatTimer = undefined;
    socket = undefined;
    scheduleReconnect();
  });

  currentSocket.on('error', (error) => {
    console.error('WeCom AIBot websocket error:', error);
  });
}

export function startWecomAibotConnection() {
  stopped = false;
  connectWecomAibot();
}

export function stopWecomAibotConnection() {
  stopped = true;
  clearTimer(reconnectTimer);
  clearIntervalTimer(heartbeatTimer);
  reconnectTimer = undefined;
  heartbeatTimer = undefined;

  const currentSocket = socket;
  socket = undefined;

  if (currentSocket) {
    currentSocket.close();
  }
}

export function refreshWecomAibotConnection() {
  stopWecomAibotConnection();
  startWecomAibotConnection();
}

export function sendWecomAibotMarkdownMessage({
  chatid,
  chatType,
  content
}: {
  chatid: string;
  chatType: 1 | 2;
  content: string;
}) {
  sendPacket({
    cmd: 'aibot_send_msg',
    headers: { req_id: reqId('manual') },
    body: {
      chatid,
      chat_type: chatType,
      msgtype: 'markdown',
      markdown: {
        content
      }
    } as WecomAibotPacket['body'] & {
      chatid: string;
      chat_type: 1 | 2;
      markdown: {
        content: string;
      };
    }
  });
}
