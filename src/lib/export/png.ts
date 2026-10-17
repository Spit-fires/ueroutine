import { encodeRoutine } from '#lib/codec/payload';
import { frameBytes, planBand, type BandPlan } from '#lib/band/band';
import { ROUTINE_KEYWORD, injectTextChunk } from '#lib/png/text';
import { ensureFonts, pageMetrics, renderDay, LAYOUT } from './render';
import type { Day, Workspace } from '#lib/model/types';

export interface ExportOptions {
	/** Text crispness multiplier. 2 is the default. */
	scale: number;
	/** Band module size in layout pixels. `0` tunes it automatically. */
	moduleSize: number;
	includeBand: boolean;
	embedText: boolean;
}

export const DEFAULT_EXPORT: ExportOptions = {
	scale: 2,
	moduleSize: 0,
	includeBand: true,
	embedText: true
};

export interface ExportReport {
	payloadBytes: number;
	payloadChars: number;
	compressed: boolean;
	bandCols: number;
	bandRows: number;
	moduleSize: number;
	bandHeight: number;
	imageWidth: number;
	imageHeight: number;
	/** Thickness of one module in the exported file. */
	pixelsPerModule: number;
	/** Thickness of one module if a chat app caps the longest side at 2048px. */
	pixelsPerModuleAfterCap: number;
	autoTuned: boolean;
	embeddedText: boolean;
	milliseconds: number;
}

export interface ExportResult {
	blob: Blob;
	filename: string;
	payload: string;
	canvas: HTMLCanvasElement;
	report: ExportReport;
}

export function exportFilename(day: Day, school = ''): string {
	const slug = school
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return `${slug ? `${slug}-` : ''}routine-${day.date}.png`;
}

export interface PreparedCanvas {
	canvas: HTMLCanvasElement;
	plan: BandPlan | null;
	payload: string;
	report: ExportReport;
}

/** Encode the payload, plan the band and draw the document. */
export async function prepareCanvas(
	day: Day,
	ws: Workspace,
	options: ExportOptions
): Promise<PreparedCanvas> {
	const started = performance.now();
	await ensureFonts();
	const encoded = await encodeRoutine(day, ws);

	const metrics = pageMetrics(ws, 0);
	const autoTuned = options.moduleSize <= 0;
	const bandFrame = options.includeBand
		? frameBytes(encoded.bandBytes, encoded.bandDeflated)
		: null;
	const plan = bandFrame
		? planBand({
				frame: bandFrame,
				width: metrics.tableWidth,
				moduleSize: autoTuned ? 0 : options.moduleSize
			})
		: null;

	const { canvas, meta } = renderDay(day, ws, {
		scale: options.scale,
		bandPlan: plan,
		bandFrame
	});

	const activeModuleSize = plan?.moduleSize ?? 0;
	const longest = Math.max(canvas.width, canvas.height);
	const cap = Math.min(1, 2048 / longest);
	const report: ExportReport = {
		payloadBytes: encoded.bytes,
		payloadChars: encoded.payload.length,
		compressed: encoded.compressed,
		bandCols: plan?.cols ?? 0,
		bandRows: plan?.rows ?? 0,
		moduleSize: activeModuleSize,
		bandHeight: plan?.height ?? 0,
		imageWidth: canvas.width,
		imageHeight: canvas.height,
		pixelsPerModule: activeModuleSize * options.scale,
		pixelsPerModuleAfterCap: activeModuleSize * options.scale * cap,
		autoTuned,
		embeddedText: options.embedText,
		milliseconds: Math.round(performance.now() - started)
	};

	return { canvas, plan, payload: encoded.payload, report };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('The browser could not encode the image'));
		}, type);
	});
}

export async function exportDayPng(
	day: Day,
	ws: Workspace,
	options: ExportOptions = DEFAULT_EXPORT
): Promise<ExportResult> {
	const prepared = await prepareCanvas(day, ws, options);
	let blob = await canvasToBlob(prepared.canvas);

	if (options.embedText) {
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const withText = injectTextChunk(bytes, ROUTINE_KEYWORD, prepared.payload);
		blob = new Blob([withText as BlobPart], { type: 'image/png' });
	}

	return {
		blob,
		filename: exportFilename(day, ws.school),
		payload: prepared.payload,
		canvas: prepared.canvas,
		report: prepared.report
	};
}

/* ------------------------------------------------------------- delivery -- */

export function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
	try {
		if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
		await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
		return true;
	} catch {
		return false;
	}
}

export async function shareImage(blob: Blob, filename: string, title: string): Promise<boolean> {
	try {
		const data = { files: [new File([blob], filename, { type: blob.type })], title };
		if (!navigator.canShare?.(data)) return false;
		await navigator.share(data);
		return true;
	} catch {
		return false;
	}
}

/** Print (or save as PDF) using the same pixels as the PNG export. */
export async function printImage(blob: Blob, title: string): Promise<void> {
	const url = URL.createObjectURL(blob);
	const frame = document.createElement('iframe');
	frame.style.position = 'fixed';
	frame.style.right = '0';
	frame.style.bottom = '0';
	frame.style.width = '0';
	frame.style.height = '0';
	frame.style.border = '0';
	frame.src = url;
	frame.setAttribute('title', title);
	document.body.appendChild(frame);
	await new Promise((resolve) => setTimeout(resolve, 350));
	frame.contentWindow?.focus();
	frame.contentWindow?.print();
	setTimeout(() => {
		frame.remove();
		URL.revokeObjectURL(url);
	}, 60000);
}
