import { crc32 } from '#lib/codec/crc32';

/**
 * The data band: a plain dot matrix, no QR.
 *
 * The routine payload is framed, stored BAND_COPIES times, and drawn as a
 * strip of OMR-style dots (solid black ring, dots inside) that spans the
 * printed table exactly and lives inside its outer border, as the routine's
 * own footer section. The frame carries a magic pair, a version, a mode, the
 * data length and a CRC-32; every byte of the frame is repeated, back to
 * back, so a reader can vote the routine back out of an image a chat app has
 * resized and re-compressed — damage usually lands in one copy's region only,
 * and the vote plus the CRC absorb it.
 *
 * The frame data is the compressed payload itself (deflate-raw bytes), not
 * the printable payload text — the band pays no base64 tax. Version 1 images
 * (framed payload text) still read; the reader branches on the version.
 *
 * Geometry, in modules:
 *
 *   ┌──────────────────────────┐
 *   │ solid black ring (1 mod) │
 *   │ timing row  1·0·1·0 ···1 │  alignment check for the reader
 *   │ stream bits, row-major   │
 *   │ timing row  1·0·1·0 ···1 │
 *   │ solid black ring (1 mod) │
 *   └──────────────────────────┘
 *
 * The ring pins the bounding box precisely; the timing rows pin the module
 * size. Frame layout, version 2 (big-endian):
 *
 *   'U' 'E'  2  mode  len-hi  len-lo  data…  crc32(data)
 *
 * mode 1 = data is deflate-raw of the payload JSON, mode 0 = raw JSON bytes.
 */

export const BAND_MAGIC_1 = 0x55;
export const BAND_MAGIC_2 = 0x45;
export const BAND_VERSION = 2;
/** Frame data modes for version 2+. */
export const BAND_MODE_JSON = 0;
export const BAND_MODE_DEFLATED = 1;
/** Copies of the frame inside the band. Three, not two: the vote needs a
 * majority that survives even when two readers disagree pair-wise. */
export const BAND_COPIES = 3;
/** Non-stream module rows: ring, timing — counted at top and bottom. */
export const BAND_EDGES = 2;

export interface BandPlan {
	/** Stream modules across. */
	cols: number;
	/** Total module rows: ring, timing, stream, timing, ring. */
	rows: number;
	/** Layout pixels per module. */
	moduleSize: number;
	/** Total band width in layout pixels. */
	width: number;
	/** Total band height in layout pixels. */
	height: number;
}

export interface BandPlanOptions {
	/** Framed band data as produced by `frameBytes`. */
	frame: Uint8Array;
	/** The strip spans this width exactly — the printed table's own width. */
	width: number;
	/** Desired module size; `0` or absent picks the smallest sane size. */
	moduleSize?: number;
}

/** Frame the band data: magic, version, mode, length, data, CRC. */
export function frameBytes(data: Uint8Array, deflated: boolean): Uint8Array {
	if (data.length > 0xffff) throw new Error('The routine payload is too large for the data band');
	const frame = new Uint8Array(10 + data.length);
	frame[0] = BAND_MAGIC_1;
	frame[1] = BAND_MAGIC_2;
	frame[2] = BAND_VERSION;
	frame[3] = deflated ? BAND_MODE_DEFLATED : BAND_MODE_JSON;
	frame[4] = (data.length >> 8) & 0xff;
	frame[5] = data.length & 0xff;
	frame.set(data, 6);
	new DataView(frame.buffer).setUint32(6 + data.length, crc32(data) >>> 0);
	return frame;
}

/** The back-to-back copies the band stores. */
export function interleaveCopies(frame: Uint8Array): Uint8Array {
	const stream = new Uint8Array(frame.length * BAND_COPIES);
	for (let copy = 0; copy < BAND_COPIES; copy++) {
		stream.set(frame, copy * frame.length);
	}
	return stream;
}

/** Total module rows: ring, timing, stream, timing, ring. */
function totalRows(bits: number, cols: number): number {
	return BAND_EDGES * 2 + Math.ceil(bits / cols);
}

/**
 * The module size must divide the strip width exactly: the ring then lands
 * flush on the table's border columns, so inside the printed frame the
 * reader's bounding box and the drawn box are the same rectangle and the
 * sampling grid cannot drift. The table width is `112 + periods × 84`, a
 * multiple of 7 for every period count, so 7 is always available.
 */
function flushModule(width: number, desired: number): number {
	let best = 0;
	for (let size = 6; size <= 16; size++) {
		if (width % size !== 0) continue;
		if (!best || Math.abs(size - desired) < Math.abs(best - desired)) best = size;
	}
	// ponytail: only reachable for widths outside 112 + periods·84; the ring
	// still carries the box, the module pitch just stops being exact.
	return best || Math.floor(width / 180);
}

/**
 * Plan the strip: pick the module size that divides the width exactly
 * (nearest to the desired value — auto asks for 6 and lands on 7), then pack
 * the framed bytes row-major, ring and timing rows included.
 */
export function planBand(options: BandPlanOptions): BandPlan {
	const bits = interleaveCopies(options.frame).length * 8;
	const moduleSize = flushModule(
		options.width,
		options.moduleSize && options.moduleSize > 0 ? options.moduleSize : 6
	);
	const cols = Math.max(32, Math.floor(options.width / moduleSize) - BAND_EDGES);
	const rows = totalRows(bits, cols);
	return { cols, rows, moduleSize, width: options.width, height: rows * moduleSize };
}

export interface DrawBandOptions {
	x: number;
	y: number;
	ink?: string;
	paper?: string;
}

/**
 * Draw the planned band: ring, timing rows and the stream. `cols` counts
 * stream modules; the ring adds one module on every side of the rectangle.
 * Dark modules are filled black bubbles, light ones empty outlines in light
 * grey — the reader samples module centres, so a filled core carries a 1 and
 * an empty white core a 0, and the strip reads like an OMR answer sheet
 * instead of a QR block. The grey is above every reader threshold: it is
 * decoration, not ink, and never confuses sampling.
 */
export function drawBand(
	ctx: CanvasRenderingContext2D,
	plan: BandPlan,
	frame: Uint8Array,
	options: DrawBandOptions
): void {
	const ink = options.ink ?? '#14161a';
	const paper = options.paper ?? '#ffffff';
	const m = plan.moduleSize;
	const x0 = options.x;
	const y0 = options.y;
	const stream = interleaveCopies(frame);
	const bits = stream.length * 8;
	const totalCols = plan.cols + BAND_EDGES; // ring on both sides
	const totalRows = plan.rows;
	const streamRowSpan = totalRows - BAND_EDGES * 2;

	const dark = (row: number, col: number): boolean => {
		if (row === 0 || row === totalRows - 1 || col === 0 || col === totalCols - 1) return true;
		const inner = row - 2;
		if (inner < 0 || inner >= streamRowSpan) return (col & 1) === 0; // timing rows
		const bit = inner * plan.cols + (col - 1);
		// Padding beyond the stream carries the timing phase: readers never
		// sample it, and it stops the last row from turning into a full white
		// stripe that the locator could mistake for the gap outside the band.
		if (bit >= bits) return (col & 1) === 0;
		return ((stream[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
	};

	ctx.fillStyle = paper;
	ctx.fillRect(x0, y0, plan.width, plan.height);
	ctx.fillStyle = ink;
	ctx.strokeStyle = '#8a8a8a';
	ctx.lineWidth = Math.max(1, m * 0.07);
	const filled = m * 0.44;
	const bubble = m * 0.38;
	for (let row = 0; row < totalRows; row++) {
		for (let col = 0; col < totalCols; col++) {
			if (row === 0 || row === totalRows - 1 || col === 0 || col === totalCols - 1) {
				ctx.fillRect(x0 + col * m, y0 + row * m, m, m); // ring
				continue;
			}
			const cx = x0 + (col + 0.5) * m;
			const cy = y0 + (row + 0.5) * m;
			ctx.beginPath();
			if (dark(row, col)) {
				ctx.arc(cx, cy, filled, 0, Math.PI * 2);
				ctx.fill();
			} else {
				ctx.arc(cx, cy, bubble, 0, Math.PI * 2);
				ctx.stroke();
			}
		}
	}
}
