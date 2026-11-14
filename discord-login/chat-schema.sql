CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_messages_created ON chat_messages(created_at DESC, id DESC);

-- Preserve the original messages for the team-only Shoutbox composer.
CREATE TABLE IF NOT EXISTS public_chat_messages (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS public_chat_messages_created ON public_chat_messages(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS chat_mutes (
  discord_id TEXT PRIMARY KEY,
  muted_until INTEGER NOT NULL,
  moderator_id TEXT NOT NULL
);
