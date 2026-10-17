import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:5199';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Load the workbook's Sept 7 day through the real store, so the suite runs on real data.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(async () => {
	const store = await import('/src/lib/model/store.svelte.ts');
	const seed = await import('/src/lib/model/seed.ts');
	const entry = seed.workbookDaysSorted().find((day) => day.date === '2026-09-07');
	if (!entry) throw new Error('workbook day 2026-09-07 not found');
	store.desk.loadWorkbookDay(entry, 'new');
	store.desk.persist();
});
await page.waitForTimeout(300);

// Now the round-trip suite on that day.
await page.goto(`${BASE}/diagnostics?autorun&day=2026-09-07`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('pre', { timeout: 180000 });
console.log('===REPORT===');
console.log(await page.locator('pre').textContent());

await browser.close();
