import keyModel, { type InstagramKey } from './instagram-key-schema.js';
import { sendMail } from './mailer.js';

const DAY = 24 * 60 * 60 * 1000;
let checking = false;
let alertSent = false;
let timer: ReturnType<typeof setInterval> | undefined;

export async function getInstagramKey(): Promise<InstagramKey | null> {
  const stored = await keyModel.findById('instagram').select('+accessToken');
  if (stored) return stored;
  const userId = process.env.META_IG_USER_ID;
  const accessToken = process.env.META_IG_ACCESS_TOKEN;
  if (!userId || !accessToken) return null;
  const seeded = await keyModel.findOneAndUpdate({ _id: 'instagram' }, {
    $setOnInsert: { userId, accessToken, issuedAt: new Date() },
  }, { upsert: true, returnDocument: 'after' }).select('+accessToken');
  if (!seeded) return null;
  return { userId: seeded.userId, accessToken: seeded.accessToken, issuedAt: seeded.issuedAt };
}

async function alertRenewalFailure(): Promise<void> {
  if (alertSent) return;
  alertSent = true;
  try {
    await sendMail({
      to: process.env.GMAIL_USER || '',
      subject: 'Instagram announce: key renewal failed',
      html: 'The Josh Sherman Instagram key could not be renewed. Check the Instagram app and key using the setup runbook.',
    });
  } catch { /* Same once-per-outage rule as the Facebook feed, even when mail fails. */ }
}

export async function checkInstagramKey(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const key = await getInstagramKey();
    if (!key || Date.now() - key.issuedAt.getTime() < 7 * DAY) return;
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', key.accessToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const result = await response.json() as { access_token?: string };
    if (!response.ok || typeof result.access_token !== 'string' || !result.access_token) {
      throw new Error('Instagram key renewal failed');
    }
    // A cleared or replaced key must never be resurrected by an in-flight renewal.
    const updated = await keyModel.updateOne({ _id: 'instagram', accessToken: key.accessToken }, {
      $set: { accessToken: result.access_token, issuedAt: new Date() },
    });
    if (!updated.matchedCount) throw new Error('Instagram key changed during renewal');
    alertSent = false;
  } catch {
    // Do not log fetch errors: they can contain the credential-bearing refresh URL.
    await alertRenewalFailure();
  } finally {
    checking = false;
  }
}

export function startInstagramRefresh(): void {
  if (process.env.NODE_ENV === 'test' || timer) return;
  void checkInstagramKey();
  timer = setInterval(() => { void checkInstagramKey(); }, DAY);
  timer.unref();
}

export function stopInstagramRefresh(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
