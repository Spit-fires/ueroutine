/**
 * URL-safe base64 that survives being pasted into QR byte mode and read back
 * without padding ambiguity. Implemented from scratch (no Buffer/btoa limits)
 * so it behaves the same in the browser, in Workerd and in Node tests.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = (() => {
	const table = new Int16Array(128).fill(-1);
	for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
	return table;
})();

export function bytesToBase64Url(bytes: Uint8Array): string {
	let out = '';
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i];
		const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
		const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
		out += ALPHABET[b0 >> 2];
		out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
		out += i + 1 < bytes.length ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '';
		out += i + 2 < bytes.length ? ALPHABET[b2 & 0x3f] : '';
	}
	return out;
}

export function base64UrlToBytes(text: string): Uint8Array {
	const clean = text.replace(/[^A-Za-z0-9\-_]/g, '');
	const length = Math.floor((clean.length * 3) / 4);
	const bytes = new Uint8Array(length);
	let byteIndex = 0;
	for (let i = 0; i < clean.length; i += 4) {
		const c0 = LOOKUP[clean.charCodeAt(i)] ?? -1;
		const c1 = LOOKUP[clean.charCodeAt(i + 1)] ?? -1;
		const c2 = LOOKUP[clean.charCodeAt(i + 2)] ?? -1;
		const c3 = LOOKUP[clean.charCodeAt(i + 3)] ?? -1;
		if (c0 < 0 || c1 < 0) throw new Error('Invalid base64url payload');
		if (byteIndex < bytes.length) bytes[byteIndex++] = (c0 << 2) | (c1 >> 4);
		if (c2 >= 0 && byteIndex < bytes.length) bytes[byteIndex++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
		if (c3 >= 0 && byteIndex < bytes.length) bytes[byteIndex++] = ((c2 & 0x03) << 6) | c3;
	}
	return bytes;
}
