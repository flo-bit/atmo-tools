<script lang="ts">
	import '../app.css';

	import { AtprotoLoginModal } from '@foxui/social';
	import { Head, ThemeToggle, Toaster } from '@foxui/core';
	import { login } from '$lib/atproto';

	let { children } = $props();
</script>

{@render children()}

<AtprotoLoginModal
	login={async (handle) => {
		await login(handle);
		return true;
	}}
/>

<Toaster />

<Head title="atmo.tools" emojiFavicon="🦋" />

<ThemeToggle class="fixed top-2 right-2" />
