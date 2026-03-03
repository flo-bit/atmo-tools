<script lang="ts">
	import { Heading } from '@foxui/core';
	import { atProtoLoginModalState } from '@foxui/social';
	import { user } from '$lib/atproto';
</script>

<div class="mx-auto my-18 max-w-xl px-4 md:my-28">
	<Heading class="mb-8">atmo.tools</Heading>

	<div class="flex flex-col gap-3">
		<a
			href="/search"
			onclick={(e) => {
				if (!user.isLoggedIn) {
					e.preventDefault();
					atProtoLoginModalState.show();
				}
			}}
			class="bg-base-200 dark:bg-base-950/50 border-base-400/40 dark:border-base-800 hover:border-accent-400 dark:hover:border-accent-600 flex items-center gap-5 rounded-2xl border p-4 inset-shadow-sm inset-shadow-base-800/10 dark:inset-shadow-black/20 transition-colors"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="text-accent-600 dark:text-accent-400 size-5">
				<path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clip-rule="evenodd" />
			</svg>
			<div>
				<div class="text-base-800 dark:text-base-200 text-sm font-semibold">Search</div>
				<div class="text-base-500 dark:text-base-400 text-xs mt-1">Search your likes, bookmarks, and posts</div>
			</div>
		</a>

		{#if user.isLoggedIn}
			<a
				href="/settings"
				class="bg-base-200 dark:bg-base-950/50 border-base-400/40 dark:border-base-800 hover:border-accent-400 dark:hover:border-accent-600 flex items-center gap-5 rounded-2xl border p-4 inset-shadow-sm inset-shadow-base-800/10 dark:inset-shadow-black/20 transition-colors"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="text-accent-600 dark:text-accent-400 size-5">
					<path fill-rule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clip-rule="evenodd" />
				</svg>
				<div>
					<div class="text-base-800 dark:text-base-200 text-sm font-semibold">Settings</div>
					<div class="text-base-500 dark:text-base-400 text-xs mt-1">Manage data and account</div>
				</div>
			</a>
		{/if}
	</div>
</div>
