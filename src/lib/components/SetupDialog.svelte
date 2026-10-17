<script lang="ts">
	import Dialog from './Dialog.svelte';
	import { desk } from '#lib/model/store.svelte';
	import type { Workspace } from '#lib/model/types';
	import { createInitialWorkspace } from '#lib/model/seed';
	import { downloadBlob } from '#lib/export/png';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	type Tab = 'subjects' | 'teachers' | 'data';
	let tab = $state<Tab>('subjects');
	let fileInput = $state<HTMLInputElement | null>(null);

	const ws = $derived(desk.workspace);

	function exportJson() {
		downloadBlob(
			new Blob([JSON.stringify(desk.toJSON(), null, 2)], { type: 'application/json' }),
			'utsaho-routine-workspace.json'
		);
	}

	async function importJson(file: File) {
		try {
			const parsed = JSON.parse(await file.text()) as Workspace;
			if (!Array.isArray(parsed.classes) || !Array.isArray(parsed.days)) {
				desk.flash('That file is not a routine workspace', 'bad');
				return;
			}
			desk.replaceWorkspace(parsed);
			desk.flash('Workspace restored from file', 'good');
		} catch {
			desk.flash('The JSON file could not be read', 'bad');
		}
	}
</script>

<Dialog
	title="Settings"
	eyebrow="subjects · teachers · data"
	lede="Two lists — subjects and teachers. Everything else (classes, period times) is managed on the home screen."
	size="lg"
	{onclose}
>
	<div class="tabs" role="tablist">
		{#each ['subjects', 'teachers', 'data'] as name (name)}
			<button
				class="tab"
				class:active={tab === name}
				type="button"
				role="tab"
				aria-selected={tab === name}
				onclick={() => (tab = name as Tab)}
			>
				{name}
			</button>
		{/each}
	</div>

	<div class="pane">
		{#if tab === 'subjects'}
			<section class="block">
				<div class="block-head">
					<span class="eyebrow">{ws.subjects.length} subjects</span>
					<form
						class="inline"
						onsubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							const name = String(data.get('subject') ?? '').trim();
							if (name) desk.addSubject(name);
							event.currentTarget.reset();
						}}
					>
						<input class="text-input sm" name="subject" placeholder="New subject" aria-label="New subject" />
						<button class="btn btn-sm" type="submit">Add</button>
					</form>
				</div>
				<ul class="rows">
					{#each ws.subjects as subject, index (subject)}
						<li>
							<span class="row-meta index">{index + 1}</span>
							<input
								class="text-input sm grow"
								value={subject}
								aria-label="Subject name"
								onchange={(event) => desk.renameSubject(subject, event.currentTarget.value)}
							/>
							<button class="btn btn-sm btn-danger" type="button" onclick={() => desk.removeSubject(subject)}>
								Remove
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if tab === 'teachers'}
			<section class="block">
				<div class="block-head">
					<span class="eyebrow">{ws.teachers.length} teachers</span>
					<form
						class="inline"
						onsubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							const name = String(data.get('teacher') ?? '').trim();
							if (name) desk.addTeacher(name);
							event.currentTarget.reset();
						}}
					>
						<input class="text-input sm" name="teacher" placeholder="Initials, e.g. SIH" aria-label="New teacher" />
						<button class="btn btn-sm" type="submit">Add</button>
					</form>
				</div>
				<p class="field-note">
					One name per teacher. When two teachers share a period, split the cell on the home screen
					into two entries instead.
				</p>
				<ul class="rows">
					{#each ws.teachers as teacher, index (teacher)}
						<li>
							<input
								class="text-input sm mono"
								value={teacher}
								aria-label="Teacher"
								onchange={(event) => desk.renameTeacher(teacher, event.currentTarget.value)}
							/>
							<span class="row-meta">{index + 1}</span>
							<div class="row-actions">
								<button class="btn btn-sm btn-danger" type="button" onclick={() => desk.removeTeacher(teacher)}>
									Remove
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if tab === 'data'}
			<section class="block">
				<span class="eyebrow">workspace file</span>
				<p class="field-note">
					A JSON file holds every day, class row, period label, subject and teacher. It is the belt-and-braces
					backup next to the PNG data band.
				</p>
				<div class="inline">
					<button class="btn btn-sm" type="button" onclick={exportJson}>Export workspace JSON</button>
					<button class="btn btn-sm" type="button" onclick={() => fileInput?.click()}>
						Import workspace JSON
					</button>
					<input
						bind:this={fileInput}
						class="hidden-input"
						type="file"
						accept="application/json,.json"
						onchange={(event) => {
							const file = event.currentTarget.files?.[0];
							if (file) void importJson(file);
						}}
					/>
				</div>
			</section>

			<section class="block">
				<span class="eyebrow">danger zone</span>
				<div class="inline">
					<button
						class="btn btn-sm"
						type="button"
						onclick={() => {
							desk.replaceWorkspace(createInitialWorkspace(desk.currentDay.date));
							desk.flash('Desk reset to its starting state — Ctrl Z to undo', 'info');
						}}
					>
						Reset the desk
					</button>
					<button
						class="btn btn-sm btn-danger"
						type="button"
						onclick={() => {
							window.localStorage.removeItem('utsaho.routine-desk.v1');
							desk.flash('Saved copy cleared — reload to start fresh', 'warn');
						}}
					>
						Clear the saved copy
					</button>
				</div>
				<p class="field-note">
					Everything lives in this browser's own storage: no account, no server, nothing leaves the machine.
				</p>
			</section>
		{/if}
	</div>
</Dialog>

<style>
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 20px;
		padding: 3px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		background: var(--surface-2);
		width: max-content;
		max-width: 100%;
	}

	.tab {
		padding: 6px 13px;
		border-radius: var(--r-xs);
		font-size: 12.5px;
		font-weight: 500;
		color: var(--ink-3);
		text-transform: capitalize;
		transition:
			background 200ms var(--ease-out-quint),
			color 200ms var(--ease-out-quint);
	}

	.tab.active {
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 1px 2px rgba(20, 22, 26, 0.06);
	}

	.pane {
		display: flex;
		flex-direction: column;
		gap: 22px;
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.block-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		flex-wrap: wrap;
	}

	.field-note {
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--muted);
	}

	.text-input {
		height: 34px;
		padding: 0 10px;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
		font-size: 13px;
		width: 100%;
	}

	.text-input.sm {
		height: 30px;
		font-size: 12.5px;
	}

	.text-input.mono {
		font-family: var(--font-mono);
	}

	.text-input.grow {
		flex: 1;
	}

	.inline {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}

	.inline .text-input {
		width: auto;
		min-width: 110px;
	}

	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.rows li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		background: var(--surface-2);
	}

	.row-meta {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--muted);
		margin-left: auto;
	}

	.row-meta.index {
		margin: 0;
		width: 22px;
		text-align: right;
	}

	.row-actions {
		display: flex;
		gap: 5px;
		margin-left: auto;
	}

	.rows li .row-actions {
		margin-left: 0;
	}

	.hidden-input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
</style>
