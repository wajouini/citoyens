import { chromium } from 'playwright';

const PAGES = [
  { name: 'dashboard', url: 'http://localhost:3000/', wait: 1000 },
  { name: 'sources', url: 'http://localhost:3000/sources', wait: 1000 },
  { name: 'runs', url: 'http://localhost:3000/runs', wait: 1000 },
  { name: 'edition', url: 'http://localhost:3000/edition', wait: 1000 },
  { name: 'settings', url: 'http://localhost:3000/settings', wait: 1000 },
];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  for (const p of PAGES) {
    await page.goto(p.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(p.wait);
    await page.screenshot({ path: `/tmp/admin-${p.name}.png`, fullPage: true });
    console.log(`✓ ${p.name} — ${p.url}`);
  }

  // Mobile test
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/admin-mobile-dashboard.png', fullPage: true });
  console.log('✓ mobile-dashboard — 375px width');

  await browser.close();
  console.log('\nAll screenshots saved to /tmp/admin-*.png');
})();
