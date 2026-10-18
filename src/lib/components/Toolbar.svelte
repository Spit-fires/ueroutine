<script lang="ts">
	import { desk } from '#lib/model/store.svelte';
	import { fullDate, weekdayName, type Day } from '#lib/model/types';

	interface Props {
		onexport: () => void;
		onimport: () => void;
		onsetup: () => void;
	}

	let { onexport, onimport, onsetup }: Props = $props();

	const day = $derived<Day>(desk.currentDay);
	let dateInput = $state<HTMLInputElement | null>(null);

	function pickDate(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		if (value && value !== day.date) {
			desk.goToDate(value);
			desk.flash(`Jumped to ${weekdayName(value)}, ${fullDate(value)}`, 'good');
		}
	}

	function openPicker() {
		try {
			dateInput?.showPicker();
		} catch {
			dateInput?.click();
		}
	}
</script>

<header class="bar">
	<div class="brand">
		<h1 class="display">{desk.workspace.school}</h1>
	</div>

	<div class="nav">
		<span class="weekday">{weekdayName(day.date)}</span>
		<button class="day-btn" type="button" onclick={openPicker} aria-label="Pick day">
			<span class="day-text">{fullDate(day.date)}</span>
			<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
				<rect
					x="1.5"
					y="2.5"
					width="13"
					height="12"
					rx="2"
					fill="none"
					stroke="currentColor"
					stroke-width="1.2"
				/>
				<path
					d="M1.5 6h13M5 1v3M11 1v3"
					fill="none"
					stroke="currentColor"
					stroke-width="1.2"
					stroke-linecap="round"
				/>
			</svg>
		</button>
		<input
			bind:this={dateInput}
			class="day-input"
			type="date"
			value={day.date}
			onchange={pickDate}
			aria-label="Pick day"
			tabindex="-1"
			aria-hidden="true"
		/>
	</div>

	<div class="actions">
		<button class="btn" type="button" onclick={onimport}>Import</button>
		<button class="btn btn-primary" type="button" onclick={onexport}>Export PNG</button>
		<button
			class="btn btn-icon"
			type="button"
			onclick={onsetup}
			title="Settings"
			aria-label="Settings"
		>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
				<path
					d="M8 5.4a2.6 2.6 0 100 5.2 2.6 2.6 0 000-5.2zM8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M12.95 3.05l-1.13 1.13M4.18 11.82l-1.13 1.13"
					fill="none"
					stroke="currentColor"
					stroke-width="1.2"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	</div>
</header>

<style>
	.bar {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 22px;
		padding: 0 2px 14px;
	}

	.brand {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.brand h1 {
		font-family: var(--font-display);
		font-weight: 700;
		color: #e00000;
		letter-spacing: -0.02em;
		font-size: clamp(22px, 2.6vw, 30px);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.nav {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.weekday {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--navy);
	}

	.day-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		padding: 0 10px;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--ink);
		transition: background 140ms var(--ease-out-quint);
	}

	.day-btn:hover {
		background: var(--surface-2);
	}

	.day-input {
		position: absolute;
		left: 0;
		bottom: 0;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	@media (max-width: 1180px) {
		.bar {
			align-items: flex-start;
			flex-direction: column;
			gap: 14px;
		}

		.actions {
			width: 100%;
		}
	}

	@media (max-width: 760px) {
		.bar {
			padding: 0 0 10px;
			gap: 10px;
		}

		.nav {
			gap: 6px;
		}
	}
</style>
