import { dev } from '$app/environment';
import { scope } from '@atcute/oauth-node-client';

// No writable collections — this app is read-only
export const collections = [] as const;

export type AllowedCollection = (typeof collections)[number];

// atproto for PDS listRecords (likes, posts), rpc for bookmarks via AppView
export const scopes = [
	'atproto',
	scope.rpc({
		lxm: ['app.bsky.bookmark.getBookmarks'],
		aud: '*'
	})
];

// Login only, no signup
export const ALLOW_SIGNUP = false;

// Not used since ALLOW_SIGNUP is false, but required by the framework
const devPDS = 'https://bsky.social/';
const prodPDS = 'https://bsky.social/';
export const signUpPDS = dev ? devPDS : prodPDS;

export const REDIRECT_PATH = '/oauth/callback';

export const REDIRECT_TO_LAST_PAGE_ON_LOGIN = true;

export const DOH_RESOLVER = 'https://mozilla.cloudflare-dns.com/dns-query';
