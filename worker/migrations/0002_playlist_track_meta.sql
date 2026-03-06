ALTER TABLE playlist_tracks ADD COLUMN source TEXT NOT NULL DEFAULT 'netease';
ALTER TABLE playlist_tracks ADD COLUMN lyric_id TEXT;
ALTER TABLE playlist_tracks ADD COLUMN pic_id TEXT;
