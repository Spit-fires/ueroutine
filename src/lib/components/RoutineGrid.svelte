<script lang="ts">
	import { desk } from '#lib/model/store.svelte';
	import type { Cell, ClassRow, Day } from '#lib/model/types';

	interface Props {
		day: Day;
	}

	let { day }: Props = $props();

	const periods = $derived(desk.periods);
	const classes = $derived(desk.classes);
	const split = $derived(Math.max(1, Math.min(desk.workspace.groupSplit, periods.length)));
	const template = $derived(
		`var(--rowhead, 132px) repeat(${periods.length}, minmax(var(--cell-min, 96px), 1fr))`
	);
	const rowTag = (row: ClassRow) => row.school ?? '';
	const isSelected = (classId: string, period: number) =>
		desk.selection?.dayId === day.id &&
		desk.selection.classId === classId &&
		desk.selection.period === period;

	function pick(classId: string, period: number, focus = true) {
		desk.select({ dayId: day.id, classId, period });
		if (focus) desk.focusInspector++;
	}

	function entries(cell: Cell | undefined) {
		return (cell?.entries ?? []).filter((entry) => entry.subject || entry.teacher);
	}
</script>

<div class="wrap scroll-y">
	<div class="grid" style="grid-template-columns: {template}">
		<div class="corner">
			<span class="eyebrow">class</span>
			<span class="corner-sub">{classes.length} rows</span>
		</div>

		{#each periods as label, index (index)}
			<div
				class="head"
				class:head-a={index < split}
				class:head-b={index >= split}
				title={`Period ${index + 1} · ${label}`}
			>
				<span class="head-time">{label}</span>
				<span class="head-index">{index + 1}</span>
			</div>
		{/each}

		{#each classes as row (row.id)}
			<div class="rowhead">
				<div class="rowhead-line">
					<span class="rowhead-grade">{row.grade}</span>
					<span class="rowhead-section">{rowTag(row)}</span>
				</div>
			</div>

			{#each periods as label, index (index)}
				{@const cell = day.grid[row.id]?.[index]}
				{@const list = entries(cell)}
				<button
					class="cell"
					class:group-a={index < split}
					class:group-b={index >= split}
					class:black={cell?.mark === 'black'}
					class:yellow={cell?.mark === 'yellow'}
					class:red={cell?.mark === 'red'}
					class:dual={list.length > 1}
					class:selected={isSelected(row.id, index)}
					class:is-break={list.some((entry) => entry.subject.trim().toUpperCase() === 'BREAK')}
					aria-label={`${row.grade} ${rowTag(row)}, period ${index + 1} ${label}`}
					title={list.length
						? list.map((entry) => `${entry.subject || '—'} / ${entry.teacher || '—'}`).join('  +  ')
						: 'Empty cell'}
					onclick={() => pick(row.id, index)}
					ondblclick={() => pick(row.id, index, true)}
				>
					{#if list.length > 1}
						{#each list.slice(0, 2) as entry, entryIndex (entryIndex)}
							<span class="quad">
								<span class="subject">{entry.subject}</span>
								<span class="teacher">{entry.teacher}</span>
							</span>
						{/each}
					{:else if list.length === 1}
						<span class="subject">{list[0].subject}</span>
						<span class="teacher">{list[0].teacher}</span>
					{:else if cell?.mark === 'black'}
						<span class="code-mark">code</span>
					{:else if cell && cell.mark !== 'none'}
						<span aria-hidden="true"></span>
					{:else}
						<span class="vacant" aria-hidden="true"></span>
					{/if}
				</button>
			{/each}
		{/each}
	</div>
</div>

<style>
	.wrap {
		flex: 1;
		min-height: 0;
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		overflow: auto;
	}

	.grid {
		display: grid;
		min-width: max-content;
		align-content: start;
	}

	.corner {
		position: sticky;
		top: 0;
		left: 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		height: 56px;
		padding: 0 14px;
		background: var(--surface);
		border-right: 1px solid var(--hairline);
		border-bottom: 2px solid var(--rule);
	}

	.corner-sub {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--muted);
	}

	.head {
		position: sticky;
		top: 0;
		z-index: 3;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		height: 56px;
		background: var(--navy);
		border-right: 1.5px solid rgba(255, 255, 255, 0.38);
		border-bottom: 2px solid var(--rule);
	}

	.head-a,
	.head-b {
		background: var(--navy);
	}

	.grid > .head:nth-child(2) {
		background: var(--red);
	}

	.head-time {
		font-size: 12.5px;
		font-weight: 600;
		color: #ffffff;
	}

	.head-index {
		font-family: var(--font-mono);
		font-size: 10px;
		color: rgba(255, 255, 255, 0.55);
	}

	.rowhead {
		position: sticky;
		left: 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		height: 78px;
		padding: 0 14px;
		background: var(--surface);
		border-right: 1.5px solid rgba(20, 22, 26, 0.45);
		border-bottom: 1.5px solid rgba(20, 22, 26, 0.45);
	}

	.rowhead-line {
		display: flex;
		align-items: baseline;
		gap: 7px;
	}

	.rowhead-grade {
		font-family: var(--font-display);
		font-size: 21px;
		font-weight: 500;
		letter-spacing: -0.02em;
	}

	.rowhead-section {
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--navy);
	}

	.cell {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		height: 78px;
		padding: 6px 8px;
		overflow: hidden;
		text-align: center;
		/* Bold period borders — only the two sharing seams, so every line
		   stays one width. The in-cell divider between split entries keeps
		   its own thin rule. */
		border-right: 1.5px solid rgba(20, 22, 26, 0.45);
		border-bottom: 1.5px solid rgba(20, 22, 26, 0.45);
		transition:
			background 200ms var(--ease-out-quint),
			box-shadow 200ms var(--ease-out-quint);
	}

	.group-a {
		background: var(--group-a);
	}

	.group-b {
		background: var(--group-b);
	}

	.cell:hover {
		background: var(--group-a-deep);
	}

	.group-b.cell:hover {
		background: var(--group-b-deep);
	}

	.cell.dual {
		flex-direction: row;
		align-items: stretch;
		gap: 0;
		padding: 0;
	}

	.quad {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		padding: 4px 3px;
		min-width: 0;
	}

	.quad + .quad {
		border-left: 1px solid rgba(20, 22, 26, 0.16);
	}

	.subject {
		font-size: 13.5px;
		font-weight: 600;
		line-height: 1.15;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dual .subject {
		font-size: 11.5px;
	}

	.teacher {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-3);
		letter-spacing: 0.02em;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dual .teacher {
		font-size: 10px;
	}

	.cell.is-break {
		background: var(--amber-tint);
	}

	.cell.black {
		background: var(--code);
		border-color: rgba(255, 255, 255, 0.22);
	}

	.cell.yellow {
		background: var(--mark-yellow);
	}

	.cell.red {
		background: var(--mark-red);
	}

	.cell.black .subject {
		color: var(--code-ink);
	}

	.cell.black .teacher {
		color: rgba(246, 245, 242, 0.7);
	}

	.code-mark {
		font-family: var(--font-mono);
		font-size: 9.5px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.5);
	}

	.vacant {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: rgba(20, 22, 26, 0.14);
		transition:
			transform 200ms var(--ease-out-quint),
			background 200ms var(--ease-out-quint);
	}

	.cell:hover .vacant {
		transform: scale(2.2);
		background: rgba(20, 22, 26, 0.28);
	}

	.cell.selected {
		z-index: 1;
		box-shadow:
			inset 0 0 0 2px var(--navy),
			0 6px 18px rgba(27, 42, 74, 0.12);
	}

	@media (max-width: 760px) {
		.grid {
			--rowhead: 96px;
			--cell-min: 82px;
		}

		.corner,
		.head {
			height: 40px;
		}

		.rowhead,
		.cell {
			height: 52px;
		}

		.cell {
			padding: 3px 4px;
		}

		.subject {
			font-size: 11.5px;
		}

		.teacher {
			font-size: 10px;
		}

		.rowhead-grade {
			font-size: 15px;
		}

		.rowhead-section {
			font-size: 9px;
		}

		.corner,
		.rowhead {
			padding: 0 8px;
		}
	}
</style>
