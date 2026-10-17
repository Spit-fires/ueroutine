import { DEFAULT_EXPORT, exportDayPng, type ExportOptions, type ExportReport } from '#lib/export/png';
import { importRoutineFromBlob, formatBytes } from '#lib/import/import';
import type { Day, Workspace } from '#lib/model/types';

/**
 * Round-trip harness.
 *
 * Proves the promise that matters: the PNG survives being sent through a chat
 * app. Each scenario re-encodes the exported image the way a messenger, a
 * screenshot tool or a photo pipeline would — downscale to a longest-side cap,
 * then JPEG — and imports it again. A scenario passes only when the recovered
 * payload is byte-identical to the one that was exported.
 */

export interface Scenario {
	name: string;
	/** Longest-side cap in pixels, or null for no resize. */
	maxWidth: number | null;
	/** JPEG quality, or null to keep PNG. */
	quality: number | null;
	/** Pass the exported bytes through untouched (no canvas round trip). */
	identity?: boolean;
	/** Add a slight blur on top of the resize, like a screen photo. */
	blur?: boolean;
	description: string;
	/** "required" scenarios must pass; "stress" ones are reported for interest. */
	expectation: 'required' | 'stress';
}

export const SCENARIOS: Scenario[] = [
	{
		name: 'untouched PNG',
		maxWidth: null,
		quality: null,
		identity: true,
		description: 'downloaded, mailed or carried on a USB stick',
		expectation: 'required'
	},
	{
		name: 're-encoded PNG',
		maxWidth: null,
		quality: null,
		description: 'screenshot tool or image editor saved it again, pixels only',
		expectation: 'required'
	},
	{
		name: 'chat app · max 2048',
		maxWidth: 2048,
		quality: 0.82,
		description: 'what Messenger/WhatsApp send for a full-size original',
		expectation: 'required'
	},
	{
		name: 'chat app · max 1600',
		maxWidth: 1600,
		quality: 0.75,
		description: 'a re-share of an already compressed copy',
		expectation: 'required'
	},
	{
		name: 'chat app · max 1024',
		maxWidth: 1024,
		quality: 0.6,
		description: 'small preview size with real compression',
		expectation: 'required'
	},
	{
		name: 'screenshot geometry · 1200 + blur',
		maxWidth: 1200,
		quality: 0.6,
		blur: true,
		description: 'resized and softened, like a phone screenshot of a screen',
		expectation: 'stress'
	},
	{
		name: 'thumbnails · max 768',
		maxWidth: 768,
		quality: 0.5,
		description: 'worst case: opened from a low-resolution thumbnail',
		expectation: 'stress'
	}
];

export interface ScenarioResult {
	scenario: Scenario;
	pass: boolean;
	source: string;
	decoder: string;
	modulePixels: number;
	bytes: number;
	milliseconds: number;
	pixelsPerModule: number;
	detail: string;
	log: string[];
}

export interface SuiteResult {
	results: ScenarioResult[];
	exportReport: ExportReport;
	payloadBytes: number;
	passed: number;
	total: number;
	requiredPassed: number;
	requiredTotal: number;
	report: string;
}

function loadImage(source: Blob): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(source);
		const image = new Image();
		image.onload = () => {
			URL.revokeObjectURL(url);
			resolve(image);
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('the exported image could not be loaded'));
		};
		image.src = url;
	});
}

/** Re-encode the image the way a messaging app would. */
export async function simulateMessenger(
	blob: Blob,
	scenario: Scenario
): Promise<{ blob: Blob; width: number; height: number; scale: number }> {
	const image = await loadImage(blob);
	const longest = Math.max(image.width, image.height);
	const factor = scenario.maxWidth ? Math.min(1, scenario.maxWidth / longest) : 1;
	const width = Math.max(1, Math.round(image.width * factor));
	const height = Math.max(1, Math.round(image.height * factor));

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D is unavailable');
	if (scenario.blur) ctx.filter = 'blur(0.7px)';
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'medium';
	ctx.drawImage(image, 0, 0, width, height);
	ctx.filter = 'none';

	const type = scenario.quality === null ? 'image/png' : 'image/jpeg';
	const quality = scenario.quality ?? undefined;
	const out = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob((result) => resolve(result), type, quality)
	);
	if (!out) throw new Error('the simulation could not encode the image');
	return { blob: out, width, height, scale: factor };
}

export async function runRoundTripSuite(
	day: Day,
	ws: Workspace,
	options: ExportOptions = DEFAULT_EXPORT
): Promise<SuiteResult> {
	const exported = await exportDayPng(day, ws, options);
	const results: ScenarioResult[] = [];

	for (const scenario of SCENARIOS) {
		const started = performance.now();
		let pixelsPerModule = exported.report.pixelsPerModule;
		let simulatedBytes = exported.blob.size;
		let imported;
		try {
			if (scenario.identity) {
				imported = await importRoutineFromBlob(exported.blob);
			} else {
				const simulated = await simulateMessenger(exported.blob, scenario);
				simulatedBytes = simulated.blob.size;
				pixelsPerModule = exported.report.pixelsPerModule * simulated.scale;
				imported = await importRoutineFromBlob(simulated.blob);
			}
		} catch (error) {
			results.push({
				scenario,
				pass: false,
				source: 'none',
				decoder: 'none',
				modulePixels: 0,
				bytes: simulatedBytes,
				milliseconds: Math.round(performance.now() - started),
				pixelsPerModule,
				detail: error instanceof Error ? error.message : 'the simulation failed',
				log: []
			});
			continue;
		}

		const pass =
			imported.payload !== undefined &&
			imported.payload === exported.payload &&
			imported.source !== 'none';

		results.push({
			scenario,
			pass,
			source: imported.source,
			decoder: imported.stats.decoder,
			modulePixels: imported.stats.modulePixels ?? 0,
			bytes: simulatedBytes,
			milliseconds: Math.round(performance.now() - started),
			pixelsPerModule,
			detail: pass
				? `${imported.source === 'png-text' ? 'metadata' : `${imported.stats.modulePixels?.toFixed(1) ?? '?'}px modules`} · ${formatBytes(simulatedBytes)} · ${imported.stats.durationMs} ms scan`
				: (imported.error ?? 'the recovered payload did not match'),
			log: imported.log
		});
	}

	const passed = results.filter((r) => r.pass).length;
	const required = results.filter((r) => r.scenario.expectation === 'required');
	const requiredPassed = required.filter((r) => r.pass).length;
	const report = [
		`Round-trip report · ${ws.school} · ${day.date}`,
		`payload ${formatBytes(exported.report.payloadBytes)} (${exported.report.payloadChars} chars, ${exported.report.compressed ? 'deflate-raw' : 'raw'})`,
		`image ${exported.report.imageWidth}×${exported.report.imageHeight}px · band ${exported.report.bandCols}×${exported.report.bandRows} modules · ${exported.report.moduleSize}px${exported.report.autoTuned ? ' (auto-tuned)' : ''}`,
		`${exported.report.pixelsPerModuleAfterCap.toFixed(1)}px per module after a 2048px cap`,
		'',
		...results.map(
			(r) =>
				`${r.pass ? 'PASS' : r.scenario.expectation === 'stress' ? 'BEST' : 'FAIL'}  ${r.scenario.name.padEnd(32, ' ')} ${r.source.padEnd(9)} ${r.modulePixels ? `${r.modulePixels.toFixed(1)}px modules` : '—'}  ${r.pixelsPerModule.toFixed(1)}px/module  ${r.milliseconds}ms  ${r.detail}`
		),
		'',
		`${passed}/${results.length} scenarios passed · ${requiredPassed}/${required.length} required scenarios passed`
	].join('\n');

	return {
		results,
		exportReport: exported.report,
		payloadBytes: exported.report.payloadBytes,
		passed,
		total: results.length,
		requiredPassed,
		requiredTotal: required.length,
		report
	};
}
