import { crc32, crc32Token } from '#lib/codec/crc32';
import { bytesToBase64Url } from '#lib/codec/base64';
import { inflateBytes } from '#lib/codec/payload';
import {
	BAND_MAGIC_1,
	BAND_MAGIC_2,
	BAND_VERSION,
	BAND_MODE_DEFLATED,
	BAND_MODE_JSON,
	BAND_COPIES,
	BAND_EDGES
} from './band';

/**
 * Reading the data band back out of a picture, no QR machinery involved.
 *
 * The band is a dense rectangle of black/white modules near the bottom of the
 * page, wrapped in a solid black ring, with alternating timing rows just
 * inside the ring. A chat app may have resized the picture and re-encoded it
 * as JPEG, so the reader:
 *
 *   1. finds the dark band by row/column dark-fraction from the bottom up —
 *      the ring gives the bounding box to the pixel;
 *   2. sweeps candidate column counts, deriving the module size from the box
 *      width, and keeps only candidates whose timing rows match;
 *   3. samples every stream module as a small box mean, splits light from
 *      dark with Otsu's threshold, and reads the stored copies of the frame;
 *      damage usually lands in one copy's region only, so the reader tries
 *      each copy's reading against the CRC-32 before giving up;
 *   4. rebuilds the payload string the rest of the app expects: version 2
 *      frames carry the compressed bytes (inflated here), version 1 frames
 *      carry the payload text itself.
 *
 * If nothing verifies at native size, the band region is upscaled 2× and the
 * sweep runs again, which rescues small modules from heavy resizing.
 */

export interface BandScanResult {
	payload?: string;
	log: string[];
	error?: string;
	modulePixels?: number;
}

interface Region {
	x: number;
	y: number;
	w: number;
	h: number;
}

const DARK_PIXEL = 110;
const MIN_DARK_FRACTION = 0.06;

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
			reject(new Error('the image could not be loaded'));
		};
		image.src = url;
	});
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('Canvas 2D is unavailable in this browser');
	return ctx;
}

function grayOf(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number
): { gray: Float32Array; width: number; height: number } {
	w = Math.max(1, Math.floor(w));
	h = Math.max(1, Math.floor(h));
	x = Math.max(0, Math.min(x, ctx.canvas.width - 1));
	y = Math.max(0, Math.min(y, ctx.canvas.height - 1));
	const data = ctx.getImageData(x, y, w, h).data;
	const gray = new Float32Array(w * h);
	for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
		gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
	}
	return { gray, width: w, height: h };
}

function rowDarkFractions(gray: Float32Array, width: number, height: number): Float32Array {
	const fractions = new Float32Array(height);
	for (let y = 0; y < height; y++) {
		let dark = 0;
		const row = y * width;
		for (let x = 0; x < width; x++) if (gray[row + x] < DARK_PIXEL) dark++;
		fractions[y] = dark / width;
	}
	return fractions;
}

/** Find the band: the bottom-most run of rows that hold many dark pixels. */
function locateBand(gray: Float32Array, width: number, height: number): Region | null {
	const searchTop = Math.floor(height * 0.25);
	const rows = rowDarkFractions(gray, width, height);
	let bandBottom = -1;
	for (let y = height - 1; y >= searchTop; y--) {
		if (rows[y] >= MIN_DARK_FRACTION) {
			bandBottom = y;
			break;
		}
	}
	if (bandBottom < 0) return null;

	// The bottom ring and timing row form one solid-ish run about two modules
	// thick. Inside the band, dot rows never leave more than a thin seam, so a
	// fraction of that run is plenty to step over anti-aliasing — and it keeps
	// the walk from climbing out of the band over the table's black rule above
	// it, which would poison the box with the table itself.
	let ringTop = bandBottom;
	while (ringTop > searchTop && rows[ringTop - 1] >= MIN_DARK_FRACTION) ringTop--;
	const gapBudget = Math.max(8, Math.round((bandBottom - ringTop + 1) * 0.6));

	let bandTop = bandBottom;
	let gap = 0;
	for (let y = bandBottom; y >= searchTop; y--) {
		if (rows[y] >= MIN_DARK_FRACTION) {
			bandTop = y;
			gap = 0;
		} else {
			gap++;
			if (gap > gapBudget) break;
		}
	}
	if (bandBottom - bandTop < 12) return null;

	const rowsSpan = bandBottom - bandTop + 1;
	let left = -1;
	let right = -1;
	for (let x = 0; x < width; x++) {
		let dark = 0;
		for (let y = bandTop; y <= bandBottom; y++) if (gray[y * width + x] < DARK_PIXEL) dark++;
		if (dark / rowsSpan >= MIN_DARK_FRACTION) {
			if (left < 0) left = x;
			right = x;
		}
	}
	if (left < 0 || right - left < 32) return null;

	return { x: left, y: bandTop, w: right - left + 1, h: bandBottom - bandTop + 1 };
}

interface Sampled {
	/** Value per stream bit, row-major over the stream area. */
	values: Float32Array;
}

/**
 * Sample the stream area of a candidate grid. Positions are exact — the module
 * size is derived from the box width — so a candidate is either right or
 * clearly wrong.
 */
function sampleStream(
	gray: Float32Array,
	width: number,
	height: number,
	box: Region,
	cols: number,
	rows: number
): Sampled {
	const moduleSize = box.w / (cols + BAND_EDGES);
	const values = new Float32Array((rows - BAND_EDGES * 2) * cols);
	const radius = Math.max(1, Math.round(moduleSize * 0.3));
	let index = 0;
	for (let row = 2; row <= rows - 3; row++) {
		const cy = Math.round((row + 0.5) * moduleSize);
		for (let col = 1; col <= cols; col++) {
			const cx = Math.round((col + 0.5) * moduleSize);
			let sum = 0;
			let count = 0;
			for (let dy = -radius; dy <= radius; dy++) {
				const yy = cy + dy;
				if (yy < 0 || yy >= height) continue;
				const rowBase = yy * width;
				for (let dx = -radius; dx <= radius; dx++) {
					const xx = cx + dx;
					if (xx < 0 || xx >= width) continue;
					sum += gray[rowBase + xx];
					count++;
				}
			}
			values[index++] = count ? sum / count : 255;
		}
	}
	return { values };
}

/** Check the timing row just inside the ring. */
function timingMatches(
	gray: Float32Array,
	width: number,
	height: number,
	box: Region,
	cols: number,
	moduleSize: number,
	row: number
): boolean {
	const radius = Math.max(1, Math.round(moduleSize * 0.3));
	let mismatches = 0;
	const total = cols;
	for (let col = 1; col <= cols; col++) {
		const cx = Math.round((col + 0.5) * moduleSize);
		const cy = Math.round((row + 0.5) * moduleSize);
		let sum = 0;
		let count = 0;
		for (let dy = -radius; dy <= radius; dy++) {
			const yy = cy + dy;
			if (yy < 0 || yy >= height) continue;
			for (let dx = -radius; dx <= radius; dx++) {
				const xx = cx + dx;
				if (xx < 0 || xx >= width) continue;
				sum += gray[yy * width + xx];
				count++;
			}
		}
		const dark = (count ? sum / count : 255) < DARK_PIXEL;
		// Timing rows alternate starting white at the first stream column.
		if (dark !== ((col & 1) === 0)) mismatches++;
	}
	return mismatches <= Math.max(2, total * 0.1);
}

/** Otsu's threshold over the sampled module values. */
function otsu(values: Float32Array): number {
	const histogram = new Float64Array(256);
	for (let i = 0; i < values.length; i++) {
		histogram[Math.min(255, Math.max(0, Math.round(values[i])))]++;
	}
	const total = values.length;
	let sumAll = 0;
	for (let i = 0; i < 256; i++) sumAll += i * histogram[i];
	let weightBackground = 0;
	let sumBackground = 0;
	let best = -Infinity;
	let threshold = 127;
	for (let i = 0; i < 256; i++) {
		weightBackground += histogram[i];
		if (!weightBackground) continue;
		const weightForeground = total - weightBackground;
		if (!weightForeground) break;
		sumBackground += i * histogram[i];
		const meanBackground = sumBackground / weightBackground;
		const meanForeground = (sumAll - sumBackground) / weightForeground;
		const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
		if (between > best) {
			best = between;
			threshold = i;
		}
	}
	return threshold;
}

interface VoteOutcome {
	frame: Uint8Array;
	/** Bytes where the copies did not all agree. */
	contested: number;
}

/**
 * Read the stored copies of the frame byte by byte. Where the copies agree,
 * the value is taken; where they do not, `prefer` decides which copy wins —
 * the caller tries both and lets the CRC pick.
 */
function voteCopies(
	values: Float32Array,
	threshold: number,
	frameLength: number,
	prefer: 'a' | 'b'
): VoteOutcome {
	const bits = values.length;
	const frame = new Uint8Array(frameLength);
	let contested = 0;
	const read = (byteIndex: number): number => {
		const base = byteIndex * 8;
		if (base + 7 >= bits) return -1;
		let byte = 0;
		for (let bit = 0; bit < 8; bit++)
			byte = (byte << 1) | (values[base + bit] <= threshold ? 1 : 0);
		return byte;
	};
	for (let i = 0; i < frameLength; i++) {
		const a = read(i);
		const b = read(frameLength + i);
		const c = read(frameLength * 2 + i);
		let value: number;
		if (a >= 0 && a === b) value = a;
		else if (b >= 0 && b === c) value = b;
		else if (a >= 0 && a === c) value = a;
		else if (prefer === 'a' && a >= 0) value = a;
		else if (b >= 0) value = b;
		else value = Math.max(0, a);
		if (a !== b || (c >= 0 && (c !== a || c !== b))) contested++;
		frame[i] = value & 0xff;
	}
	return { frame, contested };
}

/**
 * Rebuild the payload from sampled stream values. Tries each copy's reading
 * in turn; the CRC decides which one is intact.
 */
export async function decodeSampled(
	values: Float32Array
): Promise<{ payload?: string; error?: string }> {
	const bits = values.length;
	if (bits < 24 * 12) return { error: 'too few modules to hold a frame' };
	const threshold = otsu(values);
	const readByte = (byteIndex: number): number => {
		const base = byteIndex * 8;
		let byte = 0;
		for (let bit = 0; bit < 8; bit++)
			byte = (byte << 1) | (values[base + bit] <= threshold ? 1 : 0);
		return byte;
	};

	if (readByte(0) !== BAND_MAGIC_1 || readByte(1) !== BAND_MAGIC_2) {
		return { error: 'frame magic mismatch' };
	}
	const version = readByte(2);
	if (version !== BAND_VERSION && version !== 1) return { error: 'unsupported band version' };

	const legacy = version === 1;
	const mode = legacy ? BAND_MODE_JSON : readByte(3);
	const dataLength = legacy ? (readByte(3) << 8) | readByte(4) : (readByte(4) << 8) | readByte(5);
	const dataAt = legacy ? 5 : 6;
	const frameLength = dataAt + dataLength + 4;
	const copies = legacy ? 3 : BAND_COPIES;
	if (dataLength < 1 || frameLength * copies * 8 > bits) {
		return { error: 'declared length does not fit the band' };
	}

	let lastError = 'checksum mismatch after voting';
	for (const prefer of ['a', 'b'] as const) {
		const { frame } = voteCopies(values, threshold, frameLength, prefer);
		const data = frame.subarray(dataAt, dataAt + dataLength);
		const crcAt = dataAt + dataLength;
		const stored =
			((frame[crcAt] << 24) |
				(frame[crcAt + 1] << 16) |
				(frame[crcAt + 2] << 8) |
				frame[crcAt + 3]) >>>
			0;
		if (crc32(data) !== stored) continue;
		try {
			if (legacy) return { payload: new TextDecoder().decode(data) };
			if (mode === BAND_MODE_DEFLATED) {
				const inflated = await inflateBytes(data);
				if (!inflated) {
					lastError = 'the band data could not be decompressed';
					continue;
				}
				const json = new TextDecoder().decode(inflated);
				return { payload: `z${bytesToBase64Url(data)}.${crc32Token(json)}` };
			}
			if (mode === BAND_MODE_JSON) {
				const json = new TextDecoder().decode(data);
				return { payload: `r${bytesToBase64Url(data)}.${crc32Token(json)}` };
			}
			lastError = 'unsupported band mode';
		} catch {
			lastError = 'payload was not valid UTF-8';
		}
	}
	return { error: lastError };
}

/**
 * Sweep candidate stream-column counts. For each candidate the module size is
 * the box width divided by the column count, so sampling is exact; the timing
 * rows prune wrong candidates before anything expensive happens.
 */
async function sweep(
	gray: Float32Array,
	width: number,
	height: number,
	box: Region,
	log: string[]
): Promise<{ payload?: string; modulePixels?: number }> {
	const minCols = 24;
	const maxCols = Math.floor(box.w / 2.6) - BAND_EDGES * 2;
	const candidates: number[] = [];
	for (let cols = maxCols; cols >= minCols; cols--) candidates.push(cols);

	for (const cols of candidates) {
		const moduleSize = box.w / (cols + BAND_EDGES);
		if (moduleSize < 2.4) continue;
		const drawnRows = Math.round(box.h / moduleSize);
		for (const rows of [drawnRows, drawnRows - 1, drawnRows + 1]) {
			if (rows < 8) continue;
			// The ring pins the box: rows must line up with the box height.
			if (Math.abs(rows * moduleSize - box.h) > moduleSize * 0.75) continue;
			if (!timingMatches(gray, width, height, box, cols, moduleSize, 1)) continue;
			if (!timingMatches(gray, width, height, box, cols, moduleSize, rows - 2)) continue;
			const sampled = sampleStream(gray, width, height, box, cols, rows);
			const outcome = await decodeSampled(sampled.values);
			if (outcome.payload) {
				log.push(`decoded · ${cols}×${rows} modules · ${moduleSize.toFixed(1)}px each`);
				return { payload: outcome.payload, modulePixels: moduleSize };
			}
			log.push(`candidate ${cols}×${rows}: ${outcome.error}`);
		}
	}
	return {};
}

export async function scanBand(blob: Blob): Promise<BandScanResult> {
	const log: string[] = [];
	const image = await loadImage(blob);
	const ctx = canvasContext(document.createElement('canvas'));
	ctx.canvas.width = image.naturalWidth;
	ctx.canvas.height = image.naturalHeight;
	ctx.drawImage(image, 0, 0);

	const full = grayOf(ctx, 0, 0, ctx.canvas.width, ctx.canvas.height);
	let box = locateBand(full.gray, full.width, full.height);
	if (!box) {
		log.push('no dark data band found near the bottom of the image');
		return { log, error: 'No data band found in this image' };
	}
	// No margin: at thumbnail scale one stray pixel is a third of a module,
	// and the sampling grid is derived from the box corners.
	log.push(`band box ${box.x},${box.y} · ${box.w}×${box.h}px`);

	// The sweep always works on a crop whose origin is the box corner.
	const cropped = grayOf(ctx, box.x, box.y, box.w, box.h);
	const native = await sweep(
		cropped.gray,
		cropped.width,
		cropped.height,
		{ x: 0, y: 0, w: cropped.width, h: cropped.height },
		log
	);
	if (native.payload) {
		return { payload: native.payload, modulePixels: native.modulePixels, log };
	}
	log.push('native-size sweep failed — retrying at 2× upscale');

	// Heavy chat-app resizing leaves thin modules; a 2× upscale restores them.
	const upscaleCanvas = document.createElement('canvas');
	upscaleCanvas.width = cropped.width * 2;
	upscaleCanvas.height = cropped.height * 2;
	const upscaleCtx = canvasContext(upscaleCanvas);
	upscaleCtx.imageSmoothingEnabled = true;
	upscaleCtx.imageSmoothingQuality = 'high';
	upscaleCtx.drawImage(
		ctx.canvas,
		box.x,
		box.y,
		box.w,
		box.h,
		0,
		0,
		upscaleCanvas.width,
		upscaleCanvas.height
	);
	const upscaled = grayOf(upscaleCtx, 0, 0, upscaleCanvas.width, upscaleCanvas.height);
	const retry = await sweep(
		upscaled.gray,
		upscaled.width,
		upscaled.height,
		{ x: 0, y: 0, w: upscaled.width, h: upscaled.height },
		log
	);
	if (retry.payload) {
		log.push('decoded from the upscaled region');
		return { payload: retry.payload, modulePixels: (retry.modulePixels ?? 0) / 2, log };
	}

	return { log, error: 'The data band is present but too damaged to read' };
}
