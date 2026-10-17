import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:5199';
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function probe(width, height, tag) {
	const context = await browser.newContext({ viewport: { width, height } });
	const page = await context.newPage();
	page.on('pageerror', (e) => console.log(`[${tag}] PAGEERROR:`, e.message));
	await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 });
	await page.waitForTimeout(700);

	await page.locator('button.cell').nth(3).click();
	await page.waitForTimeout(400);
	await page.evaluate(() => {
		const btns = [...document.querySelectorAll('aside.inspector button')];
		const split = btns.find((b) => b.textContent.includes('Split into two'));
		split?.click();
	});
	await page.waitForTimeout(200);
	await page.evaluate(() => {
		const btns = [...document.querySelectorAll('aside.inspector button')];
		const split = btns.find((b) => b.textContent.includes('Split into two'));
		split?.click();
	});
	await page.waitForTimeout(400);
	console.log(`[${tag}] second subject present:`, await page.getByLabel('Second subject').count());

	await page.evaluate(() => {
		document.activeElement?.blur();
		const input = document.querySelector('input[aria-label="Second subject"]');
		input?.focus();
	});
	await page.waitForTimeout(500);

	const geo = await page.evaluate(() => {
		const menu = document.querySelector('aside.inspector .menu');
		const actions = [...document.querySelectorAll('aside.inspector .actions button')];
		if (!menu) return { missing: true };
		const m = menu.getBoundingClientRect();
		const out = { menu: { top: Math.round(m.top), bottom: Math.round(m.bottom) }, buttons: [] };
		for (const b of actions) {
			const r = b.getBoundingClientRect();
			const overlap = m.bottom > r.top && m.top < r.bottom;
			let top = 'none';
			if (overlap) {
				const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
				top = el ? `${el.tagName}.${el.className}` : 'none';
			}
			out.buttons.push({
				name: b.textContent.trim(),
				top: Math.round(r.top),
				overlap,
				topElement: top
			});
		}
		return out;
	});
	console.log(`[${tag}]`, JSON.stringify(geo));
	await page.locator('aside.inspector').screenshot({ path: `${OUT}\\menu-${tag}.png` });
	await page.screenshot({ path: `${OUT}\\menu-full-${tag}.png` });
	await context.close();
}

await probe(1500, 900, 'wide');
await probe(1366, 768, 'laptop');
await probe(390, 844, 'phone');
await browser.close();
console.log('done');
