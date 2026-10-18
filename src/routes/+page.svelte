<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import ManageBar from '#lib/components/ManageBar.svelte';
	import RoutineGrid from '#lib/components/RoutineGrid.svelte';
	import Inspector from '#lib/components/Inspector.svelte';
	import ExportDialog from '#lib/components/ExportDialog.svelte';
	import ImportDialog from '#lib/components/ImportDialog.svelte';
	import SetupDialog from '#lib/components/SetupDialog.svelte';
	import { desk } from '#lib/model/store.svelte';
	import { longDate } from '#lib/model/types';

	let dialog = $state<'none' | 'export' | 'import' | 'setup'>('none');
	let ready = $state(false);

	const day = $derived(desk.currentDay);
	const stats = $derived(desk.stats(day?.id));

	onMount(() => {
		requestAnimationFrame(() => (ready = true));
	});

	// Persist whenever anything in the workspace changes.
	$effect(() => {
		void JSON.stringify(desk.workspace);
		desk.persist();
	});
</script>

<svelte:head>
	<title>{desk.workspace.school} · routine desk</title>
</svelte:head>

<div class="shell" class:ready>
	<main class="page">
		<Toolbar
			onexport={() => (dialog = 'export')}
			onimport={() => (dialog = 'import')}
			onsetup={() => (dialog = 'setup')}
		/>

		<ManageBar />

		<section class="work">
			<div class="canvas">
				{#if day}
					<RoutineGrid {day} />
				{/if}
			</div>
			<div class="rail">
				<Inspector />
			</div>
		</section>

		<footer class="status">
			<div class="status-left">
				<span class="eyebrow">{longDate(day.date)}</span>
				<span class="status-sep">·</span>
				<span class="status-item">{stats.filled} filled</span>
				<span class="status-item">{stats.dual} split into two</span>
				<span class="status-item">{stats.marked} marked</span>
			</div>
			<div class="status-right">
				<a href="/diagnostics">round-trip check</a>
				<span class="status-sep">·</span>
				<span class="status-item">saved in this browser</span>
			</div>
		</footer>
	</main>

	{#if dialog === 'export'}
		<ExportDialog
			{day}
			onclose={() => (dialog = 'none')}
			ondiagnostics={() => goto('/diagnostics')}
		/>
	{/if}
	{#if dialog === 'import'}
		<ImportDialog onclose={() => (dialog = 'none')} />
	{/if}
	{#if dialog === 'setup'}
		<SetupDialog onclose={() => (dialog = 'none')} />
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
		min-height: 0;
		padding: 26px 26px 18px;
	}

	.work {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 336px;
		gap: 14px;
		flex: 1;
		min-height: 0;
	}

	.canvas {
		display: flex;
		min-height: 0;
		opacity: 0;
		transform: translateY(8px);
		transition:
			opacity 420ms var(--ease-out-quint),
			transform 520ms var(--ease-out-quint);
	}

	.rail {
		display: flex;
		min-height: 0;
		opacity: 0;
		transform: translateY(14px);
		transition:
			opacity 420ms var(--ease-out-quint) 90ms,
			transform 520ms var(--ease-out-quint) 90ms;
	}

	.ready .canvas,
	.ready .rail {
		opacity: 1;
		transform: none;
	}

	.status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		padding: 10px 4px 0;
		border-top: 1px solid var(--hairline);
		font-size: 11.5px;
		color: var(--ink-3);
		flex-wrap: wrap;
	}

	.status-left,
	.status-right {
		display: flex;
		align-items: center;
		gap: 9px;
		flex-wrap: wrap;
	}

	.status-item {
		color: var(--ink-3);
	}

	.status-sep {
		color: var(--hairline-strong);
	}

	@media (max-width: 1080px) {
		.page {
			padding: 18px 14px 14px;
		}

		.work {
			grid-template-columns: minmax(0, 1fr);
		}

		.rail {
			min-height: 420px;
		}
	}

	@media (max-width: 760px) {
		.page {
			padding: 10px;
			gap: 8px;
		}

		.work {
			gap: 8px;
		}
	}
</style>
