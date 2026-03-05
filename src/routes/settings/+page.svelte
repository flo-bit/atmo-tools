<script lang="ts">
	import { user, logout } from '$lib/atproto';
	import { Button, Heading, toast } from '@foxui/core';
	import { clearAll, clearAccount, listAccounts } from '$lib/search-state.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let accounts: { did: string; handle: string; display_name: string | null }[] = $state([]);

	onMount(async () => {
		accounts = await listAccounts();
	});
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

			{#if accounts.length > 0}
				<div class="border-base-300 dark:border-base-800 flex flex-col gap-3 border-t pt-4">
					<p class="text-base-600 dark:text-base-400 text-xs font-medium uppercase tracking-wide">Cached accounts</p>
					{#each accounts as account}
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<span class="text-base-800 dark:text-base-200 text-sm">@{account.handle}</span>
								{#if account.did === user.did}
									<span class="text-base-500 dark:text-base-400 text-xs">(current)</span>
								{/if}
							</div>
							<Button
								variant="ghost"
								size="sm"
								onclick={async () => {
									await clearAccount(account.did);
									accounts = accounts.filter((a) => a.did !== account.did);
									toast.success(`Cleared data for @${account.handle}`);
								}}
							>
								Clear data
							</Button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="border-base-300 dark:border-base-800 flex flex-col gap-3 border-t pt-4">
				<Button
					variant="ghost"
					onclick={async () => {
						await clearAll();
						accounts = [];
						toast.success('All data cleared');
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
