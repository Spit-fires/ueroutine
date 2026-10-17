import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:5199';
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function shoot(viewport, name, isMobile = false) {
	const context = await browser.newContext({
		viewport,
		deviceScaleFactor: 1.5,
		isMobile,
		hasTouch: isMobile
	});
	const page = await context.newPage();
	await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });
	await page.evaluate(async () => {
		const store = await import('/src/lib/model/store.svelte.ts');
		const seed = await import('/src/lib/model/seed.ts');
		const entry = seed.workbookDaysSorted().find((day) => day.date === '2026-09-07');
		if (!entry) throw new Error('workbook day 2026-09-07 not found');
		store.desk.loadWorkbookDay(entry, 'new');
		store.desk.persist();
	});
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${OUT}\\desk-${name}.png`, fullPage: false });
	await context.close();
	console.log(`saved desk-${name}.png`);
}

await shoot({ width: 1400, height: 900 }, 'desktop');
await shoot({ width: 390, height: 844 }, 'mobile', true);

await browser.close();
