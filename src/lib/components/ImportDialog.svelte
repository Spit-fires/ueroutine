<script lang="ts">
	import Dialog from './Dialog.svelte';
	import { desk } from '#lib/model/store.svelte';
	import { className, fullDate, longDate, type Workspace } from '#lib/model/types';
	import { importRoutineFromBlob, formatBytes, type ImportResult } from '#lib/import/import';
	import { mergeDecoded } from '#lib/import/merge';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	let busy = $state(false);
	let dragging = $state(false);
	let result = $state<ImportResult | null>(null);
	let workspaceFile = $state<Workspace | null>(null);
	let failure = $state('');
	let target = $state<'new' | 'replace'>('new');
	let layout = $state<'keep' | 'adopt'>('keep');
	let showLog = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	const routine = $derived(result?.routine);
	const filledCells = $derived(
		routine?.grid.reduce(
			(sum, row) => sum + row.filter((cell) => cell.entries.length || cell.mark !== 'none').length,
			0
		) ?? 0
	);

	$effect(() => {
		const onpaste = (event: ClipboardEvent) => {
			const file = [...(event.clipboardData?.items ?? [])]
				.map((item) => (item.kind === 'file' ? item.getAsFile() : null))
				.find((candidate): candidate is File => Boolean(candidate));
			if (file) {
				event.preventDefault();
				void handleFile(file);
			}
		};
		window.addEventListener('paste', onpaste);
		return () => window.removeEventListener('paste', onpaste);
	});

	async function handleFile(file: File) {
		busy = true;
		failure = '';
		result = null;
		workspaceFile = null;
		try {
			if (file.type === 'application/json' || file.name.endsWith('.json')) {
				const parsed = JSON.parse(await file.text()) as Workspace & { classes?: unknown };
				if (Array.isArray(parsed.classes) && Array.isArray(parsed.days)) {
					workspaceFile = parsed;
				} else {
					failure = 'That JSON file is not a routine file from this app.';
				}
			} else {
				result = await importRoutineFromBlob(file);
				if (!result.routine) failure = result.error ?? 'Nothing could be read from this image.';
			}
		} catch (caught) {
			failure = caught instanceof Error ? caught.message : 'The file could not be read.';
		} finally {
			busy = false;
		}
	}

	function apply() {
		if (workspaceFile) {
			desk.replaceWorkspace(workspaceFile);
			desk.flash('Routine file restored', 'good');
			onclose();
			return;
		}
		const decoded = result?.routine;
		if (!decoded) return;
		const merged = mergeDecoded(desk.toJSON(), decoded, {
			target,
			layout,
			dayId: desk.currentDayId
		});
		desk.replaceWorkspace(merged.ws);
		const summary = merged.summary;
		desk.setCurrentDay(summary.dayId);
		desk.flash(
			`Imported ${summary.cellsFilled} cell(s) into ${fullDate(summary.date)}${summary.classesAdded ? ` · ${summary.classesAdded} new class row(s)` : ''}`,
			'good'
		);
		onclose();
	}
</script>

<Dialog
	title="Import a routine"
	eyebrow="image · data band · json"
	lede="Drop in an exported PNG — or the JPEG a chat app turned it into. The data band is read from the pixels, so re-compression, resizing and screenshots are fine. Pasting an image straight from the clipboard works too."
	{onclose}
>
	<div class="stack">
		<label
			class="drop"
			class:dragging
			class:busy
			ondragover={(event) => {
				event.preventDefault();
				dragging = true;
			}}
			ondragleave={() => (dragging = false)}
			ondrop={(event) => {
				event.preventDefault();
				dragging = false;
				const file = event.dataTransfer?.files?.[0];
				if (file) void handleFile(file);
			}}
		>
			<input
				bind:this={fileInput}
				type="file"
				accept="image/*,.json,application/json"
				onchange={(event) => {
					const file = event.currentTarget.files?.[0];
					if (file) void handleFile(file);
				}}
			/>
			<span class="drop-mark" aria-hidden="true">
				<svg viewBox="0 0 24 24" width="20" height="20">
					<path
						d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15"
						fill="none"
						stroke="currentColor"
						stroke-width="1.3"
						stroke-linecap="round"
					/>
				</svg>
			</span>
			<span class="drop-title">{busy ? 'Reading the image…' : 'Drop an image or JSON file'}</span>
			<span class="drop-hint">or click to choose · paste with Ctrl V · PNG, JPG, WebP</span>
		</label>

		{#if failure}
			<p class="failure">{failure}</p>
		{/if}

		{#if workspaceFile}
			<section class="card reveal">
				<span class="eyebrow">routine file</span>
				<h3 class="display">Full workspace recognised</h3>
				<p class="lede">
					{workspaceFile.days?.length ?? 0} day(s), {workspaceFile.classes?.length ?? 0} class row(s),
					{workspaceFile.periods?.length ?? 0} period(s). Restoring replaces everything currently on the
					desk — undo brings it back.
				</p>
			</section>
		{/if}

		{#if routine && result}
			<section class="card reveal">
				<div class="card-head">
					<div>
						<span class="eyebrow">
							{result.source === 'png-text' ? 'png metadata · lossless' : 'data band · scanned'}
						</span>
						<h3 class="display">{longDate(routine.date)}</h3>
						<p class="lede">
							{routine.school} · {routine.classes.length} class row(s) · {routine.periods.length} period(s)
							·
							{filledCells} filled cell(s)
						</p>
					</div>
					<div class="chips">
						<span class="chip chip-sage">{filledCells} cells</span>
						<span class="chip">{routine.compressed ? 'deflate' : 'raw'}</span>
						<span class="chip">{formatBytes(result.stats.payloadChars)}</span>
					</div>
				</div>

				<dl class="facts">
					<div>
						<dt>decoder</dt>
						<dd>{result.stats.decoder}</dd>
					</div>
					<div>
						<dt>band</dt>
						<dd>
							{result.stats.modulePixels
								? `${result.stats.modulePixels.toFixed(1)}px modules`
								: '—'}
						</dd>
					</div>
					<div>
						<dt>took</dt>
						<dd>{result.stats.durationMs} ms</dd>
					</div>
				</dl>

				<div class="classes">
					{#each routine.classes as row, index (index)}
						<span class="chip"
							>{className({ id: 'x', grade: row.grade, section: row.section, school: '' })}</span
						>
					{/each}
				</div>

				<div class="choices">
					<fieldset>
						<legend class="eyebrow">where</legend>
						<label
							><input type="radio" bind:group={target} value="new" /> Add as its own day ({routine.date})</label
						>
						<label
							><input type="radio" bind:group={target} value="replace" /> Replace the day on screen</label
						>
					</fieldset>
					<fieldset>
						<legend class="eyebrow">columns</legend>
						<label
							><input type="radio" bind:group={layout} value="keep" /> Keep our {desk.periods
								.length} periods</label
						>
						<label>
							<input type="radio" bind:group={layout} value="adopt" /> Adopt the imported {routine
								.periods.length}
						</label>
					</fieldset>
				</div>

				{#if layout === 'keep' && routine.periods.length !== desk.periods.length}
					<p class="note">
						Importing into {desk.periods.length} columns maps the first
						{Math.min(desk.periods.length, routine.periods.length)} periods and reports anything dropped.
					</p>
				{/if}
			</section>
		{/if}

		{#if result?.log?.length}
			<section class="log">
				<button class="log-toggle" type="button" onclick={() => (showLog = !showLog)}>
					{showLog ? 'Hide' : 'Show'} the scan log ({result.log.length})
				</button>
				{#if showLog}
					<ol class="log-list">
						{#each result.log as line, index (index)}
							<li><span>{String(index + 1).padStart(2, '0')}</span>{line}</li>
						{/each}
					</ol>
				{/if}
			</section>
		{/if}
	</div>

	{#snippet footer()}
		<button class="btn" type="button" onclick={onclose}>Cancel</button>
		<button
			class="btn btn-primary"
			type="button"
			disabled={busy || (!routine && !workspaceFile)}
			onclick={apply}
		>
			{workspaceFile ? 'Restore routine file' : 'Import into the desk'}
		</button>
	{/snippet}
</Dialog>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 7px;
		padding: 30px 20px;
		border: 1.5px dashed var(--hairline-strong);
		border-radius: var(--r-md);
		background: var(--surface-2);
		cursor: pointer;
		text-align: center;
		transition:
			border-color 200ms var(--ease-out-quint),
			background 200ms var(--ease-out-quint);
	}

	.drop.dragging {
		border-color: var(--navy);
		background: var(--navy-soft);
	}

	.drop.busy {
		opacity: 0.7;
		cursor: progress;
	}

	.drop input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.drop-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--surface);
		border: 1px solid var(--hairline);
		color: var(--navy);
	}

	.drop-title {
		font-size: 14px;
		font-weight: 600;
	}

	.drop-hint {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--muted);
	}

	.failure {
		padding: 11px 13px;
		border-radius: var(--r-sm);
		background: var(--danger-tint);
		color: var(--danger);
		font-size: 12.5px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 13px;
		padding: 18px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	.card h3 {
		font-size: 20px;
		margin-top: 2px;
	}

	.lede,
	.note {
		margin-top: 4px;
		font-size: 12.5px;
		color: var(--ink-2);
		line-height: 1.5;
	}

	.note {
		color: var(--amber);
	}

	.chips,
	.classes {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.facts {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
	}

	.facts > div {
		display: flex;
		align-items: baseline;
		gap: 7px;
	}

	.facts dt {
		font-family: var(--font-mono);
		font-size: 9.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.facts dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 11.5px;
	}

	.choices {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
		gap: 14px;
	}

	fieldset {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 12px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		background: var(--surface-2);
	}

	legend {
		padding: 0 6px;
	}

	fieldset label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12.5px;
		color: var(--ink-2);
	}

	input[type='radio'] {
		accent-color: var(--ink);
	}

	.log {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.log-toggle {
		align-self: flex-start;
		font-size: 12px;
		color: var(--navy);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.log-list {
		margin: 0;
		padding: 12px 14px;
		list-style: none;
		border-radius: var(--r-sm);
		background: var(--surface-sunk);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-2);
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 220px;
		overflow-y: auto;
	}

	.log-list li {
		display: flex;
		gap: 10px;
	}

	.log-list span {
		color: var(--muted);
	}
</style>
