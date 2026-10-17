<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		eyebrow?: string;
		lede?: string;
		size?: 'sm' | 'md' | 'lg';
		onclose: () => void;
		children: Snippet;
		footer?: Snippet;
	}

	let { title, eyebrow, lede, size = 'md', onclose, children, footer }: Props = $props();

	$effect(() => {
		const onkey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onclose();
		};
		window.addEventListener('keydown', onkey);
		return () => window.removeEventListener('keydown', onkey);
	});
</script>

<div class="scrim" role="presentation" onclick={(event) => event.target === event.currentTarget && onclose()}>
	<div class="panel" class:sm={size === 'sm'} class:lg={size === 'lg'} role="dialog" aria-modal="true" aria-label={title}>
		<header class="head">
			<div>
				{#if eyebrow}<span class="eyebrow">{eyebrow}</span>{/if}
				<h2 class="display">{title}</h2>
				{#if lede}<p class="lede">{lede}</p>{/if}
			</div>
			<button class="close" type="button" onclick={onclose} aria-label="Close">
				<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
					<path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.3" fill="none" />
				</svg>
			</button>
		</header>
		<div class="body scroll-y">
			{@render children()}
		</div>
		{#if footer}
			<footer class="foot">{@render footer()}</footer>
		{/if}
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 32px 20px;
		background: rgba(20, 22, 26, 0.34);
		backdrop-filter: blur(3px);
		animation: fade 200ms var(--ease-out-quint) both;
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.panel {
		display: flex;
		flex-direction: column;
		width: min(720px, 100%);
		max-height: min(88dvh, 900px);
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--r-xl);
		box-shadow: 0 32px 80px rgba(20, 22, 26, 0.26);
		animation: rise 320ms var(--ease-out-quint) both;
		overflow: hidden;
	}

	.panel.sm {
		width: min(540px, 100%);
	}

	.panel.lg {
		width: min(1000px, 100%);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(14px) scale(0.99);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 18px;
		padding: 24px 26px 18px;
		border-bottom: 1px solid var(--hairline);
	}

	.head h2 {
		font-size: 23px;
		margin-top: 3px;
	}

	.lede {
		margin-top: 6px;
		max-width: 62ch;
		font-size: 13px;
		color: var(--ink-2);
		line-height: 1.55;
	}

	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		color: var(--ink-3);
		transition: background 180ms var(--ease-out-quint);
	}

	.close:hover {
		background: var(--surface-sunk);
		color: var(--ink);
	}

	.body {
		padding: 22px 26px 26px;
		overflow-y: auto;
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		padding: 16px 26px;
		border-top: 1px solid var(--hairline);
		background: var(--surface-2);
	}
</style>
