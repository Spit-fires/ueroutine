<script lang="ts">
	import { desk } from '#lib/model/store.svelte';
	import { DEFAULT_EXPORT, exportDayPng, type ExportOptions } from '#lib/export/png';
	import { SCENARIOS, runRoundTripSuite, simulateMessenger, type SuiteResult } from '#lib/diagnostics/roundtrip';
	import { importRoutineFromBlob, formatBytes, type ImportResult } from '#lib/import/import';
	import { longDate } from '#lib/model/types';

	let options = $state<ExportOptions>({ ...DEFAULT_EXPORT, ...desk.workspace.band });
	let suite = $state<SuiteResult | null>(null);
	let running = $state(false);
	let manual = $state<ImportResult | null>(null);
	let manualBusy = $state(false);
	let manualName = $state('');
	let showLog = $state(false);
	let openScenario = $state<string | null>(null);

	const day = $derived(desk.currentDay);

	async function runSuite() {
		running = true;
		suite = null;
		try {
			suite = await runRoundTripSuite(day, desk.workspace, options);
		} catch (error) {
			desk.flash(error instanceof Error ? error.message : 'The suite could not run', 'bad');
		} finally {
			running = false;
		}
	}

	// ?autorun runs the suite on load, so a headless browser can verify it.
	// ?day=YYYY-MM-DD tests a particular day instead of the one on screen.
	$effect(() => {
		if (typeof location === 'undefined') return;
		const params = new URLSearchParams(location.search);
		if (params.has('day')) {
			const match = desk.workspace.days.find((d) => d.date === params.get('day'));
			if (match) desk.setCurrentDay(match.id);
		}
		if (params.has('autorun')) {
			void runSuite();
		}
	});

	async function testFile(file: File) {
		manualBusy = true;
		manualName = file.name;
		manual = null;
		try {
			manual = await importRoutineFromBlob(file);
		} finally {
			manualBusy = false;
		}
	}

	async function downloadExport() {
		const exported = await exportDayPng(day, desk.workspace, options);
		const url = URL.createObjectURL(exported.blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = exported.filename;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 4000);
	}

	async function worstCase() {
		const exported = await exportDayPng(day, desk.workspace, options);
		const simulated = await simulateMessenger(exported.blob, SCENARIOS[SCENARIOS.length - 1]);
		const file = new File([simulated.blob], 'simulated-thumbnail.jpg', { type: 'image/jpeg' });
		await testFile(file);
	}

	async function copyReport() {
		if (!suite) return;
		await navigator.clipboard.writeText(suite.report);
		desk.flash('Report copied', 'good');
	}
</script>

<svelte:head>
	<title>Round-trip check · {desk.workspace.school}</title>
</svelte:head>

<div class="shell">
	<main class="page">
		<header class="head">
			<div>
				<a class="back" href="/">← back to the routine desk</a>
				<h1 class="display">Round-trip check</h1>
				<p class="lede">
					Exports {longDate(day.date)} with its data band, then re-encodes the image the way a chat app
					would and reads it back. A scenario only passes when the recovered payload is byte-identical to
					the one that was written.
				</p>
			</div>
			<div class="controls">
				<label class="row">
					<span>module size</span>
					<select bind:value={options.moduleSize}>
						<option value={0}>auto</option>
						<option value={6}>6 px</option>
						<option value={8}>8 px</option>
						<option value={10}>10 px</option>
						<option value={14}>14 px</option>
					</select>
				</label>
				<label class="row">
					<span>crispness</span>
					<select bind:value={options.scale}>
						<option value={1}>1×</option>
						<option value={2}>2×</option>
						<option value={3}>3×</option>
					</select>
				</label>
				<button class="btn btn-primary" type="button" disabled={running} onclick={runSuite}>
					{running ? 'Running…' : 'Run the suite'}
				</button>
				<button class="btn" type="button" onclick={downloadExport}>Download the PNG</button>
				<button class="btn" type="button" onclick={worstCase} disabled={manualBusy}>
					Test the worst case
				</button>
			</div>
		</header>

		{#if suite}
			<section class="summary reveal">
				<div class="score">
					<span class="display">{suite.requiredPassed}/{suite.requiredTotal}</span>
					<span class="eyebrow">required scenarios</span>
				</div>
				<dl class="facts">
					<div><dt>payload</dt><dd>{formatBytes(suite.exportReport.payloadBytes)} · {suite.exportReport.payloadChars} chars</dd></div>
					<div><dt>encoding</dt><dd>{suite.exportReport.compressed ? 'deflate-raw' : 'raw'}</dd></div>
					<div>
						<dt>band</dt>
						<dd>
							{suite.exportReport.bandCols}×{suite.exportReport.bandRows} modules ·
							{suite.exportReport.bandHeight ? `${Math.round(suite.exportReport.bandHeight)}px` : 'off'}
						</dd>
					</div>
					<div>
						<dt>modules</dt>
						<dd>
							{suite.exportReport.moduleSize}px{suite.exportReport.autoTuned ? ' auto' : ''} ·
							{suite.exportReport.pixelsPerModuleAfterCap.toFixed(1)}px after a 2048px cap
						</dd>
					</div>
					<div><dt>image</dt><dd>{suite.exportReport.imageWidth}×{suite.exportReport.imageHeight}px</dd></div>
				</dl>
			</section>

			<section class="results">
				{#each suite.results as result (result.scenario.name)}
					<article
						class="result reveal"
						class:pass={result.pass}
						class:fail={!result.pass && result.scenario.expectation === 'required'}
						class:stress={!result.pass && result.scenario.expectation === 'stress'}
					>
						<div class="result-head">
							<span class="badge">
								{result.pass
									? 'PASS'
									: result.scenario.expectation === 'stress'
										? 'BEST EFFORT'
										: 'FAIL'}
							</span>
							<h2>{result.scenario.name}</h2>
							<span class="ms">{result.milliseconds} ms</span>
						</div>
						<p class="result-note">{result.scenario.description}</p>
						<dl class="facts tight">
							<div><dt>read via</dt><dd>{result.source === 'png-text' ? 'png metadata' : result.source}</dd></div>
							<div><dt>decoder</dt><dd>{result.decoder}</dd></div>
							<div><dt>modules</dt><dd>{result.modulePixels ? `${result.modulePixels.toFixed(1)}px` : '—'}</dd></div>
							<div><dt>px per module</dt><dd>{result.pixelsPerModule.toFixed(1)}</dd></div>
							<div><dt>image</dt><dd>{formatBytes(result.bytes)}</dd></div>
						</dl>
						<p class="result-detail">{result.detail}</p>
						{#if result.log.length}
							<button
								class="btn btn-sm"
								type="button"
								onclick={() => (openScenario = openScenario === result.scenario.name ? null : result.scenario.name)}
							>
								{openScenario === result.scenario.name ? 'Hide' : 'Show'} scan log ({result.log.length})
							</button>
							{#if openScenario === result.scenario.name}
								<ol class="log-list">
									{#each result.log as line, index (index)}
										<li><span>{String(index + 1).padStart(2, '0')}</span>{line}</li>
									{/each}
								</ol>
							{/if}
						{/if}
					</article>
				{/each}
			</section>

			<section class="report">
				<div class="report-head">
					<span class="eyebrow">plain-text report</span>
					<button class="btn btn-sm" type="button" onclick={copyReport}>Copy</button>
				</div>
				<pre>{suite.report}</pre>
			</section>
		{/if}

		<section class="manual tray">
			<div class="tray-core">
				<div class="manual-body">
					<div>
						<span class="eyebrow">test your own image</span>
						<h2 class="display small">Try the picture you were actually sent</h2>
						<p class="lede">
							Drop the file that came through the chat — the JPEG from Messenger, the screenshot, the
							forwarded preview. Nothing is uploaded anywhere; the scan happens in this browser.
						</p>
					</div>
					<label
						class="drop"
						ondragover={(event) => event.preventDefault()}
						ondrop={(event) => {
							event.preventDefault();
							const file = event.dataTransfer?.files?.[0];
							if (file) void testFile(file);
						}}
					>
						<input
							type="file"
							accept="image/*"
							onchange={(event) => {
								const file = event.currentTarget.files?.[0];
								if (file) void testFile(file);
							}}
						/>
						<span>{manualBusy ? 'Scanning…' : 'Drop an image or click to choose'}</span>
						<span class="drop-hint">PNG · JPG · WebP</span>
					</label>
				</div>

				{#if manual}
					<div class="manual-result reveal">
						<div class="result-head">
							<span class="badge">{manual.routine ? 'PASS' : 'FAIL'}</span>
							<h2>{manualName}</h2>
						</div>
						<p class="result-detail">
							{manual.routine
								? `${manual.source === 'png-text' ? 'read from PNG metadata' : 'read from the data band'} · ${manual.routine.date} · ${manual.stats.modulePixels ? `${manual.stats.modulePixels.toFixed(1)}px modules · ` : ''}${manual.stats.decoder} · ${manual.stats.durationMs} ms`
								: (manual.error ?? 'nothing found')}
						</p>
						<button class="btn btn-sm" type="button" onclick={() => (showLog = !showLog)}>
							{showLog ? 'Hide' : 'Show'} the scan log ({manual.log.length})
						</button>
						{#if showLog}
							<ol class="log-list">
								{#each manual.log as line, index (index)}
									<li><span>{String(index + 1).padStart(2, '0')}</span>{line}</li>
								{/each}
							</ol>
						{/if}
					</div>
				{/if}
			</div>
		</section>

		<footer class="foot">
			<span>Scenarios simulated: {SCENARIOS.map((s) => s.name).join(' · ')}</span>
		</footer>
	</main>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 24px;
		max-width: 1180px;
		margin: 0 auto;
		padding: 30px 26px 60px;
	}

	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 26px;
		flex-wrap: wrap;
	}

	.back {
		font-family: var(--font-mono);
		font-size: 11px;
		text-decoration: none;
		color: var(--ink-3);
	}

	.head h1 {
		margin-top: 8px;
		font-size: clamp(30px, 5vw, 46px);
	}

	.lede {
		margin-top: 10px;
		max-width: 60ch;
		font-size: 13.5px;
		line-height: 1.6;
		color: var(--ink-2);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 7px;
		font-family: var(--font-mono);
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	.row select {
		height: 30px;
		padding: 0 7px;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
		font-family: var(--font-sans);
		font-size: 12.5px;
		letter-spacing: 0;
		text-transform: none;
		color: var(--ink);
	}

	.summary {
		display: flex;
		align-items: center;
		gap: 34px;
		flex-wrap: wrap;
		padding: 22px 26px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.score {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.score .display {
		font-size: 40px;
	}

	.facts {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 20px;
	}

	.facts > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
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
		font-size: 12px;
	}

	.facts.tight {
		gap: 16px;
	}

	.results {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 14px;
	}

	.result {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 18px;
		border: 1px solid var(--hairline);
		border-left: 3px solid var(--hairline-strong);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.result.pass {
		border-left-color: #6f9f78;
	}

	.result.fail {
		border-left-color: var(--danger);
		background: var(--danger-tint);
	}

	.result.stress {
		border-left-color: var(--hairline-strong);
		background: var(--surface-2);
	}

	.result-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.result-head h2 {
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.badge {
		font-family: var(--font-mono);
		font-size: 9.5px;
		letter-spacing: 0.12em;
		padding: 3px 7px;
		border-radius: 999px;
		background: var(--surface-sunk);
		color: var(--ink-2);
	}

	.pass .badge {
		background: var(--sage-tint);
		color: var(--sage);
	}

	.fail .badge {
		background: #f6d6d7;
		color: var(--danger);
	}

	.ms {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted);
	}

	.result-note {
		font-size: 12px;
		color: var(--ink-3);
	}

	.result-detail {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-2);
	}

	.report {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.report-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	pre {
		margin: 0;
		padding: 18px;
		border-radius: var(--r-md);
		background: var(--code);
		color: #e8e6e1;
		font-family: var(--font-mono);
		font-size: 11.5px;
		line-height: 1.6;
		overflow-x: auto;
		white-space: pre-wrap;
	}

	.manual-body {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 28px;
		padding: 22px 24px;
		flex-wrap: wrap;
	}

	.manual h2.small {
		margin-top: 6px;
		font-size: 21px;
	}

	.drop {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 20px 26px;
		border: 1.5px dashed var(--hairline-strong);
		border-radius: var(--r-md);
		background: var(--surface-2);
		font-size: 13px;
		cursor: pointer;
		transition: border-color 200ms var(--ease-out-quint);
	}

	.drop:hover {
		border-color: var(--navy);
	}

	.drop input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.drop-hint {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--muted);
	}

	.manual-result {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 0 24px 22px;
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
		max-height: 240px;
		overflow-y: auto;
	}

	.log-list li {
		display: flex;
		gap: 10px;
	}

	.log-list span {
		color: var(--muted);
	}

	.foot {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--muted);
	}
</style>
