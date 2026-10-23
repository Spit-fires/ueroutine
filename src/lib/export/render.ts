import { drawBand, type BandPlan } from '#lib/band/band';
import { weekdayName, type Cell, type Day, type Entry, type Workspace } from '#lib/model/types';

/**
 * The exported document — a faithful skin of the original Excel sheet:
 * red serif school title on sage bands, light-blue corner block, navy day box,
 * red date box, navy header row (first period red), lavender/pink period
 * columns and black row rules.
 *
 * Drawn with Canvas 2D rather than by rasterising the DOM so the export is
 * identical wherever it runs, and so the data band can sit with exact pixel
 * control right under the table it belongs to.
 */

export interface RenderOptions {
	/** Multiplier for crisp text (2 renders the page at double size). */
	scale?: number;
	bandPlan?: BandPlan | null;
	/** The framed band data the strip should carry. */
	bandFrame?: Uint8Array | null;
	now?: Date;
}

export interface RenderMeta {
	width: number;
	height: number;
	scale: number;
	band: { blocks: number; moduleSize: number; rows: number; height: number } | null;
}

const C = {
	page: '#ffffff',
	sage: '#dce5c8',
	titleRed: '#e00000',
	titleBlue: '#2237a8',
	navy: '#1f4e79',
	red: '#e00000',
	morning: '#e9e3f1',
	afternoon: '#efc5be',
	ink: '#1a1a1a',
	teacher: '#454545',
	dash: '#8a8a8a',
	black: '#000000',
	markYellow: '#fce490',
	markRed: '#f4a79e',
	whiteInk: '#ffffff',
	whiteSoft: 'rgba(255,255,255,0.78)'
};

const F = {
	sans: '"Segoe UI", Calibri, "Helvetica Neue", Arial, sans-serif',
	serif: 'Cambria, Georgia, "Times New Roman", serif'
};

const TYPE_SCALE = 1.45;

const PAD = 22;
const TITLE_H = 56;
const TITLE_GAP = 6;
const TITLE_BLOCK = TITLE_H * 2 + TITLE_GAP;
const HEAD_ROW = 30;
const ROW_H = 50;
const CLASS_W = 64;
const SCL_W = 48;
const ROW_HEAD = CLASS_W + SCL_W;
const PERIOD_W = 84;
const BOX_W = PERIOD_W * 3;
const TAIL = 26;
const PAD_BOTTOM = 16;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const LAYOUT = {
	PAD,
	TITLE_BLOCK,
	HEAD_ROW,
	ROW_H,
	ROW_HEAD,
	PERIOD_W,
	TAIL,
	PAD_BOTTOM
} as const;

export interface PageMetrics {
	width: number;
	tableWidth: number;
	gridTop: number;
	gridHeight: number;
	/** Everything except the data band. */
	heightWithoutBand: number;
	height: number;
}

/**
 * Page geometry in layout units. Shared with the data-band tuner, which needs
 * to know how tall the page is before it can decide how thick to draw modules.
 */
export function pageMetrics(ws: Workspace, bandBlockHeight = 0): PageMetrics {
	const tableWidth = ROW_HEAD + ws.periods.length * PERIOD_W;
	const headerTop = PAD + 2 + TITLE_BLOCK + 8;
	const gridTop = headerTop + HEAD_ROW;
	const gridHeight = ws.classes.length * ROW_H;
	const heightWithoutBand = gridTop + gridHeight + TAIL + PAD_BOTTOM;
	return {
		width: PAD * 2 + tableWidth,
		tableWidth,
		gridTop,
		gridHeight,
		heightWithoutBand,
		height: heightWithoutBand + (bandBlockHeight ? bandBlockHeight : 0)
	};
}

/* ------------------------------------------------------------ text tools -- */

function fontOf(style: string, weight: string | number, size: number, family: string): string {
	return `${style ? `${style} ` : ''}${weight} ${size}px ${family}`.trim();
}

/** Shrink a label until it fits, then wrap it on "/" or spaces if it must. */
function fitLines(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	options: {
		size: number;
		minSize: number;
		weight?: string | number;
		family?: string;
		style?: string;
		maxLines?: number;
		maxHeight?: number;
	}
): { size: number; lines: string[]; style: string; weight: string | number; family: string } {
	const family = options.family ?? F.sans;
	const weight = options.weight ?? 700;
	const style = options.style ?? '';
	const maxLines = options.maxLines ?? 2;
	const maxHeight = options.maxHeight ?? Number.POSITIVE_INFINITY;
	let size = options.size;
	const measure = (value: string) => {
		ctx.font = fontOf(style, weight, size, family);
		return ctx.measureText(value).width;
	};
	const wrap = () => {
		if (measure(text) <= maxWidth) return [text];

		const tokens = text.includes('/')
			? text.split('/').map((part, index, all) => (index < all.length - 1 ? `${part}/` : part))
			: text.split(' ');
		const lines: string[] = [];
		let current = '';
		for (const token of tokens) {
			const candidate = current ? `${current}${text.includes('/') ? '' : ' '}${token}` : token;
			if (measure(candidate) > maxWidth && current) {
				lines.push(current);
				current = token;
			} else {
				current = candidate;
			}
		}
		if (current) lines.push(current);
		return lines;
	};

	let lines: string[] = [];
	let fits = false;
	while (true) {
		lines = wrap();
		const widthFits = lines.every((line) => measure(line) <= maxWidth);
		const heightFits = (lines.length - 1) * (size + 1.5) + size <= maxHeight;
		fits = widthFits && heightFits && lines.length <= maxLines;
		if (fits || size <= options.minSize) break;
		size -= 0.5;
	}

	if (!fits) {
		let value = text;
		while (value.length > 1 && measure(`${value}…`) > maxWidth) value = value.slice(0, -1);
		lines = [`${value}…`];
	}
	return { size, lines, style, weight, family };
}

interface EntryOptions {
	x: number;
	y: number;
	w: number;
	h: number;
	ink: string;
	subInk: string;
	dense?: boolean;
}

/** One entry: subject on top, italic teacher underneath. */
function drawEntry(ctx: CanvasRenderingContext2D, entry: Entry, options: EntryOptions) {
	const pad = 8;
	const maxWidth = options.w - pad * 2;
	const subject = entry.subject.trim();
	const teacher = entry.teacher.trim();
	if (!subject && !teacher) return;

	const centre = options.x + options.w / 2;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';

	if (subject) {
		ctx.fillStyle = options.ink;
		ctx.font = fontOf('', 700, (options.dense ? 11.5 : 13.5) * TYPE_SCALE, F.sans);
		const baseY = teacher ? options.y + options.h * 0.4 : options.y + options.h * 0.52;
		ctx.fillText(subject, centre, baseY, maxWidth);
	}

	if (teacher) {
		ctx.fillStyle = options.subInk;
		ctx.font = fontOf('italic', 400, (options.dense ? 10 : 11.5) * TYPE_SCALE, F.sans);
		ctx.fillText(teacher, centre, options.y + options.h * 0.72, maxWidth);
	}
	ctx.textAlign = 'left';
}

function centreLabel(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	maxWidth: number,
	size: number,
	fill: string,
	weight: string | number = 700,
	style = '',
	family = F.sans,
	maxHeight?: number
) {
	const fitted = fitLines(ctx, text, maxWidth, {
		size,
		minSize: size * 0.4,
		weight,
		style,
		family,
		maxLines: 1,
		maxHeight
	});
	ctx.fillStyle = fill;
	ctx.font = fontOf(fitted.style, fitted.weight, fitted.size, fitted.family);
	ctx.textAlign = 'center';
	ctx.fillText(fitted.lines[0], x, y);
	ctx.textAlign = 'left';
}

/* ---------------------------------------------------------------- layout -- */

function bandHeightFor(
	plan: BandPlan | null | undefined,
	frame: Uint8Array | null | undefined
): number {
	if (!plan || !plan.cols || !frame || !frame.length) return 0;
	// The bottom page margin below the strip matches the side margins.
	return plan.height + PAD - PAD_BOTTOM;
}

export function renderDay(
	day: Day,
	ws: Workspace,
	options: RenderOptions = {}
): { canvas: HTMLCanvasElement; meta: RenderMeta } {
	const scale = options.scale ?? 2;
	const plan = options.bandPlan ?? null;
	const columns = ws.periods.length;
	const rows = ws.classes.length;
	const bandBlock = bandHeightFor(plan, options.bandFrame);
	const metrics = pageMetrics(ws, bandBlock);
	const { width, height, tableWidth, gridTop } = metrics;
	const gridBottom = gridTop + rows * ROW_H;
	const headerTop = gridTop - HEAD_ROW;
	const titleTop = headerTop - 8 - TITLE_BLOCK;
	const boxLeft = PAD + tableWidth - BOX_W;
	const bandFrame = options.bandFrame ?? new Uint8Array();

	const canvas = document.createElement('canvas');
	canvas.width = Math.round(width * scale);
	canvas.height = Math.round(height * scale);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D is unavailable in this browser');
	ctx.scale(scale, scale);
	ctx.textBaseline = 'alphabetic';
	ctx.textAlign = 'left';

	/* ------------------------------------------------------------ title -- */

	ctx.fillStyle = C.page;
	ctx.fillRect(0, 0, width, height);

	const greenX = PAD;
	const greenW = boxLeft - 4 - greenX;
	ctx.fillStyle = C.sage;
	ctx.fillRect(greenX, titleTop, greenW, TITLE_H);
	ctx.fillRect(greenX, titleTop + TITLE_H + TITLE_GAP, greenW, TITLE_H);

	centreLabel(
		ctx,
		ws.school || 'Utsaho Educare',
		greenX + greenW / 2,
		titleTop + TITLE_H * 0.72,
		greenW - 24,
		40 * TYPE_SCALE,
		C.titleRed,
		700,
		'',
		F.serif,
		TITLE_H * 0.9
	);
	centreLabel(
		ctx,
		'Class Schedule',
		greenX + greenW / 2,
		titleTop + TITLE_H + TITLE_GAP + TITLE_H * 0.72,
		greenW - 24,
		38 * TYPE_SCALE,
		C.titleBlue,
		700,
		'',
		F.serif,
		TITLE_H * 0.9
	);

	const weekday = weekdayName(day.date);
	const [yRaw, mRaw, dRaw] = day.date.split('-').map(Number);
	const excelDate = `${dRaw}-${MONTHS[(mRaw ?? 1) - 1]}-${yRaw}`;

	ctx.fillStyle = C.navy;
	ctx.fillRect(boxLeft, titleTop, BOX_W, TITLE_H);
	centreLabel(
		ctx,
		weekday,
		boxLeft + BOX_W / 2,
		titleTop + TITLE_H * 0.68,
		BOX_W - 16,
		24 * TYPE_SCALE,
		C.whiteInk,
		700,
		'',
		F.sans,
		TITLE_H * 0.9
	);

	ctx.fillStyle = C.red;
	ctx.fillRect(boxLeft, titleTop + TITLE_H + TITLE_GAP, BOX_W, TITLE_H);
	centreLabel(
		ctx,
		excelDate,
		boxLeft + BOX_W / 2,
		titleTop + TITLE_H + TITLE_GAP + TITLE_H * 0.68,
		BOX_W - 16,
		24 * TYPE_SCALE,
		C.whiteInk,
		700,
		'italic',
		F.sans,
		TITLE_H * 0.9
	);

	/* ------------------------------------------------------------- header -- */

	ctx.fillStyle = C.navy;
	ctx.fillRect(PAD, headerTop, tableWidth, HEAD_ROW);
	ctx.fillStyle = C.red;
	ctx.fillRect(PAD + ROW_HEAD, headerTop, PERIOD_W, HEAD_ROW);

	ws.periods.forEach((label, index) => {
		centreLabel(
			ctx,
			label,
			PAD + ROW_HEAD + (index + 0.5) * PERIOD_W,
			headerTop + HEAD_ROW * 0.68,
			PERIOD_W - 8,
			12.5 * TYPE_SCALE,
			C.whiteInk,
			700,
			'',
			F.sans,
			HEAD_ROW * 0.9
		);
	});
	centreLabel(
		ctx,
		'Class',
		PAD + CLASS_W / 2,
		headerTop + HEAD_ROW * 0.68,
		CLASS_W - 8,
		12.5 * TYPE_SCALE,
		C.whiteInk,
		700,
		'',
		F.sans,
		HEAD_ROW * 0.9
	);
	centreLabel(
		ctx,
		'SCL',
		PAD + CLASS_W + SCL_W / 2,
		headerTop + HEAD_ROW * 0.68,
		SCL_W - 8,
		12.5 * TYPE_SCALE,
		C.whiteInk,
		700,
		'',
		F.sans,
		HEAD_ROW * 0.9
	);

	ctx.strokeStyle = 'rgba(255,255,255,0.32)';
	ctx.lineWidth = 1;
	for (let index = 0; index <= columns; index++) {
		const x = Math.round(PAD + ROW_HEAD + index * PERIOD_W) + 0.5;
		ctx.beginPath();
		ctx.moveTo(x, headerTop + 3);
		ctx.lineTo(x, headerTop + HEAD_ROW - 3);
		ctx.stroke();
	}
	[PAD + CLASS_W, PAD + ROW_HEAD].forEach((x) => {
		ctx.beginPath();
		ctx.moveTo(Math.round(x) + 0.5, headerTop + 3);
		ctx.lineTo(Math.round(x) + 0.5, headerTop + HEAD_ROW - 3);
		ctx.stroke();
	});

	/* -------------------------------------------------------------- rows -- */

	const split = Math.max(1, Math.min(ws.groupSplit, columns));

	ws.classes.forEach((row, rowIndex) => {
		const y = gridTop + rowIndex * ROW_H;
		ctx.fillStyle = C.page;
		ctx.fillRect(PAD, y, ROW_HEAD, ROW_H);

		// Grade and SCL sit on one optical centre line, like any table cell.
		centreLabel(
			ctx,
			row.grade,
			PAD + CLASS_W / 2,
			y + ROW_H * 0.587,
			CLASS_W - 10,
			15 * TYPE_SCALE,
			C.ink,
			700,
			'',
			F.sans,
			ROW_H * 0.9
		);
		centreLabel(
			ctx,
			row.section || row.school,
			PAD + CLASS_W + SCL_W / 2,
			y + ROW_H * 0.564,
			SCL_W - 8,
			11 * TYPE_SCALE,
			C.ink,
			700,
			'',
			F.sans,
			ROW_H * 0.9
		);

		for (let period = 0; period < columns; period++) {
			const cell: Cell | undefined = day.grid[row.id]?.[period];
			const x = PAD + ROW_HEAD + period * PERIOD_W;
			const mark = cell?.mark ?? 'none';
			const fill =
				mark === 'black'
					? C.black
					: mark === 'yellow'
						? C.markYellow
						: mark === 'red'
							? C.markRed
							: period < split
								? C.morning
								: C.afternoon;

			ctx.fillStyle = fill;
			ctx.fillRect(x, y, PERIOD_W, ROW_H);

			const entries = (cell?.entries ?? []).filter((e) => e.subject || e.teacher);
			const inkColor = mark === 'black' ? C.whiteInk : C.ink;
			const subInk = mark === 'black' ? C.whiteSoft : C.teacher;

			if (entries.length >= 2) {
				const half = PERIOD_W / 2;
				drawEntry(ctx, entries[0], { x, y, w: half, h: ROW_H, ink: inkColor, subInk, dense: true });
				drawEntry(ctx, entries[1], {
					x: x + half,
					y,
					w: half,
					h: ROW_H,
					ink: inkColor,
					subInk,
					dense: true
				});
				ctx.strokeStyle =
					mark === 'black'
						? 'rgba(255,255,255,0.35)'
						: mark === 'none'
							? 'rgba(255,255,255,0.75)'
							: 'rgba(20,22,26,0.35)';
				ctx.lineWidth = 1;
				ctx.setLineDash([2, 3]);
				ctx.beginPath();
				ctx.moveTo(Math.round(x + half) + 0.5, y + 6);
				ctx.lineTo(Math.round(x + half) + 0.5, y + ROW_H - 6);
				ctx.stroke();
				ctx.setLineDash([]);
			} else if (entries.length === 1) {
				drawEntry(ctx, entries[0], { x, y, w: PERIOD_W, h: ROW_H, ink: inkColor, subInk });
			}

			if (entries.length === 0 && mark === 'none') {
				ctx.fillStyle = C.dash;
				ctx.font = `700 ${13 * TYPE_SCALE}px ${F.sans}`;
				ctx.textAlign = 'center';
				ctx.fillText('–', x + PERIOD_W / 2, y + ROW_H / 2 + 4);
				ctx.textAlign = 'left';
			}
		}
	});

	/* --------------------------------------------------------------- rules -- */

	// Period column rules: solid black walls, same weight as the row rules.
	ctx.fillStyle = C.black;
	for (let index = 1; index < columns; index++) {
		ctx.fillRect(PAD + ROW_HEAD + index * PERIOD_W - 1.5, gridTop, 3, gridBottom - gridTop);
	}
	// Light dashed divider between Class and SCL.
	ctx.strokeStyle = '#cfcfcf';
	ctx.lineWidth = 1;
	ctx.setLineDash([2, 3]);
	ctx.beginPath();
	ctx.moveTo(Math.round(PAD + CLASS_W) + 0.5, gridTop);
	ctx.lineTo(Math.round(PAD + CLASS_W) + 0.5, gridBottom);
	ctx.stroke();
	ctx.setLineDash([]);

	// Strong black rules: under the header, under each class row, and the
	// solid wall between the class columns and the time grid.
	ctx.fillStyle = C.black;
	ctx.fillRect(PAD, headerTop + HEAD_ROW - 1.5, tableWidth, 3);
	for (let index = 1; index <= rows; index++) {
		ctx.fillRect(PAD, gridTop + index * ROW_H - 1.5, tableWidth, 3);
	}
	// Solid black wall: left class-column boundary.
	ctx.fillStyle = C.black;
	ctx.fillRect(PAD + ROW_HEAD - 1.5, headerTop, 3, gridBottom - headerTop);

	const showBand = Boolean(plan && plan.cols > 0 && bandFrame.length > 0);
	const bandTop = gridBottom + TAIL;
	const frameBottom = showBand && plan ? bandTop + plan.height : gridBottom;

	// Outer border — the data strip lives inside it, as the routine's own
	// footer section. The strip is flush with the table width, so its ring
	// lands exactly on the border columns and the reader's bounding box is
	// this same rectangle. The whitespace above the strip stays far wider
	// than the reader's whitespace walk, so the box top stops at the ring and
	// never folds the table's own black rules into the strip.
	ctx.strokeStyle = C.black;
	ctx.lineWidth = 3;
	ctx.strokeRect(PAD + 1.5, headerTop + 1.5, tableWidth - 3, frameBottom - headerTop - 3);

	/* ---------------------------------------------------------- data band -- */

	let bandMeta: RenderMeta['band'] = null;
	if (showBand && plan) {
		drawBand(ctx, plan, bandFrame, {
			x: PAD,
			y: bandTop,
			ink: C.black,
			paper: C.page
		});

		bandMeta = {
			blocks: plan.cols,
			moduleSize: plan.moduleSize,
			rows: plan.rows,
			height: plan.height
		};
	}

	return { canvas, meta: { width, height, scale, band: bandMeta } };
}

/** Make sure the document fonts are ready before anything is measured. */
export async function ensureFonts(): Promise<void> {
	if (typeof document === 'undefined' || !('fonts' in document)) return;
	const loads = [
		`700 40px ${F.serif}`,
		`italic 700 24px ${F.sans}`,
		`700 13px ${F.sans}`,
		`italic 400 12px ${F.sans}`
	];
	await Promise.all(loads.map((font) => document.fonts.load(font).catch(() => undefined)));
	await document.fonts.ready.catch(() => undefined);
}
