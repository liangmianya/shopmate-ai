import crypto from 'node:crypto';

export function parseXml(xml: string) {
  const result: Record<string, string> = {};
  const pattern = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(xml))) {
    result[match[1]] = (match[2] ?? match[3] ?? '').trim();
  }

  return result;
}

export function verifySignature(token: string, timestamp: string, nonce: string, encrypted: string, signature: string) {
  const signed = [token, timestamp, nonce, encrypted].sort().join('');
  const digest = crypto.createHash('sha1').update(signed).digest('hex');
  return digest === signature;
}

function getAesKey(encodingAesKey: string) {
  return Buffer.from(`${encodingAesKey}=`, 'base64');
}

export function decryptWecomPayload(encodingAesKey: string, encrypted: string) {
  const aesKey = getAesKey(encodingAesKey);
  if (aesKey.length !== 32) {
    throw new Error('Invalid EncodingAESKey');
  }

  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(encrypted, 'base64'), decipher.final()]);
  const messageLength = decrypted.readUInt32BE(16);
  const message = decrypted.subarray(20, 20 + messageLength).toString('utf8');
  const receiveId = decrypted.subarray(20 + messageLength).toString('utf8');

  return { message, receiveId };
}

export function decryptVerifiedXml({
  token,
  encodingAesKey,
  signature,
  timestamp,
  nonce,
  encrypted
}: {
  token: string;
  encodingAesKey: string;
  signature: string;
  timestamp: string;
  nonce: string;
  encrypted: string;
}) {
  if (!verifySignature(token, timestamp, nonce, encrypted, signature)) {
    throw new Error('Invalid WeCom callback signature');
  }

  return decryptWecomPayload(encodingAesKey, encrypted);
}
