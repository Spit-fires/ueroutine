<script lang="ts">
	import Combobox from './Combobox.svelte';
	import { desk, splitTeachers } from '#lib/model/store.svelte';
	import { className, type Entry } from '#lib/model/types';

	let subjectToken = $state(0);
	let teacherToken = $state(0);
	let subjectBToken = $state(0);
	let teacherBToken = $state(0);
	let lastFocus = 0;

	const selection = $derived(desk.selection);
	const cell = $derived(desk.selectedCell);
	const row = $derived(selection ? desk.classById(selection.classId) : undefined);
	const day = $derived(desk.currentDay);
	const entryA = $derived(cell?.entries[0]);
	const entryB = $derived(cell?.entries[1]);
	const dual = $derived((cell?.entries?.length ?? 0) > 1);

	/** Subjects already used today, most used first — one click fills the cell. */
	const frequent = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const classRow of desk.classes) {
			for (const cellValue of day?.grid[classRow.id] ?? []) {
				for (const entry of cellValue.entries) {
					if (!entry.subject) continue;
					counts.set(entry.subject, (counts.get(entry.subject) ?? 0) + 1);
				}
			}
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, 8)
			.map(([subject]) => subject);
	});

	$effect(() => {
		const token = desk.focusInspector;
		if (token === lastFocus) return;
		lastFocus = token;
		const entry = desk.selectedCell?.entries[0];
		if (entry?.subject && !entry.teacher) teacherToken++;
		else subjectToken++;
	});

	function setField(index: number, field: keyof Entry, value: string) {
		desk.setEntry(index, field, value);
	}

	function step(delta: 1 | -1) {
		desk.moveSelection(delta, 0);
		desk.focusInspector++;
	}

	/** Enter walks down the cell: subject → teacher → next period. */
	function nextPeriod() {
		desk.moveSelection(1, 0);
		desk.focusInspector++;
	}

	function createSubject(name: string) {
		desk.addSubject(name);
	}

	function createTeacher(name: string) {
		desk.addTeacher(name);
	}
</script>

<aside class="inspector">
	{#if !selection || !row}
		<div class="empty reveal">
			<span class="eyebrow">no cell selected</span>
			<h2 class="display title">Pick a cell to edit its period.</h2>
			<p class="lede">
				Every cell holds a subject on top and a teacher underneath — or two entries, which splits it
				into four quadrants.
			</p>
			<ul class="keys">
				<li><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> move</li>
				<li><kbd>Enter</kbd> focus the fields</li>
				<li><kbd>Tab</kbd> jump to the next period</li>
				<li>
					<kbd>B</kbd> blacken · <kbd>Y</kbd> yellow · <kbd>R</kbd> red · <kbd>Del</kbd> clear
				</li>
			</ul>
		</div>
	{:else}
		<header class="head reveal">
			<div class="head-top">
				<span class="eyebrow">
					period {selection.period + 1} of {desk.periods.length} · {desk.periods[selection.period]}
				</span>
				<span class="head-group">
					{selection.period < desk.workspace.groupSplit
						? desk.workspace.groupNames[0]
						: desk.workspace.groupNames[1]}
				</span>
			</div>
			<h2 class="display title">{className(row)}</h2>
			<div class="head-chips">
				{#if cell?.mark === 'black'}<span class="chip chip-navy">black cell</span>{/if}
				{#if cell?.mark === 'yellow'}<span class="chip chip-amber">yellow cell</span>{/if}
				{#if cell?.mark === 'red'}<span class="chip chip-danger">red cell</span>{/if}
				{#if dual}<span class="chip chip-sage">two entries</span>{/if}
				{#if cell && splitTeachers(entryA?.teacher ?? '').length > 1}
					<span class="chip chip-amber">co-taught</span>
				{/if}
			</div>
		</header>

		<hr class="rule" />

		<section class="entry">
			<div class="entry-head">
				<span class="eyebrow">{dual ? 'entry one · top left' : 'entry'}</span>
			</div>
			<label class="label" for="subject-a">Subject</label>
			<Combobox
				value={entryA?.subject ?? ''}
				options={desk.workspace.subjects}
				placeholder="e.g. Math, E2 Exam, BGS"
				ariaLabel="Subject"
				focusToken={subjectToken}
				onchange={(value) => setField(0, 'subject', value)}
				oncreate={createSubject}
				onstep={step}
				oncommit={() => teacherToken++}
			/>
			<label class="label" for="teacher-a">Teacher</label>
			<Combobox
				value={entryA?.teacher ?? ''}
				options={desk.workspace.teachers}
				placeholder="e.g. SIH, OFF"
				ariaLabel="Teacher"
				mono
				focusToken={teacherToken}
				onchange={(value) => setField(0, 'teacher', value)}
				oncreate={createTeacher}
				onstep={step}
				oncommit={nextPeriod}
			/>
		</section>

		{#if dual}
			<section class="entry reveal">
				<div class="entry-head">
					<span class="eyebrow">entry two · top right</span>
					<button class="link" type="button" onclick={() => desk.removeEntry(1)}>remove</button>
				</div>
				<label class="label" for="subject-b">Subject</label>
				<Combobox
					value={entryB?.subject ?? ''}
					options={desk.workspace.subjects}
					placeholder="Second subject"
					ariaLabel="Second subject"
					onchange={(value) => setField(1, 'subject', value)}
					oncreate={createSubject}
					oncommit={() => teacherBToken++}
				/>
				<label class="label" for="teacher-b">Teacher</label>
				<Combobox
					value={entryB?.teacher ?? ''}
					options={desk.workspace.teachers}
					placeholder="Second teacher"
					ariaLabel="Second teacher"
					mono
					onchange={(value) => setField(1, 'teacher', value)}
					oncreate={createTeacher}
					oncommit={nextPeriod}
				/>
			</section>
		{:else}
			<section class="entry ghost">
				<div class="entry-head">
					<span class="eyebrow">entry two</span>
				</div>
				<p class="ghost-note">
					Slots two subjects share this period? Split the cell into four quadrants — subjects on
					top, teachers underneath.
				</p>
				<button class="btn btn-sm" type="button" onclick={() => desk.addEntry()}
					>Split into two</button
				>
			</section>
		{/if}

		<section class="actions">
			<button
				class="btn btn-sm"
				class:btn-primary={cell?.mark === 'black'}
				type="button"
				onclick={() => desk.toggleMark('black')}
				title="Black marks a slot that lives inside a code"
			>
				Blacken
			</button>
			<button
				class="btn btn-sm"
				class:btn-primary={cell?.mark === 'yellow'}
				type="button"
				onclick={() => desk.toggleMark('yellow')}
				title="Highlight the cell yellow — press again to clear the mark"
			>
				Yellow
			</button>
			<button
				class="btn btn-sm"
				class:btn-primary={cell?.mark === 'red'}
				type="button"
				onclick={() => desk.toggleMark('red')}
				title="Highlight the cell red — press again to clear the mark"
			>
				Red
			</button>
			<button class="btn btn-sm" type="button" onclick={() => desk.copyCell()}>Copy</button>
			<button
				class="btn btn-sm"
				type="button"
				disabled={!desk.clipboard}
				onclick={() => desk.pasteCell()}
			>
				Paste
			</button>
			<button class="btn btn-sm btn-danger" type="button" onclick={() => desk.clearCell()}>
				Clear
			</button>
		</section>

		{#if frequent.length && !entryA?.subject}
			<section class="quick reveal">
				<span class="eyebrow">used elsewhere today</span>
				<div class="quick-row">
					{#each frequent as subject (subject)}
						<button
							class="chip chip-navy quick-chip"
							type="button"
							onclick={() => setField(0, 'subject', subject)}
						>
							{subject}
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<footer class="foot">
			<p>
				<kbd>Tab</kbd> next period · <kbd>Shift</kbd>+<kbd>Tab</kbd> previous ·
				<kbd>B</kbd> black · <kbd>Y</kbd> yellow · <kbd>R</kbd> red
			</p>
		</footer>
	{/if}
</aside>

<style>
	.inspector {
		display: flex;
		flex-direction: column;
		gap: 16px;
		width: 100%;
		height: 100%;
		padding: 18px 18px 22px;
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
	}

	.empty {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: 8px;
	}

	.title {
		font-size: 26px;
		max-width: 16ch;
	}

	.lede {
		font-size: 13px;
		color: var(--ink-2);
		line-height: 1.55;
	}

	.keys {
		margin: 4px 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
		color: var(--ink-3);
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.head-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.head-group {
		font-family: var(--font-mono);
		font-size: 9.5px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.head-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.entry {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: var(--surface-2);
	}

	.entry.ghost {
		background: transparent;
		border-style: dashed;
		align-items: flex-start;
		gap: 8px;
	}

	.ghost-note {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--ink-3);
	}

	.entry-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 2px;
	}

	.label {
		font-size: 11px;
		font-weight: 600;
		color: var(--ink-3);
		margin-top: 2px;
	}

	.link {
		font-size: 11.5px;
		color: var(--danger);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.quick {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.quick-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.quick-chip {
		cursor: pointer;
		transition: transform 160ms var(--ease-swift);
	}

	.quick-chip:hover {
		transform: translateY(-1px);
	}

	.foot {
		margin-top: auto;
		padding-top: 12px;
		border-top: 1px solid var(--hairline);
		font-size: 11.5px;
		color: var(--muted);
	}
</style>
