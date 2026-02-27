/**
 * manage-subscribers.ts — Manage newsletter subscribers via Resend API
 *
 * Since Citoyens.ai is a static site, this script manages subscribers
 * by adding them to a Resend audience and storing preferences locally.
 *
 * Usage:
 *   npx tsx scripts/manage-subscribers.ts add --email user@example.com [--rubriques politique,tech] [--frequency daily|weekly] [--depute "Nom"]
 *   npx tsx scripts/manage-subscribers.ts list
 *   npx tsx scripts/manage-subscribers.ts remove --email user@example.com
 *
 * In production, this would be replaced by a proper API endpoint
 * (e.g., Vercel Functions or a separate backend).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Resend } from 'resend';

interface Subscriber {
  email: string;
  rubriques: string[];
  frequency: 'daily' | 'weekly';
  depute: string | null;
  created_at: string;
  resend_contact_id?: string;
}

const SUBSCRIBERS_PATH = new URL('../src/data/.pipeline/subscribers.json', import.meta.url);

function loadEnv() {
  const envPath = new URL('../.env', import.meta.url);
  try {
    if (!existsSync(envPath)) return;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch { /* ignore */ }
}

function loadSubscribers(): Subscriber[] {
  try {
    return JSON.parse(readFileSync(SUBSCRIBERS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveSubscribers(subs: Subscriber[]) {
  writeFileSync(SUBSCRIBERS_PATH, JSON.stringify(subs, null, 2), 'utf-8');
}

async function addSubscriber(email: string, rubriques: string[], frequency: string, depute: string | null) {
  loadEnv();

  const subscribers = loadSubscribers();

  if (subscribers.some(s => s.email === email)) {
    console.log(`⚠ ${email} is already subscribed`);
    return;
  }

  const subscriber: Subscriber = {
    email,
    rubriques: rubriques.length > 0 ? rubriques : [],
    frequency: frequency === 'weekly' ? 'weekly' : 'daily',
    depute: depute || null,
    created_at: new Date().toISOString(),
  };

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.NEWSLETTER_AUDIENCE_ID;

  if (apiKey && audienceId) {
    try {
      const resend = new Resend(apiKey);
      const { data, error } = await resend.contacts.create({
        audienceId,
        email,
        unsubscribed: false,
      });

      if (error) {
        console.error('⚠ Resend error:', error);
      } else {
        subscriber.resend_contact_id = data?.id;
        console.log(`✓ Added to Resend audience: ${data?.id}`);
      }
    } catch (err) {
      console.error('⚠ Resend API failed:', err);
    }
  }

  subscribers.push(subscriber);
  saveSubscribers(subscribers);
  console.log(`✓ Subscribed: ${email} (${subscriber.frequency}, rubriques: ${subscriber.rubriques.join(', ') || 'all'})`);
}

async function removeSubscriber(email: string) {
  loadEnv();

  const subscribers = loadSubscribers();
  const idx = subscribers.findIndex(s => s.email === email);

  if (idx === -1) {
    console.log(`⚠ ${email} not found`);
    return;
  }

  const sub = subscribers[idx];

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.NEWSLETTER_AUDIENCE_ID;

  if (apiKey && audienceId && sub.resend_contact_id) {
    try {
      const resend = new Resend(apiKey);
      await resend.contacts.remove({ audienceId, id: sub.resend_contact_id });
      console.log(`✓ Removed from Resend audience`);
    } catch (err) {
      console.error('⚠ Resend removal failed:', err);
    }
  }

  subscribers.splice(idx, 1);
  saveSubscribers(subscribers);
  console.log(`✓ Unsubscribed: ${email}`);
}

function listSubscribers() {
  const subscribers = loadSubscribers();
  console.log(`Total subscribers: ${subscribers.length}`);

  const byFreq = { daily: 0, weekly: 0 };
  const byRubrique: Record<string, number> = {};

  for (const s of subscribers) {
    byFreq[s.frequency]++;
    for (const r of s.rubriques) {
      byRubrique[r] = (byRubrique[r] || 0) + 1;
    }
  }

  console.log(`  Daily: ${byFreq.daily}, Weekly: ${byFreq.weekly}`);
  if (Object.keys(byRubrique).length > 0) {
    console.log(`  Rubriques: ${Object.entries(byRubrique).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }

  const withDepute = subscribers.filter(s => s.depute);
  if (withDepute.length > 0) {
    console.log(`  Following deputies: ${withDepute.length}`);
  }
}

const [action, ...args] = process.argv.slice(2);

switch (action) {
  case 'add': {
    const emailIdx = args.indexOf('--email');
    const email = emailIdx >= 0 ? args[emailIdx + 1] : '';
    const rubIdx = args.indexOf('--rubriques');
    const rubriques = rubIdx >= 0 ? args[rubIdx + 1].split(',') : [];
    const freqIdx = args.indexOf('--frequency');
    const frequency = freqIdx >= 0 ? args[freqIdx + 1] : 'daily';
    const depIdx = args.indexOf('--depute');
    const depute = depIdx >= 0 ? args[depIdx + 1] : null;

    if (!email) {
      console.error('Usage: manage-subscribers.ts add --email user@example.com');
      process.exit(1);
    }
    addSubscriber(email, rubriques, frequency, depute).catch(console.error);
    break;
  }
  case 'remove': {
    const emailIdx = args.indexOf('--email');
    const email = emailIdx >= 0 ? args[emailIdx + 1] : '';
    if (!email) {
      console.error('Usage: manage-subscribers.ts remove --email user@example.com');
      process.exit(1);
    }
    removeSubscriber(email).catch(console.error);
    break;
  }
  case 'list':
    listSubscribers();
    break;
  default:
    console.log('Usage: manage-subscribers.ts <add|remove|list> [options]');
}
