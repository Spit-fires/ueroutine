import { decodePayload, type DecodedRoutine } from '#lib/codec/payload';
import { ROUTINE_KEYWORD, isPng, readTextChunks } from '#lib/png/text';
import { scanBand } from '#lib/band/read';

export interface ImportStats {
	decoder: string;
	durationMs: number;
	bytes: number;
	payloadChars: number;
	compressed: boolean;
	modulePixels?: number;
}

export interface ImportResult {
	source: 'png-text' | 'band' | 'none';
	routine?: DecodedRoutine;
	payload?: string;
	error?: string;
	log: string[];
	stats: ImportStats;
}

/**
 * Read a routine back out of a picture.
 *
 * Order matters: a PNG that still carries its tEXt chunk returns a bit-perfect
 * copy without touching the pixels. Anything else — a JPEG re-encoded by a chat
 * app, a screenshot, a photo of a screen — goes through the data band scanner.
 */
export async function importRoutineFromBlob(blob: Blob): Promise<ImportResult> {
	const started = performance.now();
	const log: string[] = [];
	const stats: ImportStats = {
		decoder: 'none',
		durationMs: 0,
		bytes: blob.size,
		payloadChars: 0,
		compressed: false
	};

	log.push(`${blob.type || 'image'} · ${formatBytes(blob.size)}`);

	const bytes = new Uint8Array(await blob.arrayBuffer());

	if (isPng(bytes)) {
		const texts = readTextChunks(bytes);
		const embedded = texts[ROUTINE_KEYWORD];
		if (embedded) {
			log.push('PNG metadata: routine payload found');
			const decoded = await decodePayload(embedded);
			if (decoded.routine) {
				stats.decoder = 'png tEXt chunk';
				stats.payloadChars = embedded.length;
				stats.compressed = decoded.routine.compressed;
				stats.durationMs = Math.round(performance.now() - started);
				log.push('lossless copy — pixels were not needed');
				return { source: 'png-text', routine: decoded.routine, payload: embedded, log, stats };
			}
			log.push(`PNG metadata: payload unusable (${decoded.error ?? 'unknown'}) — scanning the data band`);
		} else {
			log.push('PNG metadata: no embedded routine — scanning the data band');
		}
	} else {
		log.push('no PNG metadata available — scanning the data band');
	}

	const scan = await scanBand(blob);
	log.push(...scan.log);
	stats.decoder = 'data band scan';
	stats.modulePixels = scan.modulePixels;

	if (!scan.payload) {
		const error = scan.error ?? 'No routine data band found in this image';
		log.push(error);
		stats.durationMs = Math.round(performance.now() - started);
		return { source: 'none', error, log, stats };
	}

	const decoded = await decodePayload(scan.payload);
	if (!decoded.routine) {
		const error = decoded.error ?? 'The payload could not be decoded';
		log.push(error);
		stats.durationMs = Math.round(performance.now() - started);
		return { source: 'none', error, log, stats };
	}

	stats.payloadChars = scan.payload.length;
	stats.compressed = decoded.routine.compressed;
	stats.durationMs = Math.round(performance.now() - started);
	log.push(`payload ${formatBytes(scan.payload.length)}`);

	return {
		source: 'band',
		routine: decoded.routine,
		payload: scan.payload,
		log,
		stats
	};
}

export function formatBytes(count: number): string {
	if (count < 1024) return `${count} B`;
	if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} kB`;
	return `${(count / (1024 * 1024)).toFixed(2)} MB`;
}
