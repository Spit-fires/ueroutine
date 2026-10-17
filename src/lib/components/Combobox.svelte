<script lang="ts">
	interface Props {
		value: string;
		options: string[];
		placeholder?: string;
		ariaLabel: string;
		mono?: boolean;
		/** Allow adding names that are not in the list yet. */
		creatable?: boolean;
		onchange: (value: string) => void;
		oncreate?: (value: string) => void;
		/** Called after Enter commits, so the parent can move focus on. */
		oncommit?: () => void;
		/** Called on Tab so the parent can step to the next cell. */
		onstep?: (delta: 1 | -1) => void;
		/** Bump this to pull focus into the field. */
		focusToken?: number;
	}

	let {
		value,
		options,
		placeholder = 'Select or type',
		ariaLabel,
		mono = false,
		creatable = true,
		onchange,
		oncreate,
		oncommit,
		onstep,
		focusToken = 0
	}: Props = $props();

	let text = $state('');
	let open = $state(false);
	const listId = `combo-${Math.random().toString(36).slice(2, 9)}`;
	let active = $state(0);
	let input = $state<HTMLInputElement | null>(null);
	let suppressBlur = false;
	let lastFocusToken = 0;

	$effect(() => {
		text = value;
	});

	$effect(() => {
		if (focusToken !== lastFocusToken) {
			lastFocusToken = focusToken;
			queueMicrotask(() => {
				input?.focus();
				input?.select();
				open = true;
			});
		}
	});

	const query = $derived(text.trim());
	const needle = $derived(query.toLowerCase());
	const matches = $derived(
		needle ? options.filter((option) => option.toLowerCase().includes(needle)) : options
	);
	const rows = $derived(matches.slice(0, 80));
	const exact = $derived(options.some((option) => option.toLowerCase() === needle));
	const canCreate = $derived(Boolean(query) && creatable && !exact);

	$effect(() => {
		if (active >= rows.length) active = Math.max(0, rows.length - 1);
	});

	function commit(next: string, advance = false) {
		text = next;
		onchange(next);
		open = false;
		input?.blur();
		if (advance) queueMicrotask(() => oncommit?.());
	}

	function create(advance = false) {
		const name = query;
		if (!name) {
			commit('', advance);
			return;
		}
		if (!exact) oncreate?.(name);
		commit(name, advance);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			open = true;
			active = rows.length ? (active + 1) % rows.length : 0;
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			active = rows.length ? (active - 1 + rows.length) % rows.length : 0;
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			if (query && canCreate) create(true);
			else if (rows[active] !== undefined) commit(rows[active], true);
			else if (query) create(true);
			return;
		}
		if (event.key === 'Tab' && onstep) {
			const pending = text;
			suppressBlur = true;
			event.preventDefault();
			if (pending !== value) {
				if (!exact && creatable) oncreate?.(pending);
				onchange(pending);
			}
			open = false;
			queueMicrotask(() => {
				suppressBlur = false;
				onstep?.(event.shiftKey ? -1 : 1);
			});
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			text = value;
			open = false;
			input?.blur();
		}
	}

	function onblur() {
		if (suppressBlur) return;
		open = false;
		if (text !== value) {
			if (query && !exact && creatable) oncreate?.(query);
			onchange(text);
		}
	}
</script>

<div class="field">
	<div class="control" class:open class:mono>
		<input
			bind:this={input}
			bind:value={text}
			{placeholder}
			aria-label={ariaLabel}
			role="combobox"
			aria-expanded={open}
			aria-controls={listId}
			aria-autocomplete="list"
			autocomplete="off"
			spellcheck="false"
			onfocus={() => {
				open = true;
				active = 0;
			}}
			oninput={() => {
				open = true;
				active = 0;
			}}
			onkeydown={onkeydown}
			onblur={onblur}
		/>
		{#if value}
			<button class="clear" type="button" aria-label={`Clear ${ariaLabel}`} onclick={() => commit('')}>

				<svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
					<path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.4" fill="none" />
				</svg>
			</button>
		{/if}
	</div>

	{#if open}
		<ul class="menu" id={listId} role="listbox" aria-label={`${ariaLabel} options`}>
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
			{:else if !needle}
				<li class="empty">No options yet — type a name to add one.</li>
			{/if}

			{#if canCreate}
				<li class="group">new</li>
				<li>
					<button
						type="button"
						class="create"
						onmousedown={(event) => event.preventDefault()}
						onclick={() => create()}
					>
						Add “{query}”
					</button>
				</li>
			{:else if needle && !rows.length}
				<li class="empty">Nothing matches “{query}”.</li>
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

	.group {
		padding: 6px 8px 4px;
		font-family: var(--font-mono);
		font-size: 9.5px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
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

	.menu button.create {
		color: var(--navy);
		font-weight: 600;
	}
</style>
