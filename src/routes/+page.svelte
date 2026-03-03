<script lang="ts">
	import { user } from '$lib/atproto';
	import { atProtoLoginModalState } from '@foxui/social';
	import Search from './Search.svelte';
	import { Button, Heading } from '@foxui/core';
</script>

<div class="mx-auto my-18 max-w-xl px-4 md:my-28">
	{#if !user.isLoggedIn}
		<Heading class="mb-8">Search your bluesky</Heading>
		<Button onclick={() => atProtoLoginModalState.show()}>
			<svg
				fill="currentColor"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="-40 -40 680 620"
				version="1.1"
				class="size-5"
				aria-hidden="true"
			>
				<path
					d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z"
				/>
			</svg>
			Login
		</Button>

		<div class="text-base-700 dark:text-base-300 mt-36 flex flex-col gap-4 text-sm">
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

			<a
				href="https://github.com/flo-bit/search-bluesky-likes"
				target="_blank"
				class="text-accent-600 hover:text-accent-500 dark:text-base-300 dark:hover:text-accent-400 font-semibold transition-colors"
			>
				Source code
			</a>
		</div>
	{/if}

	{#if user.isLoggedIn}
		<Search />
	{/if}
</div>
