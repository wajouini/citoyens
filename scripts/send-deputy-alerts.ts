/**
 * send-deputy-alerts.ts — Send "Votre député·e a voté X" alerts
 *
 * Checks recent votes and sends personalized alerts to subscribers
 * who follow specific deputies.
 *
 * Usage: npx tsx scripts/send-deputy-alerts.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { Resend } from 'resend';

interface Subscriber {
  email: string;
  rubriques: string[];
  frequency: 'daily' | 'weekly';
  depute: string | null;
  created_at: string;
  resend_contact_id?: string;
}

interface Vote {
  id: string;
  date: string;
  titre: string;
  description?: string;
  resultat?: string;
  url?: string;
  positions?: Record<string, {
    nom: string;
    groupe: string;
    vote: string;
  }>;
}

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

function buildAlertHtml(deputeName: string, vote: Vote, position: string): string {
  const dateFormatted = new Date(vote.date + 'T00:00:00').toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const positionColor = position === 'pour' ? '#18753C' : position === 'contre' ? '#C9191E' : '#D4760A';
  const positionLabel = position.charAt(0).toUpperCase() + position.slice(1);

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F5F0;font-family:-apple-system,sans-serif;color:#1A1A1A;">
<div style="max-width:600px;margin:0 auto;padding:20px;">

<div style="text-align:center;padding:16px 0;border-bottom:3px solid #1A1A1A;">
  <a href="https://citoyens.ai" style="text-decoration:none;color:#1A1A1A;font-size:24px;font-weight:900;font-family:Georgia,serif;">citoyens<span style="color:#000091;background:#E8EDFF;padding:2px 6px;border-radius:4px;font-size:12px;font-family:monospace;">.ai</span></a>
  <div style="font-family:monospace;font-size:10px;color:#9A9A9A;margin-top:6px;text-transform:uppercase;letter-spacing:2px;">Alerte député·e</div>
</div>

<div style="padding:24px 0;">
  <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:900;margin:0 0 8px;line-height:1.2;">
    ${deputeName} a voté
    <span style="color:${positionColor};">${positionLabel}</span>
  </h1>
  <h2 style="font-size:18px;font-weight:600;color:#000091;margin:0 0 16px;line-height:1.3;">${vote.titre}</h2>
  ${vote.description ? `<p style="font-size:14px;color:#4A4A4A;line-height:1.5;margin:0 0 16px;">${vote.description}</p>` : ''}
  <div style="font-family:monospace;font-size:12px;color:#9A9A9A;margin-bottom:16px;">${dateFormatted}</div>
  ${vote.url ? `<a href="${vote.url}" style="display:inline-block;background:#000091;color:#fff;font-weight:bold;font-size:14px;text-decoration:none;padding:10px 20px;border-radius:8px;">Voir le scrutin</a>` : ''}
</div>

<div style="border-top:1px solid #E8E4DD;padding:16px 0;font-size:12px;color:#9A9A9A;text-align:center;">
  <a href="https://citoyens.ai" style="color:#000091;text-decoration:none;">citoyens.ai</a> — Alerte automatique
</div>

</div></body></html>`;
}

async function main() {
  loadEnv();

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('⚠ RESEND_API_KEY not set — skipping deputy alerts');
    process.exit(0);
  }

  const from = process.env.NEWSLETTER_FROM || 'Citoyens.ai <alerte@citoyens.ai>';

  let subscribers: Subscriber[];
  try {
    subscribers = JSON.parse(readFileSync(new URL('../src/data/.pipeline/subscribers.json', import.meta.url), 'utf-8'));
  } catch {
    console.log('⚠ No subscribers file — skipping');
    process.exit(0);
  }

  const deputeSubscribers = subscribers.filter(s => s.depute);
  if (deputeSubscribers.length === 0) {
    console.log('No deputy subscribers — skipping');
    process.exit(0);
  }

  let votes: Vote[];
  try {
    votes = JSON.parse(readFileSync(new URL('../src/data/votes.json', import.meta.url), 'utf-8'));
  } catch {
    console.log('⚠ No votes data — skipping');
    process.exit(0);
  }

  const today = new Date().toISOString().split('T')[0];
  const recentVotes = votes.filter(v => v.date === today);

  if (recentVotes.length === 0) {
    console.log(`No votes for ${today} — skipping`);
    process.exit(0);
  }

  console.log(`Found ${recentVotes.length} votes for today, ${deputeSubscribers.length} deputy subscribers`);

  const resend = new Resend(apiKey);
  let sent = 0;

  for (const sub of deputeSubscribers) {
    const deputeName = sub.depute!;
    const normalizedName = deputeName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    for (const vote of recentVotes) {
      if (!vote.positions) continue;

      const matchingPosition = Object.values(vote.positions).find(p => {
        const pName = p.nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return pName.includes(normalizedName) || normalizedName.includes(pName);
      });

      if (!matchingPosition) continue;

      try {
        await resend.emails.send({
          from,
          to: sub.email,
          subject: `${matchingPosition.nom} a voté ${matchingPosition.vote} — ${vote.titre}`,
          html: buildAlertHtml(matchingPosition.nom, vote, matchingPosition.vote),
        });
        sent++;
        console.log(`  ✓ Sent to ${sub.email}: ${matchingPosition.nom} voted ${matchingPosition.vote}`);
      } catch (err) {
        console.error(`  ✗ Failed to send to ${sub.email}:`, err);
      }
    }
  }

  console.log(`\n✓ Sent ${sent} deputy alerts`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Deputy alerts failed:', err);
  process.exit(1);
});
