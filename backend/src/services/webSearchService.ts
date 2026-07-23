import { getSearchSettings } from './settingsService.js';

export type WebSource = {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  siteName: string;
  datePublished?: string;
};

type BochaSearchResponse = {
  data?: {
    webPages?: {
      value?: Array<{
        name?: string;
        url?: string;
        snippet?: string;
        summary?: string;
        siteName?: string;
        datePublished?: string;
      }>;
    };
  };
};

const webIntentWords = [
  '网上',
  '最新',
  '近期',
  '现在',
  '官网',
  '查一下',
  '搜索',
  '评价',
  '测评',
  '发布',
  '新闻',
  '趋势',
  '口碑',
  '公开资料',
  '世界杯',
  '奥运',
  '赛程',
  '决赛',
  '半决赛',
  '体育新闻',
  '比赛结果'
];
const internalOnlyWords = ['订单', '库存', '本店价格', '退货', '换货', '售后', '赔偿', '赔付', '地址', '手机号', '物流单号'];

export function shouldUseWebSearch(query: string, localConfidence: number) {
  const wantsWeb = webIntentWords.some((word) => query.includes(word));
  const internalOnly = internalOnlyWords.some((word) => query.includes(word));

  if (internalOnly && !wantsWeb) {
    return false;
  }

  return wantsWeb || localConfidence < 0.26;
}

export async function searchWeb(query: string): Promise<WebSource[]> {
  const settings = getSearchSettings();
  if (!settings.enabled || !settings.apiKey) {
    return [];
  }

  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/web-search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      summary: true,
      count: settings.count
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Bocha search failed: ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }

  const payload = (await response.json()) as BochaSearchResponse;
  return (payload.data?.webPages?.value ?? [])
    .filter((item) => item.url && item.name)
    .map((item) => ({
      title: item.name ?? '',
      url: item.url ?? '',
      snippet: item.snippet ?? '',
      summary: item.summary ?? '',
      siteName: item.siteName ?? '',
      datePublished: item.datePublished
    }));
}
