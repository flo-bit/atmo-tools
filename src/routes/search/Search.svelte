<script lang="ts">
	import { Input, Navbar } from '@foxui/core';
	import { AtprotoHandlePopup, BlueskyPost, blueskyPostToPostData, Post } from '@foxui/social';
	import { onMount } from 'svelte';
	import {
		searchState,
		initSources,
		switchSource,
		searchIndex,
		filtersActive,
		DEFAULT_FILTERS,
		SOURCE_LABELS,
		PLACEHOLDERS,
		ALL_SOURCES,
		type SourceType,
		type SearchFilters
	} from '$lib/search-state.svelte';

	let input: HTMLInputElement | null = $state(null);
	let search = $state('');
	let results: any[] = $state([]);
	let hasMore = $state(false);
	let limit = $state(50);
	let sentinel: HTMLElement | null = $state(null);
	let scrollY = $state(0);

	let showFilters = $state(false);
	let filters = $state<SearchFilters>({ ...DEFAULT_FILTERS });
	let handleInput = $state('');
	let hasActiveFilters = $derived(filtersActive(filters));

	onMount(() => {
		initSources();
	});

	function handleSwitchSource(source: SourceType) {
		switchSource(source);
	}

	// Reset limit when search params change
	$effect(() => {
		searchState.activeSource;
		$state.snapshot(filters);
		search;
		limit = 50;
	});

	// Fetch results
	$effect(() => {
		const _source = searchState.activeSource;
		const _filters = $state.snapshot(filters);
		const _count = searchState.sources[_source].count;
		const _limit = limit;

		searchIndex(search, _filters, _limit).then((res) => {
			results = res.results;
			hasMore = res.hasMore;
		});
	});

	// Infinite scroll via IntersectionObserver
	$effect(() => {
		const el = sentinel;
		if (!el) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && hasMore) {
					limit += 50;
				}
			},
			{ rootMargin: '400px' }
		);

		observer.observe(el);
		return () => observer.disconnect();
	});

	const pillClass = (active: boolean) =>
		`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
			active
				? 'bg-accent-600 text-white'
				: 'text-base-600 dark:text-base-400 hover:bg-base-200 dark:hover:bg-base-800'
		}`;
</script>

<svelte:window
	bind:scrollY={scrollY}
	onkeydown={() => {
		const tag = document.activeElement?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		input?.focus();
	}}
/>

	<a
		href="/"
		class="text-base-500 dark:text-base-400 hover:text-accent-600 dark:hover:text-accent-400 fixed top-4 left-4 z-50 inline-flex items-center gap-1 text-sm transition-colors"
	>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-4">
			<path fill-rule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clip-rule="evenodd" />
		</svg>
		Back
	</a>

	<Navbar class="mx-2 py-3 h-auto max-w-xl flex-col items-start sm:mx-auto top-12 md:top-10">
		<div class="mb-4 mx-2 flex items-baseline gap-2">
			<span class="text-base-600 dark:text-base-400 text-sm font-medium">Search my</span>
			<div class="flex gap-1">
				{#each ALL_SOURCES as source}
					<button
						class="cursor-pointer rounded-full px-3 py-1 text-sm font-medium transition-colors {searchState.activeSource ===
						source
							? 'bg-accent-600 text-white'
							: 'text-base-600 dark:text-base-400 hover:bg-base-200 dark:hover:bg-base-800'}"
						onclick={() => handleSwitchSource(source)}
					>
						{SOURCE_LABELS[source]}
					</button>
				{/each}
			</div>
		</div>

		<div class="flex w-full items-center gap-2">
			<Input
				bind:ref={input}
				bind:value={search}
				class="w-full"
				sizeVariant="lg"
				placeholder={PLACEHOLDERS[searchState.activeSource]}
			/>
			<button
				class="text-base-500 dark:text-base-400 hover:text-accent-600 dark:hover:text-accent-400 relative cursor-pointer p-2 transition-colors"
				onclick={() => (showFilters = !showFilters)}
				aria-label="Toggle filters"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-5">
					<path fill-rule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 0 1 .628.74v2.288a2.25 2.25 0 0 1-.659 1.59l-4.682 4.683a2.25 2.25 0 0 0-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 0 1 8 18.25v-5.757a2.25 2.25 0 0 0-.659-1.591L2.659 6.22A2.25 2.25 0 0 1 2 4.629V2.34a.75.75 0 0 1 .628-.74Z" clip-rule="evenodd" />
				</svg>
				{#if hasActiveFilters}
					<span class="bg-accent-600 absolute top-1 right-1 size-2 rounded-full"></span>
				{/if}
			</button>
		</div>

		{#if showFilters}
			<div class="mt-3 flex w-full flex-col gap-3 px-2">
				{#if searchState.activeSource !== 'posts'}
					<div class="flex flex-col gap-1.5">
						<div class="flex items-center gap-2">
							<label class="text-base-500 dark:text-base-400 text-xs w-16 shrink-0">Handle</label>
							<AtprotoHandlePopup
								bind:value={handleInput}
								onselected={(actor) => {
									if (!filters.handles.includes(actor.handle)) {
										filters.handles = [...filters.handles, actor.handle];
									}
									handleInput = '';
								}}
							/>
						</div>
						{#if filters.handles.length > 0}
							<div class="ml-18 flex flex-wrap gap-1">
								{#each filters.handles as handle}
									<span class="bg-base-200 dark:bg-base-800 text-base-700 dark:text-base-300 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
										@{handle}
										<button
											class="text-base-500 hover:text-base-800 dark:hover:text-base-100 cursor-pointer"
											onclick={() => (filters.handles = filters.handles.filter((h) => h !== handle))}
											aria-label="Remove {handle}"
										>
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="size-3">
												<path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
											</svg>
										</button>
									</span>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<div class="flex items-center gap-3">
					<div class="flex items-center gap-1">
						<label class="text-base-500 dark:text-base-400 text-xs">Min likes</label>
						<input
							type="number"
							bind:value={filters.minLikes}
							min="0"
							class="bg-base-100 dark:bg-base-900 border-base-300 dark:border-base-700 text-base-800 dark:text-base-200 w-16 rounded-md border px-2 py-1 text-xs"
						/>
					</div>
					<div class="flex items-center gap-1">
						<label class="text-base-500 dark:text-base-400 text-xs">Reposts</label>
						<input
							type="number"
							bind:value={filters.minReposts}
							min="0"
							class="bg-base-100 dark:bg-base-900 border-base-300 dark:border-base-700 text-base-800 dark:text-base-200 w-16 rounded-md border px-2 py-1 text-xs"
						/>
					</div>
					<div class="flex items-center gap-1">
						<label class="text-base-500 dark:text-base-400 text-xs">Replies</label>
						<input
							type="number"
							bind:value={filters.minReplies}
							min="0"
							class="bg-base-100 dark:bg-base-900 border-base-300 dark:border-base-700 text-base-800 dark:text-base-200 w-16 rounded-md border px-2 py-1 text-xs"
						/>
					</div>
				</div>

				<div class="flex items-center gap-3">
					<div class="flex items-center gap-1">
						<label class="text-base-500 dark:text-base-400 text-xs">After</label>
						<input
							type="date"
							bind:value={filters.dateAfter}
							class="bg-base-100 dark:bg-base-900 border-base-300 dark:border-base-700 text-base-800 dark:text-base-200 rounded-md border px-2 py-1 text-xs"
						/>
					</div>
					<div class="flex items-center gap-1">
						<label class="text-base-500 dark:text-base-400 text-xs">Before</label>
						<input
							type="date"
							bind:value={filters.dateBefore}
							class="bg-base-100 dark:bg-base-900 border-base-300 dark:border-base-700 text-base-800 dark:text-base-200 rounded-md border px-2 py-1 text-xs"
						/>
					</div>
				</div>

				<div class="flex items-center gap-2">
					<span class="text-base-500 dark:text-base-400 text-xs">Has:</span>
					<button class={pillClass(filters.hasImage)} onclick={() => (filters.hasImage = !filters.hasImage)}>Image</button>
					<button class={pillClass(filters.hasLink)} onclick={() => (filters.hasLink = !filters.hasLink)}>Link</button>
					<button class={pillClass(filters.hasVideo)} onclick={() => (filters.hasVideo = !filters.hasVideo)}>Video</button>
				</div>

				<div class="flex items-center gap-2">
					<button class={pillClass(!filters.showReplies)} onclick={() => (filters.showReplies = !filters.showReplies)}>Hide replies</button>
				</div>

				{#if hasActiveFilters}
					<button
						class="text-base-500 dark:text-base-400 hover:text-accent-600 dark:hover:text-accent-400 cursor-pointer self-start text-xs underline"
						onclick={() => (filters = { ...DEFAULT_FILTERS })}
					>
						Clear filters
					</button>
				{/if}
			</div>
		{/if}

		{@const src = searchState.sources[searchState.activeSource]}
		<span class="text-base-600 dark:text-base-400 mt-2 mx-4 text-xs">
			{#if src.phase === 'idle'}
				loading...
			{:else if src.phase === 'fetching'}
				fetching {SOURCE_LABELS[searchState.activeSource].toLowerCase()}... ({src.count + src.pendingUris.length} found)
			{:else if src.phase === 'hydrating'}
				indexing {src.indexed}/{src.totalToIndex} {SOURCE_LABELS[searchState.activeSource].toLowerCase()}... ({src.count} searchable)
			{:else}
				{SOURCE_LABELS[searchState.activeSource].toLowerCase()}: {src.count}{#if results.length > 0}, {results.length} results{/if}
			{/if}
		</span>
	</Navbar>

{#if results.length > 0}
	<ul class="{showFilters ? 'pt-90 md:pt-80' : 'pt-32 md:pt-20'} flex flex-col divide-y divide-base-200 dark:divide-base-800 text-sm">
		{#each results as result (result.doc.uri)}
			<li class="py-4">
				<BlueskyPost
				
					liked={result.doc.sources?.includes('likes')}
					bookmarked={result.doc.sources?.includes('bookmarks')}
					showLogo
					feedViewPost={result.doc}
				/>
			</li>
		{/each}
	</ul>
	<div bind:this={sentinel} class="text-base-500 dark:text-base-400 py-8 text-center text-xs">
		{#if hasMore}
			loading more...
		{:else}
			that's all
		{/if}
	</div>
{:else if search || hasActiveFilters}
	<div class="text-base-600 dark:text-base-400 {showFilters ? 'pt-90 md:pt-80' : 'pt-32 md:pt-20'} text-center text-sm font-semibold">No results</div>
{/if}

{#if scrollY > 300}
	<button
		class="bg-base-200/80 dark:bg-base-800/80 text-base-600 dark:text-base-300 hover:bg-base-300 dark:hover:bg-base-700 fixed right-3 bottom-3 cursor-pointer rounded-full p-2.5 shadow-md backdrop-blur-sm transition-all"
		onclick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
		aria-label="Scroll to top"
	>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-5">
			<path fill-rule="evenodd" d="M9.47 6.47a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 1 1-1.06 1.06L10 8.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06l4.25-4.25Z" clip-rule="evenodd" />
		</svg>
	</button>
{/if}
