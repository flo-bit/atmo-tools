import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { DEV_PORT } from './src/lib/atproto/port';

function coopCoepHeaders(): Plugin {
	return {
		name: 'coop-coep-headers',
		configureServer(server) {
			server.middlewares.use((_req, res, next) => {
				res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
				res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
				next();
			});
		}
	};
}

export default defineConfig({
	plugins: [sveltekit(), tailwindcss(), coopCoepHeaders()],
	server: {
		host: '127.0.0.1',
		port: DEV_PORT
	},
	optimizeDeps: {
		exclude: ['@tursodatabase/database-wasm']
	}
});
