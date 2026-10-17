<script lang="ts">
	import { desk } from '#lib/model/store.svelte';

	const ws = $derived(desk.workspace);
	const day = $derived(desk.currentDay);
	let startTime = $state(desk.periods[0] ?? '9:00 AM');
	let step = $state(30);
</script>

<section class="manage">
	<div class="group">
		<span class="label">Classes</span>
		<div class="chips">
			{#each ws.classes as row (row.id)}
				<div class="chip">
					<input
						class="grade"
						value={row.grade}
						aria-label="Class grade"
						onchange={(e) => desk.updateClass(row.id, { grade: e.currentTarget.value.trim() })}
					/>
					<input
						class="school"
						value={row.school === 'All' ? '' : row.school}
						placeholder="All"
						aria-label={`School for class ${row.grade}`}
						onchange={(e) =>
							desk.updateClass(row.id, { school: e.currentTarget.value.trim() || 'All' })}
					/>
					<button
						class="x"
						type="button"
						title="Remove class"
						aria-label={`Remove class ${row.grade}`}
						disabled={ws.classes.length <= 1}
						onclick={() => desk.removeClass(row.id)}>×</button
					>
				</div>
			{/each}
			<button class="add" type="button" onclick={() => desk.addClass()}>+ Add</button>
		</div>
	</div>

	<div class="group">
		<span class="label">Periods</span>
		<div class="chips">
			<input class="mini" bind:value={startTime} aria-label="First period time" />
			<input
				class="mini num"
				type="number"
				min="5"
				max="180"
				bind:value={step}
				aria-label="Minutes per period"
			/>
			<button
				class="act"
				type="button"
				onclick={() => {
					desk.regeneratePeriods(startTime, Math.max(5, Math.min(180, step)));
					desk.flash('Period labels rebuilt', 'good');
				}}>Rebuild</button
			>
			<button
				class="act ghost"
				type="button"
				onclick={() => {
					desk.clearDay(day.id);
					desk.flash('Day cleared — Ctrl Z to undo', 'info');
				}}>Clear day</button
			>
		</div>
	</div>
</section>

<style>
	.manage {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 22px;
		padding: 10px 12px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-sm);
		background: var(--surface);
	}

	.group {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
	}

	.label {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
		white-space: nowrap;
	}

	.chips {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px;
		min-width: 0;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 30px;
		padding: 0 6px 0 10px;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--r-sm);
		background: var(--surface-2);
	}

	.grade {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 14px;
		width: 3.2ch;
		padding: 0;
		border: none;
		background: transparent;
		text-align: center;
	}

	.grade:focus {
		outline: none;
		background: var(--surface);
		border-radius: var(--r-xs);
	}

	.school {
		width: 7ch;
		height: 22px;
		padding: 0 3px;
		border: none;
		background: transparent;
		font-family: var(--font-mono);
		font-size: 10.5px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--navy);
	}

	.school::placeholder {
		color: var(--muted);
	}

	.school:focus {
		outline: none;
		background: var(--surface);
		border-radius: var(--r-xs);
	}

	.x {
		width: 20px;
		height: 20px;
		display: grid;
		place-items: center;
		border-radius: var(--r-xs);
		font-size: 14px;
		line-height: 1;
		color: var(--muted);
		transition:
			background 140ms var(--ease-out-quint),
			color 140ms var(--ease-out-quint);
	}

	.x:hover:not(:disabled) {
		background: var(--danger-tint);
		color: var(--danger);
	}

	.x:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.add {
		height: 30px;
		padding: 0 10px;
		border: 1px dashed var(--hairline-strong);
		border-radius: var(--r-sm);
		font-size: 12px;
		font-weight: 500;
		color: var(--ink-3);
		transition:
			background 140ms var(--ease-out-quint),
			color 140ms var(--ease-out-quint);
	}

	.add:hover {
		background: var(--surface-sunk);
		color: var(--ink);
	}

	.mini {
		height: 30px;
		width: 90px;
		padding: 0 8px;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: 11.5px;
	}

	.mini.num {
		width: 60px;
	}

	.act {
		height: 30px;
		padding: 0 11px;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--r-sm);
		font-size: 12px;
		font-weight: 500;
		transition: background 140ms var(--ease-out-quint);
	}

	.act:hover {
		background: var(--surface-sunk);
	}

	.act.ghost {
		border-color: transparent;
		color: var(--muted);
	}

	@media (max-width: 760px) {
		.manage {
			gap: 10px;
		}

		.group {
			width: 100%;
			flex-direction: column;
			align-items: flex-start;
			gap: 6px;
		}
	}
</style>
