import type { Database } from '@tursodatabase/database-wasm/vite';

export type SourceType = 'likes' | 'bookmarks' | 'posts' | 'reposts';
export const ALL_SOURCES: SourceType[] = ['likes', 'bookmarks', 'posts', 'reposts'];

let dbInstance: Database | null = null;
let dbReady: Promise<Database> | null = null;

const SCHEMA_VERSION = 2;

export async function getDb(): Promise<Database> {
	if (dbInstance) return dbInstance;
	if (dbReady) return dbReady;
	dbReady = initDb();
	dbInstance = await dbReady;
	return dbInstance;
}

async function initDb(): Promise<Database> {
	const { connect } = await import('@tursodatabase/database-wasm/vite');
	const db: Database = await connect('atmo.db');

	await db.exec('PRAGMA journal_mode = WAL');
	await db.exec('PRAGMA foreign_keys = ON');

	await db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`);
	const row = await (await db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')).get() as
		| { version: number }
		| undefined;
	const currentVersion = row?.version ?? 0;

	if (currentVersion < SCHEMA_VERSION) {
		await applyMigrations(db, currentVersion);
	}

	// Clean up legacy IndexedDB databases from Dexie + FlexSearch
	if (typeof indexedDB !== 'undefined') {
		try {
			const dbs = await indexedDB.databases();
			for (const dbInfo of dbs) {
				if (dbInfo.name) indexedDB.deleteDatabase(dbInfo.name);
			}
		} catch {
			// databases() may not be supported in all browsers
		}
	}

	// Clean up legacy localStorage
	for (const source of ALL_SOURCES) {
		localStorage.removeItem(`${source}-ids`);
		localStorage.removeItem(`${source}-cursor`);
	}

	return db;
}

async function applyMigrations(db: Database, fromVersion: number) {
	if (fromVersion < 1) {
		// Drop any partially-created tables from a previous failed migration
		await db.exec(`
			DROP TABLE IF EXISTS post_sources;
			DROP TABLE IF EXISTS sync_cursors;
			DROP TABLE IF EXISTS posts;
			DROP TABLE IF EXISTS accounts;
		`);
		await db.exec(`
			CREATE TABLE IF NOT EXISTS accounts (
				did TEXT PRIMARY KEY,
				handle TEXT NOT NULL,
				display_name TEXT,
				avatar TEXT,
				added_at INTEGER NOT NULL DEFAULT (unixepoch('now'))
			);

			CREATE TABLE IF NOT EXISTS posts (
				uri TEXT PRIMARY KEY,
				author_did TEXT NOT NULL,
				author_handle TEXT NOT NULL DEFAULT '',
				author_display_name TEXT NOT NULL DEFAULT '',
				text TEXT NOT NULL DEFAULT '',
				created_at TEXT,
				like_count INTEGER NOT NULL DEFAULT 0,
				repost_count INTEGER NOT NULL DEFAULT 0,
				reply_count INTEGER NOT NULL DEFAULT 0,
				has_image INTEGER NOT NULL DEFAULT 0,
				has_video INTEGER NOT NULL DEFAULT 0,
				has_link INTEGER NOT NULL DEFAULT 0,
				is_reply INTEGER NOT NULL DEFAULT 0,
				embed_type TEXT,
				embed_title TEXT NOT NULL DEFAULT '',
				embed_description TEXT NOT NULL DEFAULT '',
				quote_text TEXT NOT NULL DEFAULT '',
				quote_author_handle TEXT NOT NULL DEFAULT '',
				search_text TEXT NOT NULL DEFAULT '',
				raw TEXT NOT NULL,
				saved_at INTEGER NOT NULL,
				fetched_at INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS post_sources (
				uri TEXT NOT NULL REFERENCES posts(uri) ON DELETE CASCADE,
				account_did TEXT NOT NULL REFERENCES accounts(did) ON DELETE CASCADE,
				source TEXT NOT NULL CHECK(source IN ('likes','bookmarks','posts','reposts')),
				PRIMARY KEY (uri, account_did, source)
			);

			CREATE TABLE IF NOT EXISTS sync_cursors (
				account_did TEXT NOT NULL,
				source TEXT NOT NULL CHECK(source IN ('likes','bookmarks','posts','reposts')),
				tail_cursor TEXT,
				PRIMARY KEY (account_did, source)
			);

			-- Indexes for common query patterns
			CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
			CREATE INDEX IF NOT EXISTS idx_posts_like_count ON posts(like_count);
			CREATE INDEX IF NOT EXISTS idx_posts_repost_count ON posts(repost_count);
			CREATE INDEX IF NOT EXISTS idx_posts_reply_count ON posts(reply_count);
			CREATE INDEX IF NOT EXISTS idx_posts_author_handle ON posts(author_handle);
			CREATE INDEX IF NOT EXISTS idx_posts_author_did ON posts(author_did);
			CREATE INDEX IF NOT EXISTS idx_post_sources_account ON post_sources(account_did, source);
			CREATE INDEX IF NOT EXISTS idx_post_sources_uri ON post_sources(uri);
		`);

	}

	if (fromVersion >= 1 && fromVersion < 2) {
		// v2: Added search_text column, removed FTS5.
		// Easiest to drop and recreate since there's no user-created data to preserve.
		await db.exec(`
			DROP TABLE IF EXISTS post_sources;
			DROP TABLE IF EXISTS sync_cursors;
			DROP TABLE IF EXISTS posts;
			DROP TABLE IF EXISTS accounts;
		`);
		// Re-create tables with the current v1 DDL (which includes search_text)
		fromVersion = 0;
		await applyMigrations(db, fromVersion);
	}

	await (await db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)')).run(SCHEMA_VERSION);
}

// --- PostView field extraction ---

export interface ExtractedPost {
	uri: string;
	author_did: string;
	author_handle: string;
	author_display_name: string;
	text: string;
	created_at: string | null;
	like_count: number;
	repost_count: number;
	reply_count: number;
	has_image: number;
	has_video: number;
	has_link: number;
	is_reply: number;
	embed_type: string | null;
	embed_title: string;
	embed_description: string;
	quote_text: string;
	quote_author_handle: string;
	search_text: string;
	raw: string;
	saved_at: number;
	fetched_at: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractPostFields(postView: any, savedAt: number, fetchedAt: number): ExtractedPost {
	const embed = postView.embed;
	const record = postView.record;

	let hasImage = 0,
		hasVideo = 0,
		hasLink = 0;
	let embedType: string | null = null;
	let embedTitle = '',
		embedDescription = '';
	let quoteText = '',
		quoteAuthorHandle = '';

	if (embed) {
		embedType = embed.$type;

		if (embed.$type === 'app.bsky.embed.images#view') {
			hasImage = 1;
		} else if (embed.$type === 'app.bsky.embed.video#view') {
			hasVideo = 1;
		} else if (embed.$type === 'app.bsky.embed.external#view') {
			hasLink = 1;
			embedTitle = embed.external?.title ?? '';
			embedDescription = embed.external?.description ?? '';
		} else if (embed.$type === 'app.bsky.embed.record#view') {
			const embeddedRecord = embed.record;
			if (embeddedRecord?.value?.text) {
				quoteText = embeddedRecord.value.text;
				quoteAuthorHandle = embeddedRecord.author?.handle ?? '';
			}
		} else if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
			const media = embed.media;
			if (media?.$type === 'app.bsky.embed.images#view') hasImage = 1;
			if (media?.$type === 'app.bsky.embed.video#view') hasVideo = 1;
			if (media?.$type === 'app.bsky.embed.external#view') {
				hasLink = 1;
				embedTitle = media.external?.title ?? '';
				embedDescription = media.external?.description ?? '';
			}
			const embeddedRecord = embed.record?.record;
			if (embeddedRecord?.value?.text) {
				quoteText = embeddedRecord.value.text;
				quoteAuthorHandle = embeddedRecord.author?.handle ?? '';
			}
		}
	}

	// Check for links in facets
	if (!hasLink && Array.isArray(record?.facets)) {
		hasLink = record.facets.some(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(f: any) => f.features?.some((feat: any) => feat.$type === 'app.bsky.richtext.facet#link')
		)
			? 1
			: 0;
	}

	const authorHandle = postView.author?.handle ?? '';
	const authorDisplayName = postView.author?.displayName ?? '';
	const postText = record?.text ?? '';

	// Concatenate all searchable fields, lowercased, for LIKE-based search
	const searchText = [authorHandle, authorDisplayName, postText, embedTitle, embedDescription, quoteText, quoteAuthorHandle]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

	return {
		uri: postView.uri,
		author_did: postView.author?.did ?? '',
		author_handle: authorHandle,
		author_display_name: authorDisplayName,
		text: postText,
		created_at: record?.createdAt ?? null,
		like_count: postView.likeCount ?? 0,
		repost_count: postView.repostCount ?? 0,
		reply_count: postView.replyCount ?? 0,
		has_image: hasImage,
		has_video: hasVideo,
		has_link: hasLink,
		is_reply: record?.reply ? 1 : 0,
		embed_type: embedType,
		embed_title: embedTitle,
		embed_description: embedDescription,
		quote_text: quoteText,
		quote_author_handle: quoteAuthorHandle,
		search_text: searchText,
		raw: JSON.stringify(postView),
		saved_at: savedAt,
		fetched_at: fetchedAt
	};
}

// --- CRUD helpers ---

export async function upsertAccount(
	db: Database,
	did: string,
	handle: string,
	displayName?: string | null,
	avatar?: string | null
) {
	await (await db.prepare(
		`INSERT INTO accounts (did, handle, display_name, avatar)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(did) DO UPDATE SET
			handle = excluded.handle,
			display_name = excluded.display_name,
			avatar = excluded.avatar`
	)).run(did, handle, displayName ?? null, avatar ?? null);
}

export async function getAccounts(db: Database): Promise<{ did: string; handle: string; display_name: string | null }[]> {
	return (await db.prepare('SELECT did, handle, display_name FROM accounts ORDER BY added_at')).all() as {
		did: string;
		handle: string;
		display_name: string | null;
	}[];
}

export async function postExistsForSource(
	db: Database,
	uri: string,
	accountDid: string,
	source: SourceType
): Promise<boolean> {
	const row = await (await db.prepare(
		'SELECT 1 FROM post_sources WHERE uri = ? AND account_did = ? AND source = ?'
	)).get(uri, accountDid, source);
	return !!row;
}

export async function postExists(db: Database, uri: string): Promise<boolean> {
	const row = await (await db.prepare('SELECT 1 FROM posts WHERE uri = ?')).get(uri);
	return !!row;
}

export async function getSourceCount(db: Database, accountDid: string, source: SourceType): Promise<number> {
	const row = await (await db.prepare(
		'SELECT COUNT(*) as count FROM post_sources WHERE account_did = ? AND source = ?'
	)).get(accountDid, source) as { count: number } | undefined;
	return row?.count ?? 0;
}

export async function getCursor(db: Database, accountDid: string, source: SourceType): Promise<string | undefined> {
	const row = await (await db.prepare(
		'SELECT tail_cursor FROM sync_cursors WHERE account_did = ? AND source = ?'
	)).get(accountDid, source) as { tail_cursor: string | null } | undefined;
	return row?.tail_cursor ?? undefined;
}

export async function setCursor(db: Database, accountDid: string, source: SourceType, cursor: string | undefined) {
	await (await db.prepare(
		`INSERT OR REPLACE INTO sync_cursors (account_did, source, tail_cursor)
		 VALUES (?, ?, ?)`
	)).run(accountDid, source, cursor ?? null);
}

// --- Batch operations ---

export async function bulkUpsertPosts(
	db: Database,
	posts: ExtractedPost[],
	accountDid: string,
	source: SourceType
): Promise<number> {
	if (posts.length === 0) return 0;

	const insertPost = await db.prepare(
		`INSERT INTO posts (uri, author_did, author_handle, author_display_name, text,
			created_at, like_count, repost_count, reply_count, has_image, has_video,
			has_link, is_reply, embed_type, embed_title, embed_description,
			quote_text, quote_author_handle, search_text, raw, saved_at, fetched_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(uri) DO UPDATE SET
			like_count = excluded.like_count,
			repost_count = excluded.repost_count,
			reply_count = excluded.reply_count,
			raw = excluded.raw,
			fetched_at = excluded.fetched_at`
	);

	const insertSource = await db.prepare(
		`INSERT OR IGNORE INTO post_sources (uri, account_did, source) VALUES (?, ?, ?)`
	);

	let count = 0;
	await db.exec('BEGIN TRANSACTION');
	try {
		for (const post of posts) {
			await insertPost.run(
				post.uri,
				post.author_did,
				post.author_handle,
				post.author_display_name,
				post.text,
				post.created_at,
				post.like_count,
				post.repost_count,
				post.reply_count,
				post.has_image,
				post.has_video,
				post.has_link,
				post.is_reply,
				post.embed_type,
				post.embed_title,
				post.embed_description,
				post.quote_text,
				post.quote_author_handle,
				post.search_text,
				post.raw,
				post.saved_at,
				post.fetched_at
			);
			await insertSource.run(post.uri, accountDid, source);
			count++;
		}
		await db.exec('COMMIT');
	} catch (e) {
		await db.exec('ROLLBACK');
		throw e;
	}
	return count;
}

/**
 * Tag existing posts with a source for this account (they already exist from another source).
 * Returns number of posts that were newly tagged.
 */
export async function tagExistingPosts(
	db: Database,
	uris: string[],
	accountDid: string,
	source: SourceType
): Promise<number> {
	if (uris.length === 0) return 0;

	const insertSource = await db.prepare(
		`INSERT OR IGNORE INTO post_sources (uri, account_did, source) VALUES (?, ?, ?)`
	);

	let count = 0;
	await db.exec('BEGIN TRANSACTION');
	try {
		for (const uri of uris) {
			const result = await insertSource.run(uri, accountDid, source);
			if (result.changes > 0) count++;
		}
		await db.exec('COMMIT');
	} catch (e) {
		await db.exec('ROLLBACK');
		throw e;
	}
	return count;
}

// --- Search ---

export type SearchFilters = {
	handles: string[];
	minLikes: number;
	minReposts: number;
	minReplies: number;
	dateAfter: string;
	dateBefore: string;
	hasImage: boolean;
	hasLink: boolean;
	hasVideo: boolean;
	showReplies: boolean;
};

export const DEFAULT_FILTERS: SearchFilters = {
	handles: [],
	minLikes: 0,
	minReposts: 0,
	minReplies: 0,
	dateAfter: '',
	dateBefore: '',
	hasImage: false,
	hasLink: false,
	hasVideo: false,
	showReplies: true
};

export function filtersActive(filters: SearchFilters): boolean {
	return (
		filters.handles.length > 0 ||
		filters.minLikes > 0 ||
		filters.minReposts > 0 ||
		filters.minReplies > 0 ||
		!!filters.dateAfter ||
		!!filters.dateBefore ||
		filters.hasImage ||
		filters.hasLink ||
		filters.hasVideo ||
		!filters.showReplies
	);
}

export interface SearchParams {
	query: string;
	filters: SearchFilters;
	sources: SourceType[];
	accountDids: string[];
	limit: number;
	offset: number;
}

export interface SearchResult {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	doc: any;
	isLiked: boolean;
	isBookmarked: boolean;
}

export async function searchPosts(
	db: Database,
	params: SearchParams
): Promise<{ results: SearchResult[]; hasMore: boolean }> {
	const conditions: string[] = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const bindings: any[] = [];

	// Source filter
	if (params.sources.length > 0) {
		const placeholders = params.sources.map(() => '?').join(', ');
		conditions.push(`ps.source IN (${placeholders})`);
		bindings.push(...params.sources);
	}

	// Account filter
	if (params.accountDids.length > 0) {
		const placeholders = params.accountDids.map(() => '?').join(', ');
		conditions.push(`ps.account_did IN (${placeholders})`);
		bindings.push(...params.accountDids);
	}

	// Text search via LIKE on the pre-built search_text column
	if (params.query.trim()) {
		const terms = params.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		for (const term of terms) {
			conditions.push('p.search_text LIKE ?');
			bindings.push(`%${term}%`);
		}
	}

	// Structured filters
	if (params.filters.handles.length > 0) {
		const handleConditions = params.filters.handles.map(() => 'p.author_handle LIKE ?');
		conditions.push(`(${handleConditions.join(' OR ')})`);
		bindings.push(...params.filters.handles.map((h) => `%${h.toLowerCase()}%`));
	}
	if (params.filters.minLikes > 0) {
		conditions.push('p.like_count >= ?');
		bindings.push(params.filters.minLikes);
	}
	if (params.filters.minReposts > 0) {
		conditions.push('p.repost_count >= ?');
		bindings.push(params.filters.minReposts);
	}
	if (params.filters.minReplies > 0) {
		conditions.push('p.reply_count >= ?');
		bindings.push(params.filters.minReplies);
	}
	if (params.filters.dateAfter) {
		conditions.push('p.created_at >= ?');
		bindings.push(params.filters.dateAfter);
	}
	if (params.filters.dateBefore) {
		const before = new Date(new Date(params.filters.dateBefore).getTime() + 86400000).toISOString();
		conditions.push('p.created_at <= ?');
		bindings.push(before);
	}
	if (params.filters.hasImage) {
		conditions.push('p.has_image = 1');
	}
	if (params.filters.hasLink) {
		conditions.push('p.has_link = 1');
	}
	if (params.filters.hasVideo) {
		conditions.push('p.has_video = 1');
	}
	if (!params.filters.showReplies) {
		conditions.push('p.is_reply = 0');
	}

	const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

	// Always sort by date descending (no relevance ranking without FTS5)
	const orderClause = 'ORDER BY p.created_at DESC';

	// We need the current user's DID for liked/bookmarked status.
	const currentDid = params.accountDids[0] ?? '';

	// Build final bindings in positional order:
	// 1. currentDid x2 (for EXISTS subqueries in SELECT)
	// 2. WHERE clause bindings
	// 3. LIMIT, OFFSET
	const finalBindings = [currentDid, currentDid, ...bindings, params.limit + 1, params.offset];

	const sql = `
		SELECT DISTINCT p.raw, p.uri,
			EXISTS(SELECT 1 FROM post_sources WHERE uri = p.uri AND account_did = ? AND source = 'likes') as is_liked,
			EXISTS(SELECT 1 FROM post_sources WHERE uri = p.uri AND account_did = ? AND source = 'bookmarks') as is_bookmarked
		FROM posts p
		JOIN post_sources ps ON ps.uri = p.uri
		${whereClause}
		${orderClause}
		LIMIT ? OFFSET ?
	`;

	const rows = await (await db.prepare(sql)).all(...finalBindings) as {
		raw: string;
		uri: string;
		is_liked: number;
		is_bookmarked: number;
	}[];

	const hasMore = rows.length > params.limit;
	const results: SearchResult[] = rows.slice(0, params.limit).map((row) => ({
		doc: JSON.parse(row.raw),
		isLiked: row.is_liked === 1,
		isBookmarked: row.is_bookmarked === 1
	}));

	return { results, hasMore };
}

// --- Clear operations ---

export async function clearSource(db: Database, accountDid: string, source: SourceType) {
	await db.exec('BEGIN TRANSACTION');
	try {
		await (await db.prepare('DELETE FROM post_sources WHERE account_did = ? AND source = ?')).run(
			accountDid,
			source
		);
		await (await db.prepare('DELETE FROM sync_cursors WHERE account_did = ? AND source = ?')).run(
			accountDid,
			source
		);
		// Clean up orphaned posts
		await db.exec('DELETE FROM posts WHERE uri NOT IN (SELECT DISTINCT uri FROM post_sources)');
		await db.exec('COMMIT');
	} catch (e) {
		await db.exec('ROLLBACK');
		throw e;
	}
}

export async function clearAccountData(db: Database, accountDid: string) {
	await db.exec('BEGIN TRANSACTION');
	try {
		await (await db.prepare('DELETE FROM post_sources WHERE account_did = ?')).run(accountDid);
		await (await db.prepare('DELETE FROM sync_cursors WHERE account_did = ?')).run(accountDid);
		await (await db.prepare('DELETE FROM accounts WHERE did = ?')).run(accountDid);
		await db.exec('DELETE FROM posts WHERE uri NOT IN (SELECT DISTINCT uri FROM post_sources)');
		await db.exec('COMMIT');
	} catch (e) {
		await db.exec('ROLLBACK');
		throw e;
	}
}

export async function clearAllData(db: Database) {
	await db.exec('BEGIN TRANSACTION');
	try {
		await db.exec('DELETE FROM post_sources');
		await db.exec('DELETE FROM posts');
		await db.exec('DELETE FROM sync_cursors');
		await db.exec('DELETE FROM accounts');
		await db.exec('COMMIT');
	} catch (e) {
		await db.exec('ROLLBACK');
		throw e;
	}
}

// --- Utilities ---

export function getLink(uri: string, handle: string) {
	const [, , rkey] = uri.replace('at://', '').split('/');
	return `https://bsky.app/profile/${handle}/post/${rkey}`;
}
