import { db } from '../db/database.js';

type MessageVolumeRow = {
  day: string;
  user_count: number;
  bot_count: number;
  manual_count: number;
};

type RankedRow = {
  label: string;
  count: number;
};

const intentLabels: Record<string, string> = {
  product_query: '商品咨询',
  size_recommendation: '尺码推荐',
  product_recommendation: '商品推荐',
  after_sale: '售后政策',
  logistics: '物流订单',
  complaint: '投诉安抚',
  manual_transfer: '转人工',
  operation_task: '运营任务'
};

function isoDateOffset(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - (days - 1));
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function dateKey(value: string) {
  return value.slice(0, 10);
}

function buildDayKeys(days: number) {
  const result: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - offset);
    result.push(day.toISOString().slice(0, 10));
  }

  return result;
}

function normalizeQuestion(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function getOperationAnalytics(days: number) {
  const since = isoDateOffset(days);
  const volumeRows = db.prepare(`
    SELECT
      substr(created_at, 1, 10) AS day,
      SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_count,
      SUM(CASE WHEN role = 'assistant' AND COALESCE(sender_type, 'bot') = 'bot' THEN 1 ELSE 0 END) AS bot_count,
      SUM(CASE WHEN role = 'assistant' AND sender_type = 'manual' THEN 1 ELSE 0 END) AS manual_count
    FROM channel_messages
    WHERE created_at >= ?
    GROUP BY substr(created_at, 1, 10)
    ORDER BY day ASC
  `).all(since) as MessageVolumeRow[];

  const volumes = new Map(volumeRows.map((row) => [row.day, row]));
  const daily = buildDayKeys(days).map((day) => {
    const row = volumes.get(day);
    return {
      day,
      userMessages: Number(row?.user_count ?? 0),
      botMessages: Number(row?.bot_count ?? 0),
      manualMessages: Number(row?.manual_count ?? 0)
    };
  });

  const total = daily.reduce((sum, row) => ({
    userMessages: sum.userMessages + row.userMessages,
    botMessages: sum.botMessages + row.botMessages,
    manualMessages: sum.manualMessages + row.manualMessages
  }), { userMessages: 0, botMessages: 0, manualMessages: 0 });

  const conversationCount = (db.prepare(`
    SELECT COUNT(DISTINCT conversation_id) AS count
    FROM channel_messages
    WHERE created_at >= ? AND role = 'user'
  `).get(since) as { count: number }).count;

  const manuallyHandledCount = (db.prepare(`
    SELECT COUNT(DISTINCT conversation_id) AS count
    FROM channel_messages
    WHERE created_at >= ? AND sender_type = 'manual'
  `).get(since) as { count: number }).count;

  const statusRows = db.prepare(`
    SELECT
      COALESCE(c.intent, 'product_query') AS label,
      COUNT(*) AS count
    FROM conversations c
    WHERE c.updated_at >= ?
    GROUP BY COALESCE(c.intent, 'product_query')
    ORDER BY count DESC, label ASC
    LIMIT 8
  `).all(since) as RankedRow[];

  const emotionRows = db.prepare(`
    SELECT
      COALESCE(c.emotion, 'neutral') AS label,
      COUNT(*) AS count
    FROM conversations c
    WHERE c.updated_at >= ?
    GROUP BY COALESCE(c.emotion, 'neutral')
    ORDER BY count DESC, label ASC
  `).all(since) as RankedRow[];

  const questionRows = db.prepare(`
    SELECT content, COUNT(*) AS count, MAX(created_at) AS last_at
    FROM channel_messages
    WHERE created_at >= ? AND role = 'user' AND length(trim(content)) > 0
    GROUP BY content
    ORDER BY count DESC, last_at DESC
    LIMIT 8
  `).all(since) as Array<{ content: string; count: number; last_at: string }>;

  const pendingManual = db.prepare(`
    SELECT
      cc.conversation_id AS id,
      COALESCE(NULLIF(cc.display_name, ''), CASE WHEN cc.object_type = 'group' THEN '群聊 ' || cc.external_user_id ELSE '用户 ' || cc.external_user_id END) AS display_name,
      cc.object_type,
      COALESCE(last_message.content, '') AS last_message,
      COALESCE(last_message.created_at, cc.updated_at, '') AS updated_at
    FROM channel_conversations cc
    LEFT JOIN conversations c ON c.id = cc.conversation_id
    LEFT JOIN channel_messages last_message ON last_message.id = (
      SELECT cm.id
      FROM channel_messages cm
      WHERE cm.conversation_id = cc.conversation_id
      ORDER BY cm.created_at DESC, cm.rowid DESC
      LIMIT 1
    )
    WHERE c.status = 'manual_active'
    ORDER BY updated_at DESC
    LIMIT 8
  `).all() as Array<{
    id: string;
    display_name: string;
    object_type: string;
    last_message: string;
    updated_at: string;
  }>;

  const gapRows = db.prepare(`
    SELECT
      cc.conversation_id AS id,
      COALESCE(NULLIF(cc.display_name, ''), CASE WHEN cc.object_type = 'group' THEN '群聊 ' || cc.external_user_id ELSE '用户 ' || cc.external_user_id END) AS display_name,
      COALESCE(c.intent, 'product_query') AS intent,
      COALESCE(c.summary, '') AS summary,
      COALESCE(last_user.content, '') AS question,
      COALESCE(last_user.created_at, c.updated_at, cc.updated_at, '') AS updated_at
    FROM conversations c
    INNER JOIN channel_conversations cc ON cc.conversation_id = c.id
    LEFT JOIN channel_messages last_user ON last_user.id = (
      SELECT cm.id
      FROM channel_messages cm
      WHERE cm.conversation_id = c.id AND cm.role = 'user'
      ORDER BY cm.created_at DESC, cm.rowid DESC
      LIMIT 1
    )
    WHERE c.updated_at >= ? AND (c.manual_required = 1 OR c.status = 'manual_active')
    ORDER BY updated_at DESC
    LIMIT 8
  `).all(since) as Array<{
    id: string;
    display_name: string;
    intent: string;
    summary: string;
    question: string;
    updated_at: string;
  }>;

  const responseTotal = total.botMessages + total.manualMessages;

  return {
    range: { days, since, generatedAt: new Date().toISOString() },
    overview: {
      conversations: Number(conversationCount),
      userMessages: total.userMessages,
      botMessages: total.botMessages,
      manualMessages: total.manualMessages,
      manuallyHandledConversations: Number(manuallyHandledCount),
      activeManualConversations: pendingManual.length,
      autoReplyRate: responseTotal ? total.botMessages / responseTotal : 0,
      manualInterventionRate: conversationCount ? manuallyHandledCount / conversationCount : 0
    },
    daily,
    intents: statusRows.map((row) => ({ label: intentLabels[row.label] ?? row.label, count: Number(row.count) })),
    emotions: ['positive', 'neutral', 'negative'].map((emotion) => ({
      label: emotion,
      count: Number(emotionRows.find((row) => row.label === emotion)?.count ?? 0)
    })),
    frequentQuestions: questionRows.map((row) => ({
      text: normalizeQuestion(row.content),
      count: Number(row.count),
      lastAt: row.last_at
    })),
    pendingManual: pendingManual.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      objectType: row.object_type === 'group' ? 'group' : 'single',
      lastMessage: row.last_message,
      updatedAt: row.updated_at
    })),
    knowledgeGaps: gapRows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      intent: intentLabels[row.intent] ?? row.intent,
      question: row.question || row.summary || '该会话缺少可复用的标准答复。',
      updatedAt: row.updated_at
    }))
  };
}
