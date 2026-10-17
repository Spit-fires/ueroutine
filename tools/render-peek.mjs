import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:5199';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(async () => {
	const store = await import('/src/lib/model/store.svelte.ts');
	const seed = await import('/src/lib/model/seed.ts');
	const entry = seed.workbookDaysSorted().find((day) => day.date === '2026-09-07');
	if (!entry) throw new Error('workbook day 2026-09-07 not found');
	store.desk.loadWorkbookDay(entry, 'new');
	store.desk.persist();
});
await page.waitForTimeout(400);

const dataUrl = await page.evaluate(async () => {
	const png = await import('/src/lib/export/png.ts');
	const store = await import('/src/lib/model/store.svelte.ts');
	const day = store.desk.currentDay;
	const ws = store.desk.workspace;
	const result = await png.exportDayPng(day, ws, { ...png.DEFAULT_EXPORT, includeBand: true });
	return result.canvas.toDataURL('image/png');
});

writeFileSync('C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\export-peek.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('saved');
await browser.close();
