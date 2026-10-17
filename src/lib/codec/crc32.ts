/**
 * CRC-32 (IEEE 802.3) — used for payload integrity in the data band and for
 * PNG chunk checksums. Small table-based implementation so the codec stays
 * dependency free.
 */

const TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let value = i;
		for (let bit = 0; bit < 8; bit++) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[i] = value >>> 0;
	}
	return table;
})();

export function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** CRC of a UTF-8 string. */
export function crc32Text(text: string): number {
	return crc32(new TextEncoder().encode(text));
}

/** Short, printable CRC for embedding in chunk headers. */
export function crc32Token(text: string): string {
	return crc32Text(text).toString(36);
}
