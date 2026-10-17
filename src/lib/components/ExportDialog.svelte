<script lang="ts">
	import Dialog from './Dialog.svelte';
	import { desk } from '#lib/model/store.svelte';
	import { fullDate, weekdayName, type Day } from '#lib/model/types';
	import {
		DEFAULT_EXPORT,
		copyImageToClipboard,
		downloadBlob,
		printImage,
		prepareCanvas,
		shareImage,
		canvasToBlob,
		exportFilename,
		type ExportOptions,
		type ExportReport
	} from '#lib/export/png';
	import { injectTextChunk, ROUTINE_KEYWORD } from '#lib/png/text';
	import { formatBytes } from '#lib/import/import';

	interface Props {
		day: Day;
		onclose: () => void;
		ondiagnostics: () => void;
	}

	let { day, onclose, ondiagnostics }: Props = $props();

	let options = $state<ExportOptions>({ ...DEFAULT_EXPORT, ...desk.workspace.band });
	// Sizes from older sessions no longer exist (the strip must divide the
	// table width now) — anything unrecognised falls back to Auto.
	if (![0, 8, 14].includes(options.moduleSize)) options.moduleSize = 0;
	let report = $state<ExportReport | null>(null);
	let payload = $state('');
	let busy = $state(true);
	let previewHost = $state<HTMLDivElement | null>(null);
	let error = $state('');
	let runId = 0;

	/** How thick one dot module stays after a chat app caps the longest side. */
	const survivedPixels = $derived(
		report ? Math.round(report.pixelsPerModuleAfterCap * 10) / 10 : 0
	);

	$effect(() => {
		// Re-render whenever an option changes.
		void options.scale;
		void options.moduleSize;
		void options.includeBand;
		void options.embedText;
		void desk.workspace.periods.length;
		void render();
	});

	async function render() {
		const id = ++runId;
		busy = true;
		error = '';
		try {
			const prepared = await prepareCanvas(day, desk.workspace, options);
			if (id !== runId) return;
			report = prepared.report;
			payload = prepared.payload;
			const host = previewHost;
			if (host) {
				host.replaceChildren();
				const clone = document.createElement('canvas');
				clone.width = prepared.canvas.width;
				clone.height = prepared.canvas.height;
				clone.getContext('2d')?.drawImage(prepared.canvas, 0, 0);
				clone.style.width = '100%';
				clone.style.height = 'auto';
				clone.style.display = 'block';
				host.replaceChildren(clone);
			}
		} catch (caught) {
			if (id === runId) error = caught instanceof Error ? caught.message : 'Export failed';
		} finally {
			if (id === runId) busy = false;
		}
	}

	async function build(): Promise<Blob> {
		const prepared = await prepareCanvas(day, desk.workspace, options);
		const blob = await canvasToBlob(prepared.canvas);
		if (!options.embedText) return blob;
		const bytes = new Uint8Array(await blob.arrayBuffer());
		return new Blob([injectTextChunk(bytes, ROUTINE_KEYWORD, prepared.payload) as BlobPart], {
			type: 'image/png'
		});
	}

	async function download() {
		const blob = await build();
		downloadBlob(blob, exportFilename(day, desk.workspace.school));
		desk.flash('PNG exported with its data band', 'good');
	}

	async function copyImage() {
		const blob = await build();
		const ok = await copyImageToClipboard(blob);
		desk.flash(
			ok ? 'Image copied to the clipboard' : 'This browser blocked the clipboard copy',
			ok ? 'good' : 'warn'
		);
	}

	async function share() {
		const blob = await build();
		const ok = await shareImage(
			blob,
			exportFilename(day, desk.workspace.school),
			`${desk.workspace.school} ${day.date}`
		);
		if (!ok) desk.flash('Sharing is not available here — download instead', 'warn');
	}

	async function print() {
		await printImage(await build(), `${desk.workspace.school} ${day.date}`);
	}

	async function copyPayload() {
		await navigator.clipboard.writeText(payload);
		desk.flash('Payload text copied', 'good');
	}

	function exportJson() {
		const blob = new Blob([JSON.stringify(desk.toJSON(), null, 2)], { type: 'application/json' });
		downloadBlob(blob, `utsaho-routine-workspace-${day.date}.json`);
	}

	function remember() {
		desk.setBand({
			moduleSize: options.moduleSize,
			embedText: options.embedText,
			scale: options.scale
		});
	}
</script>

<Dialog
	title="Export this day"
	eyebrow="{weekdayName(day.date)} · {fullDate(day.date)}"
	lede="The PNG holds the printed routine with its data strip built into the frame itself. The strip is what lets the same image be opened later and rebuilt cell for cell — even after a chat app re-compresses it."
	size="lg"
	{onclose}
>
	<div class="layout">
		<div class="preview tray">
			<div class="tray-core">
				<div class="preview-host" bind:this={previewHost}></div>
			</div>
			{#if busy}<span class="busy">rendering…</span>{/if}
		</div>

		<div class="controls">
			{#if error}
				<p class="error">{error}</p>
			{/if}

			<section class="group">
				<span class="eyebrow">image</span>
				<label class="row">
					<span>Crispness</span>
					<select bind:value={options.scale} onchange={remember}>
						<option value={1}>1× — compact file</option>
						<option value={2}>2× — recommended</option>
						<option value={3}>3× — print</option>
					</select>
				</label>
				<label class="row">
					<span>Data band</span>
					<input type="checkbox" bind:checked={options.includeBand} onchange={remember} />
				</label>
				<label class="row">
					<span>Module size</span>
					<select bind:value={options.moduleSize} onchange={remember}>
						<option value={0}>Auto — fitted to the table</option>
						<option value={8}>8 px</option>
						<option value={14}>14 px — heavy compression</option>
					</select>
				</label>
				<label class="row">
					<span>PNG metadata copy</span>
					<input type="checkbox" bind:checked={options.embedText} onchange={remember} />
				</label>
			</section>

			{#if report}
				<section class="group">
					<span class="eyebrow">payload</span>
					<dl class="facts">
						<div>
							<dt>size</dt>
							<dd>{formatBytes(report.payloadBytes)} · {report.payloadChars} chars</dd>
						</div>
						<div>
							<dt>encoded</dt>
							<dd>{report.compressed ? 'deflate-raw' : 'raw json'}</dd>
						</div>
						<div>
							<dt>data band</dt>
							<dd>
								{report.bandCols}×{report.bandRows} modules · {report.bandHeight
									? `${Math.round(report.bandHeight)}px tall`
									: 'off'}
							</dd>
						</div>
						<div>
							<dt>modules</dt>
							<dd>{report.moduleSize}px{report.autoTuned ? ' · auto' : ''}</dd>
						</div>
						<div>
							<dt>image</dt>
							<dd>{report.imageWidth}×{report.imageHeight}px</dd>
						</div>
						<div>
							<dt>after a 2048px cap</dt>
							<dd class:tone-warn={survivedPixels < 5}>{survivedPixels}px per module</dd>
						</div>
						<div>
							<dt>metadata copy</dt>
							<dd>{report.embeddedText ? 'embedded' : 'off'}</dd>
						</div>
					</dl>
					<p class="note">
						A chat app caps the longest side at roughly 2048px, so the band is tuned to stay chunky
						after that squeeze. It carries the compressed routine rather than its printable text —
						about a quarter of the pixels a base64 copy would need — and stores it three times, so
						ordinary re-compression damage is voted away on import. A PNG that travels untouched is
						read back losslessly from its metadata without touching the band at all.
					</p>
				</section>
			{/if}

			<section class="group">
				<span class="eyebrow">deliver</span>
				<div class="buttons">
					<button class="btn btn-primary" type="button" onclick={download}>Download PNG</button>
					<button class="btn" type="button" onclick={copyImage}>Copy image</button>
					<button class="btn" type="button" onclick={share}>Share…</button>
					<button class="btn" type="button" onclick={print}>Print / PDF</button>
				</div>
				<div class="buttons">
					<button class="btn btn-sm" type="button" onclick={exportJson}>Export JSON</button>
					<button class="btn btn-sm" type="button" onclick={copyPayload}>Copy payload</button>
					<button class="btn btn-sm" type="button" onclick={ondiagnostics}
						>Run round-trip test</button
					>
				</div>
			</section>
		</div>
	</div>
</Dialog>

<style>
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1.45fr) minmax(280px, 1fr);
		gap: 22px;
		align-items: start;
	}

	.preview {
		position: relative;
		max-height: 66dvh;
		overflow-y: auto;
	}

	.preview-host {
		display: block;
		background: var(--paper);
	}

	.busy {
		position: absolute;
		left: 50%;
		top: 12px;
		transform: translateX(-50%);
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--ink);
		color: #fff;
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 12.5px;
		color: var(--ink-2);
	}

	.row select {
		min-width: 148px;
		height: 30px;
		padding: 0 8px;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
		font-size: 12.5px;
	}

	.row input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: var(--ink);
	}

	.facts {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.facts > div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.facts dt {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.facts dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--ink);
	}

	.tone-warn {
		color: var(--amber) !important;
	}

	.note {
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--ink-3);
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.error {
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: var(--danger-tint);
		color: var(--danger);
		font-size: 12.5px;
	}

	@media (max-width: 860px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
