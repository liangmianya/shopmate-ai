import express, { Router } from 'express';
import { getWecomSettings } from '../services/settingsService.js';
import { decryptVerifiedXml, parseXml } from '../services/wecomCryptoService.js';
import { processWecomKfEvent } from '../services/wecomBridgeService.js';

const router = Router();

function getQueryValue(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

router.get('/kf/callback', (req, res) => {
  const settings = getWecomSettings();
  const signature = getQueryValue(req.query.msg_signature);
  const timestamp = getQueryValue(req.query.timestamp);
  const nonce = getQueryValue(req.query.nonce);
  const echostr = getQueryValue(req.query.echostr);

  if (!settings.enabled || !settings.token || !settings.encodingAesKey) {
    res.status(403).send('WeCom channel is not configured');
    return;
  }

  try {
    const decrypted = decryptVerifiedXml({
      token: settings.token,
      encodingAesKey: settings.encodingAesKey,
      signature,
      timestamp,
      nonce,
      encrypted: echostr
    });
    res.send(decrypted.message);
  } catch (error) {
    res.status(403).send(error instanceof Error ? error.message : 'Invalid callback');
  }
});

router.post('/kf/callback', express.text({ type: ['text/xml', 'application/xml', 'text/plain', '*/*'], limit: '2mb' }), (req, res) => {
  const settings = getWecomSettings();
  const signature = getQueryValue(req.query.msg_signature);
  const timestamp = getQueryValue(req.query.timestamp);
  const nonce = getQueryValue(req.query.nonce);

  if (!settings.enabled || !settings.token || !settings.encodingAesKey) {
    res.status(403).send('WeCom channel is not configured');
    return;
  }

  try {
    const encrypted = parseXml(String(req.body)).Encrypt;
    if (!encrypted) {
      throw new Error('Missing Encrypt field');
    }

    const decrypted = decryptVerifiedXml({
      token: settings.token,
      encodingAesKey: settings.encodingAesKey,
      signature,
      timestamp,
      nonce,
      encrypted
    });
    const event = parseXml(decrypted.message);

    res.send('success');

    if (event.Event === 'kf_msg_or_event' && event.Token) {
      processWecomKfEvent({
        token: event.Token,
        openKfid: event.OpenKfId || settings.openKfid
      }).catch((error) => {
        console.error('WeCom KF event processing failed:', error);
      });
    }
  } catch (error) {
    res.status(403).send(error instanceof Error ? error.message : 'Invalid callback');
  }
});

export default router;
