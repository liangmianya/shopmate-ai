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

export async function searchWeb(query: string, countOverride?: number): Promise<WebSource[]> {
  const settings = getSearchSettings();
  if (!settings.enabled || !settings.apiKey) {
    return [];
  }
  const count = typeof countOverride === 'number'
    ? Math.max(1, Math.min(10, Math.floor(countOverride)))
    : settings.count;

  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/web-search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      summary: true,
      count
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
