<script lang="ts">
	import { user, logout } from '$lib/atproto';
	import { Avatar, Button, Heading, Input, Modal, Navbar, Popover, ThemeToggle } from '@foxui/core';
	import { blueskyPostToPostData, Post } from '@foxui/social';
	import { onMount } from 'svelte';
	import {
		searchState,
		initSources,
		switchSource,
		clearSource,
		startLoading,
		searchIndex,
		SOURCE_LABELS,
		PLACEHOLDERS,
		ALL_SOURCES,
		type SourceType
	} from '$lib/search-state.svelte';

	let input: HTMLInputElement | null = $state(null);
	let search = $state('');
	let results: any[] = $state([]);
	let infoModalOpen = $state(false);

	onMount(() => {
		initSources();
	});

	function handleSwitchSource(source: SourceType) {
		switchSource(source);
		search = '';
		results = [];
	}

	$effect(() => {
		if (!search) {
			results = [];
			return;
		}

		searchIndex(search).then((res) => {
			results = res;
		});
	});
</script>

<svelte:window
	onkeydown={() => {
		input?.focus();
	}}
/>

{#if searchState.loading}
	<Heading>Loading...</Heading>
{:else}
	<Navbar class="mx-2 h-auto max-w-xl flex-col items-start sm:mx-auto md:top-10">
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

		<Input
			bind:ref={input}
			bind:value={search}
			class="w-full"
			sizeVariant="lg"
			placeholder={PLACEHOLDERS[searchState.activeSource]}
		/>

		<span class="text-base-600 dark:text-base-400 mt-2 w-full text-center text-xs">
			{#if searchState.sources[searchState.activeSource].phase === 'fetching'}
				loading {SOURCE_LABELS[searchState.activeSource].toLowerCase()}... ({searchState.sources[
					searchState.activeSource
				].count})
			{:else if searchState.sources[searchState.activeSource].phase === 'hydrating'}
				indexed {searchState.sources[searchState.activeSource].indexed} out of {searchState.sources[
					searchState.activeSource
				].totalToIndex}
				{SOURCE_LABELS[searchState.activeSource].toLowerCase()}
			{:else}
				results: {search ? results.length : 0}, {SOURCE_LABELS[
					searchState.activeSource
				].toLowerCase()} loaded: {searchState.sources[searchState.activeSource].count}
			{/if}
		</span>
	</Navbar>
{/if}

{#if results.length > 0 && search}
	<ul class="pt-20 flex flex-col divide-y text-sm">
		{#each results as result (result.doc.uri)}
			<div class="border-base-200 dark:border-base-900 relative border-b py-2">
				<Post
					liked={searchState.activeSource === 'likes'}
					data={blueskyPostToPostData(result.doc)}
					class="pb-2"
				/>
			</div>
		{/each}
	</ul>
{:else if search}
	<div class="text-base-600 dark:text-base-400 mt-4 text-sm font-semibold">No results</div>
{/if}

<div class="fixed right-3 bottom-2">
	<Popover class="flex flex-col items-start gap-2 p-2">
		{#snippet child({ props })}
			<button {...props} class="cursor-pointer hover:opacity-90">
				<Avatar src={user.profile?.avatar} />
			</button>
		{/snippet}
		<ThemeToggle class="absolute top-1 right-1 backdrop-blur-none" />
		<Button class="backdrop-blur-none" variant="ghost" onclick={() => (infoModalOpen = true)}
			>Info</Button
		>
		<Button
			class="backdrop-blur-none"
			variant="ghost"
			onclick={() => {
				clearSource(searchState.activeSource);
				startLoading(searchState.activeSource);
			}}>Refresh {SOURCE_LABELS[searchState.activeSource].toLowerCase()}</Button
		>
		<Button class="backdrop-blur-none" variant="ghost" onclick={logout}>Logout</Button>
	</Popover>
</div>

<Modal bind:open={infoModalOpen}>
	<div class="text-base-700 dark:text-base-300 flex flex-col gap-4 text-sm">
		<div class="flex gap-2">
			Made by
			<div class="flex items-center gap-2">
				<a
					target="_blank"
					href="https://flo-bit.dev"
					class="text-accent-600 dark:text-accent-400 hover:text-accent-500 dark:hover:text-accent-500 font-semibold"
					>flo-bit</a
				>

				<a
					href="https://bsky.app/profile/flo-bit.dev"
					target="_blank"
					class="text-accent-700 hover:text-accent-600 dark:text-accent-400 dark:hover:text-accent-500 transition-colors"
				>
					<span class="sr-only">Bluesky</span>

					<svg
						role="img"
						viewBox="0 0 24 24"
						xmlns="http://www.w3.org/2000/svg"
						class={['size-4']}
						aria-hidden="true"
						fill="currentColor"
						><path
							d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z"
						/></svg
					>
				</a>
			</div>
		</div>

		<p>Send me a message if you have any questions, problems or feedback!</p>

		<a
			href="https://github.com/flo-bit/search-bluesky-likes"
			target="_blank"
			class="text-accent-600 hover:text-accent-500 dark:text-base-300 dark:hover:text-accent-400 font-semibold transition-colors"
		>
			Source code
		</a>
	</div>
</Modal>
