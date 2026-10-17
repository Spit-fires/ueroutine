import { bytesToBase64Url, base64UrlToBytes } from './base64';
import { crc32Token } from './crc32';
import type { Cell, ClassRow, Day, Entry, Workspace } from '#lib/model/types';

/**
 * The routine payload.
 *
 * The payload is a compact JSON document with short keys and two dictionaries
 * (subjects, teachers) so long names are written once instead of in every
 * cell. Cells are encoded as short strings:
 *
 *   null            → empty cell
 *   "3:5"           → subject 3 / teacher 5
 *   ":5"            → teacher 5 only
 *   "3:"            → subject 3 only
 *   "3:5|7:1"       → two entries (four quadrants: 3 | 7 over 5 | 1)
 *   "3:5*"          → blacked-out cell (the "inside code" mark)
 *
 * Indices are base 36. The JSON is deflated with `deflate-raw` when the
 * platform supports it, then base64url encoded. The finished string starts
 * with "z" (deflated) or "r" (raw JSON) and ends with a CRC-32 token so a
 * partially decoded payload is rejected instead of half-applied.
 */

export const PAYLOAD_VERSION = 1;

export interface Wire {
	v: number;
	n: string;
	d: string;
	s: number;
	g: [string, string];
	p: string[];
	c: [string, string][];
	t: string[];
	r: string[];
	x: (string | null)[][];
}

export interface DecodedRoutine {
	school: string;
	date: string;
	groupSplit: number;
	groupNames: [string, string];
	periods: string[];
	classes: { grade: string; section: string }[];
	subjects: string[];
	teachers: string[];
	/** Entries per class row, aligned with `periods` of the payload. */
	grid: Cell[][];
	compressed: boolean;
	payloadLength: number;
}

export interface EncodedRoutine {
	/** "z…" or "r…" payload string, ready to chunk. */
	payload: string;
	bytes: number;
	compressed: boolean;
	/** Frame data for the data band: deflated bytes when available, else the JSON bytes. */
	bandBytes: Uint8Array;
	bandDeflated: boolean;
	wire: Wire;
	json: string;
}

const toIndex = (value: string, list: string[]): number => {
	if (!value) return -1;
	const found = list.indexOf(value);
	return found;
};

export function encodeCell(cell: Cell | undefined, subjects: string[], teachers: string[]): string | null {
	if (!cell) return null;
	const parts: string[] = [];
	for (const entry of cell.entries.slice(0, 2)) {
		if (!entry.subject && !entry.teacher) continue;
		const s = toIndex(entry.subject, subjects);
		const t = toIndex(entry.teacher, teachers);
		if (s < 0 && t < 0) continue;
		parts.push(
			`${s >= 0 ? s.toString(36) : ''}:${t >= 0 ? t.toString(36) : ''}`
		);
	}
	if (!parts.length) return cell.black ? '*' : null;
	return parts.join('|') + (cell.black ? '*' : '');
}

export function decodeCell(
	code: string | null | undefined,
	subjects: string[],
	teachers: string[]
): Cell {
	if (!code) return { entries: [], black: false };
	const black = code.endsWith('*');
	const body = black ? code.slice(0, -1) : code;
	const entries: Entry[] = [];
	for (const part of body.split('|')) {
		if (!part) continue;
		const [sIdx, tIdx] = part.split(':');
		const subject = sIdx ? (subjects[parseInt(sIdx, 36)] ?? '') : '';
		const teacher = tIdx ? (teachers[parseInt(tIdx, 36)] ?? '') : '';
		if (!subject && !teacher && !black) continue;
		entries.push({ subject, teacher });
	}
	return { entries, black };
}

/** Collect the subject/teacher names this day actually uses, so the payload stays small. */
function collectNames(day: Day, ws: Workspace) {
	const subjects: string[] = [];
	const teachers: string[] = [];
	const addTo = (list: string[], value: string) => {
		if (value && !list.includes(value)) list.push(value);
	};
	for (const row of ws.classes) {
		for (const cell of day.grid[row.id] ?? []) {
			for (const entry of cell.entries) {
				addTo(subjects, entry.subject);
				addTo(teachers, entry.teacher);
			}
		}
	}
	return { subjects, teachers };
}

export function buildWire(day: Day, ws: Workspace): Wire {
	const { subjects, teachers } = collectNames(day, ws);
	const rows = ws.classes.map((row) => row);
	const x = rows.map((row) =>
		Array.from({ length: ws.periods.length }, (_, period) =>
			encodeCell(day.grid[row.id]?.[period], subjects, teachers)
		)
	);
	return {
		v: PAYLOAD_VERSION,
		n: ws.school,
		d: day.date,
		s: ws.groupSplit,
		g: [ws.groupNames[0] ?? '', ws.groupNames[1] ?? ''],
		p: [...ws.periods],
		c: rows.map((row: ClassRow) => [row.grade, row.section] as [string, string]),
		t: subjects,
		r: teachers,
		x
	};
}

async function deflate(input: Uint8Array): Promise<Uint8Array | null> {
	if (typeof CompressionStream === 'undefined') return null;
	try {
		const stream = new Blob([input as BlobPart])
			.stream()
			.pipeThrough(new CompressionStream('deflate-raw'));
		const buffer = await new Response(stream).arrayBuffer();
		return new Uint8Array(buffer);
	} catch {
		return null;
	}
}

async function inflate(input: Uint8Array): Promise<Uint8Array | null> {
	if (typeof DecompressionStream === 'undefined') return null;
	try {
		const stream = new Blob([input as BlobPart])
			.stream()
			.pipeThrough(new DecompressionStream('deflate-raw'));
		const buffer = await new Response(stream).arrayBuffer();
		return new Uint8Array(buffer);
	} catch {
		return null;
	}
}

export { inflate as inflateBytes };

export async function encodeRoutine(day: Day, ws: Workspace): Promise<EncodedRoutine> {
	const wire = buildWire(day, ws);
	const json = JSON.stringify(wire);
	const raw = new TextEncoder().encode(json);
	const packed = await deflate(raw);
	const bytes = packed ?? raw;
	const payload = `${packed ? 'z' : 'r'}${bytesToBase64Url(bytes)}.${crc32Token(json)}`;
	return {
		payload,
		bytes: bytes.length,
		compressed: Boolean(packed),
		bandBytes: bytes,
		bandDeflated: Boolean(packed),
		wire,
		json
	};
}

export interface DecodeOutcome {
	routine?: DecodedRoutine;
	error?: string;
}

export async function decodePayload(payload: string): Promise<DecodeOutcome> {
	const trimmed = payload.trim();
	if (trimmed.length < 3) return { error: 'Payload is empty' };
	const dot = trimmed.lastIndexOf('.');
	if (dot < 0) return { error: 'Payload header is missing' };
	const body = trimmed.slice(0, dot);
	const checksum = trimmed.slice(dot + 1);
	const mode = body[0];
	let bytes: Uint8Array;
	try {
		bytes = base64UrlToBytes(body.slice(1));
	} catch (error) {
		return { error: error instanceof Error ? error.message : 'Payload is not valid base64' };
	}
	let jsonBytes: Uint8Array;
	if (mode === 'z') {
		const inflated = await inflate(bytes);
		if (!inflated) return { error: 'Could not decompress the payload' };
		jsonBytes = inflated;
	} else if (mode === 'r') {
		jsonBytes = bytes;
	} else {
		return { error: `Unknown payload mode "${mode}"` };
	}
	const json = new TextDecoder().decode(jsonBytes);
	if (crc32Token(json) !== checksum) {
		return { error: 'Payload checksum mismatch — the image data was damaged' };
	}
	let wire: Wire;
	try {
		wire = JSON.parse(json) as Wire;
	} catch {
		return { error: 'Payload is not valid JSON' };
	}
	if (wire.v !== PAYLOAD_VERSION) {
		return { error: `Unsupported payload version ${wire.v}` };
	}
	const grid = wire.x.map((row) =>
		row.map((code) => decodeCell(code, wire.t, wire.r))
	);
	return {
		routine: {
			school: wire.n,
			date: wire.d,
			groupSplit: wire.s,
			groupNames: [wire.g?.[0] ?? '', wire.g?.[1] ?? ''],
			periods: wire.p,
			classes: wire.c.map(([grade, section]) => ({ grade, section })),
			subjects: wire.t,
			teachers: wire.r,
			grid,
			compressed: mode === 'z',
			payloadLength: trimmed.length
		}
	};
}
