import { crc32 } from '#lib/codec/crc32';

/**
 * PNG tEXt chunks.
 *
 * Chat apps re-encode images and throw metadata away, so the data band is the
 * transport that always works. But when the PNG travels untouched — downloaded,
 * mailed, dropped on a USB stick, opened by this app — a tEXt chunk gives a
 * bit-perfect round trip with no scanning involved. Both channels carry the
 * same payload string.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const ROUTINE_KEYWORD = 'UtsahoRoutine';

export function isPng(bytes: Uint8Array): boolean {
	if (bytes.length < 8) return false;
	return SIGNATURE.every((byte, index) => bytes[index] === byte);
}

interface Chunk {
	type: string;
	start: number;
	dataStart: number;
	dataEnd: number;
	end: number;
}

function readChunks(bytes: Uint8Array): Chunk[] {
	const chunks: Chunk[] = [];
	let offset = 8;
	while (offset + 12 <= bytes.length) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
		const length = view.getUint32(0);
		const type = String.fromCharCode(
			bytes[offset + 4],
			bytes[offset + 5],
			bytes[offset + 6],
			bytes[offset + 7]
		);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		const end = dataEnd + 4;
		if (dataEnd > bytes.length) break;
		chunks.push({ type, start: offset, dataStart, dataEnd, end });
		if (type === 'IEND') break;
		offset = end;
	}
	return chunks;
}

function latin1(bytes: Uint8Array): string {
	let out = '';
	for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
	return out;
}

export function readTextChunks(bytes: Uint8Array): Record<string, string> {
	if (!isPng(bytes)) return {};
	const found: Record<string, string> = {};
	for (const chunk of readChunks(bytes)) {
		if (chunk.type !== 'tEXt' && chunk.type !== 'iTXt') continue;
		const data = bytes.subarray(chunk.dataStart, chunk.dataEnd);
		const separator = data.indexOf(0);
		if (separator < 0) continue;
		const keyword = latin1(data.subarray(0, separator));
		const text = latin1(data.subarray(separator + 1));
		found[keyword] = text;
	}
	return found;
}

export function buildTextChunk(keyword: string, text: string): Uint8Array {
	const payload = new Uint8Array(keyword.length + 1 + text.length);
	for (let i = 0; i < keyword.length; i++) payload[i] = keyword.charCodeAt(i) & 0xff;
	payload[keyword.length] = 0;
	for (let i = 0; i < text.length; i++) payload[keyword.length + 1 + i] = text.charCodeAt(i) & 0xff;

	const chunk = new Uint8Array(12 + payload.length);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, payload.length);
	for (let i = 0; i < 4; i++) chunk[4 + i] = 'tEXt'.charCodeAt(i);
	chunk.set(payload, 8);
	const crcInput = new Uint8Array(4 + payload.length);
	crcInput.set(chunk.subarray(4, 8), 0);
	crcInput.set(payload, 4);
	view.setUint32(8 + payload.length, crc32(crcInput));
	return chunk;
}

/** Insert (or replace) a tEXt chunk right after IHDR. */
export function injectTextChunk(bytes: Uint8Array, keyword: string, text: string): Uint8Array {
	if (!isPng(bytes)) return bytes;
	const chunks = readChunks(bytes);
	const ihdr = chunks.find((c) => c.type === 'IHDR');
	if (!ihdr) return bytes;

	const insertAt = ihdr.end;
	const chunk = buildTextChunk(keyword, text);
	const out = new Uint8Array(bytes.length + chunk.length);
	out.set(bytes.subarray(0, insertAt), 0);
	out.set(chunk, insertAt);
	out.set(bytes.subarray(insertAt), insertAt + chunk.length);
	return out;
}
