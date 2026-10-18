<script lang="ts">
	interface Props {
		value: string;
		options: string[];
		placeholder?: string;
		ariaLabel: string;
		mono?: boolean;
		onchange: (value: string) => void;
		/** Bump this to pull focus into the field. */
		focusToken?: number;
	}

	let {
		value,
		options,
		placeholder = 'Select',
		ariaLabel,
		mono = false,
		onchange,
		focusToken = 0
	}: Props = $props();

	let text = $state('');
	let open = $state(false);
	const listId = `combo-${Math.random().toString(36).slice(2, 9)}`;
	let active = $state(0);
	let input = $state<HTMLInputElement | null>(null);
	let menu = $state<HTMLUListElement | null>(null);
	let lastFocusToken = 0;

	$effect(() => {
		text = value;
	});

	$effect(() => {
		if (focusToken !== lastFocusToken) {
			lastFocusToken = focusToken;
			queueMicrotask(() => {
				input?.focus();
				openAt(text);
			});
		}
	});

	/** A scroll picker: every option, no typing, no filtering. */
	const rows = $derived(options.slice(0, 80));

	$effect(() => {
		if (active >= rows.length) active = Math.max(0, rows.length - 1);
	});

	/** Open the list with the current value highlighted and scrolled into view. */
	function openAt(current: string) {
		open = true;
		const index = rows.indexOf(current);
		active = index >= 0 ? index : 0;
		queueMicrotask(() => menu?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }));
	}

	function commit(next: string) {
		text = next;
		onchange(next);
		open = false;
		input?.blur();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!open) openAt(text);
			else if (rows.length) active = (active + 1) % rows.length;
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (!open) openAt(text);
			else if (rows.length) active = (active - 1 + rows.length) % rows.length;
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			if (rows[active] !== undefined) commit(rows[active]);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			text = value;
			open = false;
			input?.blur();
		}
	}
</script>

<div class="field">
	<div class="control" class:open class:mono>
		<input
			bind:this={input}
			bind:value={text}
			{placeholder}
			readonly
			inputmode="none"
			aria-label={ariaLabel}
			role="combobox"
			aria-expanded={open}
			aria-controls={listId}
			autocomplete="off"
			spellcheck="false"
			onfocus={() => openAt(text)}
			{onkeydown}
			onblur={() => (open = false)}
		/>
		{#if value}
			<button
				class="clear"
				type="button"
				aria-label={`Clear ${ariaLabel}`}
				onclick={() => commit('')}
			>
				<svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
					<path
						d="M1.5 1.5l7 7M8.5 1.5l-7 7"
						stroke="currentColor"
						stroke-width="1.4"
						fill="none"
					/>
				</svg>
			</button>
		{/if}
	</div>

	{#if open}
		<ul
			class="menu"
			id={listId}
			bind:this={menu}
			role="listbox"
			aria-label={`${ariaLabel} options`}
		>
			{#if rows.length}
				{#each rows as option, index (option)}
					<li>
						<button
							type="button"
							role="option"
							aria-selected={option === value}
							class:active={index === active}
							class:mono
							onmousedown={(event) => event.preventDefault()}
							onclick={() => commit(option)}
							onmouseenter={() => (active = index)}
						>
							{option}
						</button>
					</li>
				{/each}
			{:else}
				<li class="empty">No options yet — manage the lists in Settings.</li>
			{/if}
		</ul>
	{/if}
</div>

<style>
	.field {
		position: relative;
	}

	.control {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--surface);
		border: 1px solid var(--hairline-strong);
		border-radius: var(--r-sm);
		padding: 0 8px 0 10px;
		height: 36px;
		transition:
			border-color 200ms var(--ease-out-quint),
			box-shadow 200ms var(--ease-out-quint);
	}

	.control.open {
		border-color: var(--navy);
		box-shadow: 0 0 0 3px rgba(27, 42, 74, 0.09);
	}

	input {
		flex: 1;
		min-width: 0;
		height: 100%;
		border: none;
		outline: none;
		background: transparent;
		font-size: 13.5px;
		font-weight: 500;
		cursor: pointer;
		user-select: none;
	}

	.control.mono input {
		font-family: var(--font-mono);
		font-size: 12.5px;
		letter-spacing: 0.02em;
	}

	input::placeholder {
		color: var(--muted);
		font-weight: 400;
	}

	.clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		color: var(--muted);
		transition: background 180ms var(--ease-out-quint);
	}

	.clear:hover {
		background: var(--surface-sunk);
		color: var(--ink);
	}

	.menu {
		position: absolute;
		z-index: 40;
		top: calc(100% + 6px);
		left: 0;
		right: 0;
		max-height: 246px;
		overflow-y: auto;
		margin: 0;
		padding: 6px;
		list-style: none;
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		box-shadow: 0 18px 40px rgba(20, 22, 26, 0.12);
		animation: menu-in 160ms var(--ease-out-quint) both;
	}

	@keyframes menu-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.empty {
		padding: 6px 8px 8px;
		font-size: 12px;
		color: var(--muted);
	}

	.menu button {
		display: block;
		width: 100%;
		text-align: left;
		padding: 6px 8px;
		border-radius: var(--r-xs);
		font-size: 13px;
		transition: background 140ms var(--ease-out-quint);
	}

	.menu button.mono {
		font-family: var(--font-mono);
		font-size: 12px;
	}

	.menu button.active,
	.menu button:hover {
		background: var(--surface-sunk);
	}
</style>
