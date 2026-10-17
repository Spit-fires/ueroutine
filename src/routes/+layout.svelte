<script lang="ts">
	import '@fontsource-variable/instrument-sans';
	import '@fontsource-variable/fraunces';
	import '@fontsource-variable/jetbrains-mono';
	import '../app.css';

	import favicon from '#lib/assets/favicon.svg';
	import { desk } from '#lib/model/store.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<div class="toasts" aria-live="polite">
	{#each desk.notices as notice (notice.id)}
		<div class="toast tone-{notice.tone}">
			<span class="toast-mark" aria-hidden="true"></span>
			<span>{notice.message}</span>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		left: 50%;
		bottom: 28px;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: 60;
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 15px;
		background: var(--ink);
		color: #f7f6f3;
		border-radius: 999px;
		font-size: 12.5px;
		box-shadow: 0 10px 30px rgba(20, 22, 26, 0.16);
		animation: toast-in 260ms var(--ease-out-quint) both;
	}

	.toast-mark {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #f7f6f3;
	}

	.tone-good .toast-mark {
		background: #8fd39a;
	}

	.tone-warn .toast-mark {
		background: #e3b768;
	}

	.tone-bad .toast-mark {
		background: #ef8a86;
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@media print {
		.toasts {
			display: none;
		}
	}
</style>
