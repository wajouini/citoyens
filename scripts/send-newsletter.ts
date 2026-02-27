/**
 * send-newsletter.ts — Send the daily edition as a newsletter via Resend
 *
 * Reads the current une.json and sends it as a formatted HTML email
 * to the configured audience.
 *
 * Configuration via .env:
 *   RESEND_API_KEY=re_...
 *   NEWSLETTER_FROM=Citoyens.ai <edition@citoyens.ai>
 *   NEWSLETTER_AUDIENCE_ID=<resend audience id>
 *
 * Usage: npx tsx scripts/send-newsletter.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { Resend } from 'resend';

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

const rubriqueLabels: Record<string, string> = {
  politique: 'Politique',
  economie: 'Économie',
  tech: 'Tech',
  science: 'Science',
  societe: 'Société',
  culture: 'Culture',
  international: 'International',
};

const rubriqueColors: Record<string, string> = {
  politique: '#000091',
  economie: '#D4760A',
  tech: '#7e22ce',
  science: '#18753C',
  societe: '#C9191E',
  culture: '#b45309',
  international: '#0369a1',
};

function buildHtml(edition: any): string {
  const sujet = edition.sujet_du_jour;
  const essentiels = edition.essentiels || [];
  const regardCroise = edition.regard_croise;
  const chiffre = edition.chiffre_du_jour;
  const aSurveiller = edition.a_surveiller || [];

  const dateFormatted = new Date(edition.date + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  let html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F5F0;font-family:'Source Sans 3',-apple-system,BlinkMacSystemFont,sans-serif;color:#1A1A1A;">
<div style="max-width:600px;margin:0 auto;padding:20px;">

<!-- HEADER -->
<div style="text-align:center;padding:20px 0;border-bottom:3px solid #1A1A1A;">
  <a href="https://citoyens.ai" style="text-decoration:none;color:#1A1A1A;font-size:28px;font-weight:900;font-family:Georgia,serif;">citoyens<span style="color:#000091;background:#E8EDFF;padding:2px 6px;border-radius:4px;font-size:14px;font-family:monospace;">.ai</span></a>
  <div style="font-family:monospace;font-size:11px;color:#9A9A9A;margin-top:8px;letter-spacing:2px;text-transform:uppercase;">${dateFormatted}</div>
</div>

<!-- SUJET DU JOUR -->
<div style="padding:24px 0;border-bottom:1px solid #E8E4DD;">
  <div style="font-family:monospace;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#fff;background:#1A1A1A;display:inline-block;padding:2px 8px;border-radius:4px;">Sujet du jour</div>
  ${sujet?.rubrique ? `<span style="font-family:monospace;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:${rubriqueColors[sujet.rubrique] || '#000091'};background:#E8EDFF;display:inline-block;padding:2px 8px;border-radius:4px;margin-left:6px;">${rubriqueLabels[sujet.rubrique] || sujet.rubrique}</span>` : ''}
  <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:900;line-height:1.15;margin:12px 0 8px;">${sujet?.titre || ''}</h1>
  <p style="font-size:16px;font-weight:600;color:#000091;line-height:1.4;margin:0 0 12px;">${sujet?.pourquoi_important || ''}</p>`;

  if (sujet?.faits?.length) {
    html += '<ul style="padding-left:16px;margin:0 0 12px;">';
    for (const f of sujet.faits) {
      html += `<li style="font-size:15px;line-height:1.5;margin-bottom:4px;">${f}</li>`;
    }
    html += '</ul>';
  }

  if (sujet?.contexte) {
    html += `<p style="font-size:14px;color:#4A4A4A;line-height:1.6;margin:0 0 12px;">${sujet.contexte}</p>`;
  }

  if (sujet?.sources?.length) {
    html += '<div style="margin-top:8px;">';
    for (const src of sujet.sources) {
      html += `<a href="${src.url}" style="font-family:monospace;font-size:11px;color:#4A4A4A;text-decoration:none;border:1px solid #E8E4DD;border-radius:20px;padding:4px 10px;margin-right:4px;display:inline-block;">${src.nom} ↗</a>`;
    }
    html += '</div>';
  }

  html += '</div>';

  // ESSENTIELS
  if (essentiels.length > 0) {
    html += `<div style="padding:24px 0;border-bottom:1px solid #E8E4DD;">
    <div style="font-family:monospace;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;">Les essentiels</div>`;

    for (const item of essentiels) {
      const color = rubriqueColors[item.rubrique] || '#000091';
      const label = rubriqueLabels[item.rubrique] || item.rubrique;
      html += `<div style="padding:12px 0;border-bottom:1px solid #E8E4DD;">
        <span style="font-family:monospace;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:${color};background:#E8EDFF;display:inline-block;padding:2px 8px;border-radius:4px;">${label}</span>
        <h3 style="font-family:Georgia,serif;font-size:16px;font-weight:700;margin:8px 0 4px;line-height:1.3;">${item.titre}</h3>
        <p style="font-size:14px;color:#4A4A4A;margin:0;line-height:1.5;">${item.resume}</p>
      </div>`;
    }
    html += '</div>';
  }

  // REGARD CROISE
  if (regardCroise) {
    const verdict = regardCroise.ce_quil_faut_retenir || regardCroise.verdict_citoyens || '';
    html += `<div style="padding:24px 0;border-bottom:1px solid #E8E4DD;">
      <div style="font-family:monospace;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#C9191E;background:#FEF2F2;display:inline-block;padding:2px 8px;border-radius:4px;">Regard croisé</div>
      <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:900;margin:12px 0 8px;line-height:1.2;">${regardCroise.sujet}</h2>
      <p style="font-size:14px;color:#4A4A4A;line-height:1.5;margin:0 0 12px;">${regardCroise.contexte}</p>
      <div style="border:2px solid #1A1A1A;border-radius:12px;padding:16px;margin-bottom:12px;">
        <div style="font-family:monospace;font-size:9px;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">Ce qu'il faut retenir</div>
        <p style="font-size:15px;font-weight:500;margin:0;line-height:1.5;">${verdict}</p>
      </div>
      <p style="font-family:monospace;font-size:9px;color:#9A9A9A;margin:0;">Analyse générée par IA · <a href="https://citoyens.ai/methodologie" style="color:#000091;">Notre méthodologie</a></p>
    </div>`;
  }

  // CHIFFRE DU JOUR
  if (chiffre) {
    html += `<div style="padding:24px 0;border-bottom:1px solid #E8E4DD;">
      <div style="background:#1A1A1A;color:#fff;border-radius:12px;padding:20px;">
        <div style="font-family:monospace;font-size:9px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.5);margin-bottom:8px;">Le chiffre du jour</div>
        <div style="font-family:monospace;font-size:36px;font-weight:bold;line-height:1;">${chiffre.valeur}</div>
        <p style="font-size:14px;color:rgba(255,255,255,0.8);margin:8px 0 4px;line-height:1.4;">${chiffre.contexte}</p>
        <a href="${chiffre.source_url}" style="font-family:monospace;font-size:10px;color:rgba(255,255,255,0.4);text-decoration:none;">Source : ${chiffre.source} ↗</a>
      </div>
    </div>`;
  }

  // FOOTER
  html += `
<div style="text-align:center;padding:24px 0;font-family:monospace;font-size:11px;color:#9A9A9A;">
  <p style="margin:0 0 8px;">
    <a href="https://citoyens.ai" style="color:#000091;text-decoration:none;font-weight:bold;">citoyens.ai</a> — 5 minutes pour savoir, toutes les sources pour juger.
  </p>
  <p style="margin:0;">Initiative citoyenne indépendante · Zéro publicité · Code source ouvert</p>
</div>

</div></body></html>`;

  return html;
}

async function main() {
  loadEnv();

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('⚠ RESEND_API_KEY not set — skipping newsletter send');
    process.exit(0);
  }

  const from = process.env.NEWSLETTER_FROM || 'Citoyens.ai <edition@citoyens.ai>';
  const audienceId = process.env.NEWSLETTER_AUDIENCE_ID;

  // Read current edition
  const unePath = new URL('../src/data/une.json', import.meta.url);
  let edition: any;
  try {
    edition = JSON.parse(readFileSync(unePath, 'utf-8'));
  } catch {
    console.error('✗ une.json not found');
    process.exit(1);
  }

  const sujet = edition.sujet_du_jour;
  const dateStr = edition.date || new Date().toISOString().split('T')[0];
  const subject = sujet?.titre
    ? `${sujet.titre} — Citoyens.ai du ${new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
    : `Édition Citoyens.ai du ${dateStr}`;

  const html = buildHtml(edition);

  const resend = new Resend(apiKey);

  if (audienceId) {
    // Broadcast to audience
    console.log(`Sending broadcast to audience ${audienceId}...`);
    const { data, error } = await resend.broadcasts.create({
      audienceId,
      from,
      subject,
      html,
    });

    if (error) {
      console.error('✗ Broadcast creation failed:', error);
      process.exit(1);
    }

    console.log(`✓ Broadcast created: ${data?.id}`);

    // Send the broadcast
    if (data?.id) {
      const sendResult = await resend.broadcasts.send(data.id);
      if (sendResult.error) {
        console.error('✗ Broadcast send failed:', sendResult.error);
      } else {
        console.log(`✓ Broadcast sent successfully`);
      }
    }
  } else {
    console.log('⚠ NEWSLETTER_AUDIENCE_ID not set — cannot send broadcast');
    console.log('  To test, set NEWSLETTER_TEST_EMAIL in .env');

    const testEmail = process.env.NEWSLETTER_TEST_EMAIL;
    if (testEmail) {
      console.log(`Sending test email to ${testEmail}...`);
      const { error } = await resend.emails.send({
        from,
        to: testEmail,
        subject: `[TEST] ${subject}`,
        html,
      });

      if (error) {
        console.error('✗ Test send failed:', error);
        process.exit(1);
      }
      console.log(`✓ Test email sent to ${testEmail}`);
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Newsletter send failed:', err);
  process.exit(1);
});
