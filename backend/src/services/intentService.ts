import type { Emotion, Intent } from '../types.js';

const includesAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

export function detectIntent(input: string): Intent {
  const text = input.toLowerCase();

  if (includesAny(text, ['退', '换', '售后', '质量', '磨损', '开胶', '掉色', '赔'])) {
    return includesAny(text, ['必须', '投诉', '赔', '生气', '没人']) ? 'complaint' : 'after_sale';
  }

  if (includesAny(text, ['尺码', '码', '脚宽', '宽脚', '脚背', '腿围', '身高', '体重'])) {
    return 'size_recommendation';
  }

  if (includesAny(text, ['推荐', '适合', '买哪', '半马', '全马', '慢跑', '膝盖'])) {
    return 'product_recommendation';
  }

  if (includesAny(text, ['物流', '快递', '订单', '发货', '地址'])) {
    return 'logistics';
  }

  if (includesAny(text, ['人工', '客服', '转接'])) {
    return 'manual_transfer';
  }

  return 'product_query';
}

export function detectEmotion(input: string): Emotion {
  const text = input.toLowerCase();
  if (includesAny(text, ['必须', '投诉', '生气', '太差', '不回', '赔', '垃圾', '离谱'])) {
    return 'negative';
  }

  if (includesAny(text, ['谢谢', '不错', '满意', '喜欢'])) {
    return 'positive';
  }

  return 'neutral';
}

export function intentLabel(intent: Intent) {
  const labels: Record<Intent, string> = {
    product_query: '商品咨询',
    size_recommendation: '尺码推荐',
    product_recommendation: '商品推荐',
    after_sale: '售后政策',
    logistics: '物流订单',
    complaint: '投诉安抚',
    manual_transfer: '转人工',
    operation_task: '运营任务'
  };

  return labels[intent];
}
