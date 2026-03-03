<script lang="ts">
	import { user, logout } from '$lib/atproto';
	import { Button, Heading, toast } from '@foxui/core';
	import { clearSource, ALL_SOURCES } from '$lib/search-state.svelte';
	import { goto } from '$app/navigation';
</script>

{#if user.isLoggedIn}
	<div class="mx-auto my-18 max-w-xl px-4 md:my-28">
		<a href="/" class="text-base-500 dark:text-base-400 hover:text-accent-600 dark:hover:text-accent-400 mb-6 inline-flex items-center gap-1 text-sm transition-colors">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-4">
				<path fill-rule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clip-rule="evenodd" />
			</svg>
			Back
		</a>

		<Heading class="mb-8">Settings</Heading>

		<div class="flex flex-col gap-4">
			<div class="flex flex-col gap-2">
				<p class="text-base-600 dark:text-base-400 text-sm">Signed in as <span class="text-base-800 dark:text-base-200 font-medium">@{user.profile?.handle}</span></p>
			</div>

			<div class="border-base-300 dark:border-base-800 flex flex-col gap-3 border-t pt-4">
				<Button
					variant="ghost"
					onclick={async () => {
						for (const source of ALL_SOURCES) {
							await clearSource(source);
						}
						const dbs = await indexedDB.databases();
						for (const dbInfo of dbs) {
							if (dbInfo.name) indexedDB.deleteDatabase(dbInfo.name);
						}
						toast.success('All data cleared');
						setTimeout(() => location.reload(), 500);
					}}
				>
					Reset all data
				</Button>

				<Button
					variant="ghost"
					onclick={async () => {
						await logout();
						goto('/');
					}}
				>
					Logout
				</Button>
			</div>
		</div>
	</div>
{:else}
	<div class="mx-auto my-18 max-w-xl px-4 md:my-28">
		<Heading class="mb-4">Settings</Heading>
		<p class="text-base-600 dark:text-base-400 text-sm">You need to be logged in to view settings.</p>
		<a href="/" class="text-accent-600 dark:text-accent-400 hover:text-accent-500 mt-2 inline-block text-sm font-medium">Go home</a>
	</div>
{/if}
