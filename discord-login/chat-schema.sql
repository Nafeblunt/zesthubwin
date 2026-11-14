CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_messages_created ON chat_messages(created_at DESC, id DESC);
