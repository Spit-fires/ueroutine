import { describe, expect, it } from 'vitest';
import { crc32, crc32Text, crc32Token } from './crc32';
import { base64UrlToBytes, bytesToBase64Url } from './base64';
import {
	buildWire,
	decodeCell,
	decodePayload,
	encodeCell,
	encodeRoutine,
	PAYLOAD_VERSION
} from './payload';
import { emptyCell, type Cell, type Day, type Workspace } from '#lib/model/types';
import { createInitialWorkspace } from '#lib/model/seed';
import { BAND_COPIES, BAND_VERSION, frameBytes, interleaveCopies } from '#lib/band/band';
import { decodeSampled } from '#lib/band/read';

describe('crc32', () => {
	it('matches the canonical IEEE check value', () => {
		expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
	});

	it('is stable for text', () => {
		expect(crc32Text('Utsaho Educare')).toBe(crc32Text('Utsaho Educare'));
		expect(crc32Text('a')).not.toBe(crc32Text('b'));
		expect(crc32Token('abc')).toMatch(/^[0-9a-z]+$/);
	});
});

describe('base64url', () => {
	it('round-trips arbitrary bytes', () => {
		const bytes = new Uint8Array(1024);
		for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256;
		const text = bytesToBase64Url(bytes);
		expect(text).toMatch(/^[A-Za-z0-9\-_]+$/);
		expect([...base64UrlToBytes(text)]).toEqual([...bytes]);
	});

	it('round-trips every remainder length', () => {
		for (const length of [0, 1, 2, 3, 4, 5, 17]) {
			const bytes = new Uint8Array(length);
			for (let i = 0; i < length; i++) bytes[i] = 200 - i;
			expect([...base64UrlToBytes(bytesToBase64Url(bytes))].slice(0, length)).toEqual([...bytes]);
		}
	});

	it('ignores padding characters some scanners add', () => {
		const bytes = new Uint8Array([1, 2, 3, 4, 5]);
		const text = `${bytesToBase64Url(bytes)}==`;
		expect([...base64UrlToBytes(text)]).toEqual([...bytes]);
	});
});

describe('cell codes', () => {
	const subjects = ['Math', 'BGS'];
	const teachers = ['SIH', 'JAZ'];

	it('encodes a subject/teacher pair', () => {
		expect(encodeCell({ entries: [{ subject: 'Math', teacher: 'JAZ' }], black: false }, subjects, teachers)).toBe('0:1');
	});

	it('encodes two entries as a quadrant cell', () => {
		const cell: Cell = {
			entries: [
				{ subject: 'Math', teacher: 'SIH' },
				{ subject: 'BGS', teacher: 'JAZ' }
			],
			black: false
		};
		expect(encodeCell(cell, subjects, teachers)).toBe('0:0|1:1');
		expect(decodeCell('0:0|1:1', subjects, teachers)).toEqual(cell);
	});

	it('carries the black marker through a round trip', () => {
		const cell: Cell = { entries: [{ subject: 'Math', teacher: 'JAZ' }], black: true };
		const code = encodeCell(cell, subjects, teachers);
		expect(code).toBe('0:1*');
		expect(decodeCell(code, subjects, teachers)).toEqual(cell);
	});

	it('keeps a blacked-out empty cell', () => {
		expect(encodeCell({ entries: [], black: true }, subjects, teachers)).toBe('*');
		expect(decodeCell('*', subjects, teachers)).toEqual({ entries: [], black: true });
	});

	it('drops entries whose names are unknown', () => {
		expect(encodeCell({ entries: [{ subject: 'Ghost', teacher: '' }], black: false }, subjects, teachers)).toBeNull();
	});

	it('treats an empty cell as null', () => {
		expect(encodeCell(emptyCell(), subjects, teachers)).toBeNull();
		expect(decodeCell(null, subjects, teachers)).toEqual(emptyCell());
	});
});

function sampleWorkspace(): { ws: Workspace; day: Day } {
	const ws = createInitialWorkspace('2026-09-07');
	ws.periods = ws.periods.slice(0, 4);
	ws.groupSplit = 2;
	const day = ws.days[0];
	const row = ws.classes[0].id;
	day.grid[row][0] = { entries: [{ subject: 'Math', teacher: 'SIH' }], black: false };
	day.grid[row][1] = {
		entries: [
			{ subject: 'BGS', teacher: 'JAZ' },
			{ subject: 'ICT', teacher: 'MAM' }
		],
		black: false
	};
	day.grid[row][2] = { entries: [{ subject: 'Sci Exam', teacher: 'JAZ' }], black: true };
	return { ws, day };
}

describe('payload', () => {
	it('round-trips a routine through deflate + base64', async () => {
		const { ws, day } = sampleWorkspace();
		const encoded = await encodeRoutine(day, ws);
		expect(encoded.payload.startsWith('z')).toBe(true);
		expect(encodeRoutine.length).toBeLessThanOrEqual(2);

		const decoded = await decodePayload(encoded.payload);
		expect(decoded.error).toBeUndefined();
		const routine = decoded.routine!;
		expect(routine.school).toBe('Utsaho Educare');
		expect(routine.date).toBe('2026-09-07');
		expect(routine.periods).toEqual(ws.periods);
		expect(routine.groupSplit).toBe(2);
		expect(routine.classes).toEqual(ws.classes.map((c) => ({ grade: c.grade, section: c.section })));
		expect(routine.grid[0][0]).toEqual({ entries: [{ subject: 'Math', teacher: 'SIH' }], black: false });
		expect(routine.grid[0][1].entries).toHaveLength(2);
		expect(routine.grid[0][2]).toEqual({ entries: [{ subject: 'Sci Exam', teacher: 'JAZ' }], black: true });
		expect(routine.grid[0][3]).toEqual(emptyCell());
	});

	it('rejects a payload whose checksum was altered', async () => {
		const { ws, day } = sampleWorkspace();
		const encoded = await encodeRoutine(day, ws);
		const tampered = `${encoded.payload.slice(0, -4)}zzzz`;
		const decoded = await decodePayload(tampered);
		expect(decoded.routine).toBeUndefined();
		expect(decoded.error).toMatch(/checksum|decompress|base64/i);
	});

	it('reports an unsupported version instead of guessing', async () => {
		const { ws, day } = sampleWorkspace();
		const wire = { ...buildWire(day, ws), v: PAYLOAD_VERSION + 1 };
		const bytes = new TextEncoder().encode(JSON.stringify(wire));
		const payload = `r${bytesToBase64Url(bytes)}.${crc32Token(JSON.stringify(wire))}`;
		const decoded = await decodePayload(payload);
		expect(decoded.error).toMatch(/version/i);
	});

	it('keeps an uncompressed payload decodable when deflate is missing', async () => {
		const { ws, day } = sampleWorkspace();
		const wire = buildWire(day, ws);
		const json = JSON.stringify(wire);
		const payload = `r${bytesToBase64Url(new TextEncoder().encode(json))}.${crc32Token(json)}`;
		const decoded = await decodePayload(payload);
		expect(decoded.routine?.date).toBe('2026-09-07');
		expect(decoded.routine?.compressed).toBe(false);
	});
});

describe('band framing', () => {
	it('frames band data with magic, version, mode, length and CRC', () => {
		const data = new TextEncoder().encode('hello routine');
		const frame = frameBytes(data, false);
		expect(frame[0]).toBe(0x55);
		expect(frame[1]).toBe(0x45);
		expect(frame[2]).toBe(BAND_VERSION);
		expect(frame[3]).toBe(0);
		expect((frame[4] << 8) | frame[5]).toBe(data.length);
		const stored =
			((frame[frame.length - 4] << 24) |
				(frame[frame.length - 3] << 16) |
				(frame[frame.length - 2] << 8) |
				frame[frame.length - 1]) >>> 0;
		expect(crc32(frame.subarray(6, frame.length - 4))).toBe(stored);
	});

	it('stores the frame back to back BAND_COPIES times', () => {
		const frame = frameBytes(new Uint8Array([1, 2, 3]), true);
		const stream = interleaveCopies(frame);
		expect(stream.length).toBe(frame.length * BAND_COPIES);
		for (let copy = 0; copy < BAND_COPIES; copy++) {
			expect([...stream.subarray(copy * frame.length, (copy + 1) * frame.length)]).toEqual([...frame]);
		}
	});

	/** Turn a stream of bytes into what the sampler would read: dark ≈ 40, light ≈ 230. */
	const asSampled = (stream: Uint8Array): Float32Array => {
		const values = new Float32Array(stream.length * 8);
		for (let i = 0; i < values.length; i++) {
			values[i] = (stream[i >> 3] >> (7 - (i & 7))) & 1 ? 40 : 230;
		}
		return values;
	};

	it('reads a version 2 band back into the exact payload string', async () => {
		const { ws, day } = sampleWorkspace();
		const encoded = await encodeRoutine(day, ws);
		const stream = interleaveCopies(frameBytes(encoded.bandBytes, encoded.bandDeflated));
		const outcome = await decodeSampled(asSampled(stream));
		expect(outcome.payload).toBe(encoded.payload);
	});

	it('still reads a legacy version 1 band', async () => {
		const payload = 'rZXhhbXBsZQ.abc123';
		const data = new TextEncoder().encode(payload);
		const frame = new Uint8Array(9 + data.length);
		frame[0] = 0x55;
		frame[1] = 0x45;
		frame[2] = 1;
		frame[3] = (data.length >> 8) & 0xff;
		frame[4] = data.length & 0xff;
		frame.set(data, 5);
		new DataView(frame.buffer).setUint32(5 + data.length, crc32(data) >>> 0);
		const stream = new Uint8Array(frame.length * 3);
		for (let copy = 0; copy < 3; copy++) stream.set(frame, copy * frame.length);
		const outcome = await decodeSampled(asSampled(stream));
		expect(outcome.payload).toBe(payload);
	});
});
