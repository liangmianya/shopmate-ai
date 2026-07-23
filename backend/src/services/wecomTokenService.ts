import { getWecomSettings } from './settingsService.js';

let cachedToken = '';
let expiresAt = 0;

export async function getWecomAccessToken() {
  const now = Date.now();
  if (cachedToken && now < expiresAt - 60_000) {
    return cachedToken;
  }

  const settings = getWecomSettings();
  if (!settings.corpId || !settings.secret) {
    throw new Error('WeCom corpId or secret is not configured');
  }

  const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
  url.searchParams.set('corpid', settings.corpId);
  url.searchParams.set('corpsecret', settings.secret);

  const response = await fetch(url);
  const payload = (await response.json()) as {
    errcode?: number;
    errmsg?: string;
    access_token?: string;
    expires_in?: number;
  };

  if (payload.errcode && payload.errcode !== 0) {
    throw new Error(`WeCom gettoken failed: ${payload.errcode} ${payload.errmsg ?? ''}`);
  }

  if (!payload.access_token) {
    throw new Error('WeCom gettoken response did not include access_token');
  }

  cachedToken = payload.access_token;
  expiresAt = now + (payload.expires_in ?? 7200) * 1000;

  return cachedToken;
}
