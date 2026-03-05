import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SignJWT, jwtVerify, JWTPayload } from 'jose';

type Env = {
  DB: D1Database;
  ROOMS: DurableObjectNamespace;
  ROOM_META: KVNamespace;
  JWT_SECRET: string;
  MUSIC_API_BASE?: string;
};

type Variables = { user: JWTPayload };
type RoomState = { songId: string | null; playbackMs: number; isPlaying: boolean; source: string };

const encoder = new TextEncoder();
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', cors());

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const musicBase = (env: Env) => env.MUSIC_API_BASE ?? 'https://music-api.gdstudio.xyz/api.php';
const allowedSources = new Set([
  'netease', 'tencent', 'tidal', 'spotify', 'ytmusic', 'qobuz', 'joox', 'deezer', 'migu', 'kugou', 'kuwo', 'ximalaya', 'apple'
]);
const parseSource = (source?: string | null) => (source && allowedSources.has(source) ? source : 'netease');

async function hashPassword(password: string, salt: string) {
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:${password}`));
  return [...new Uint8Array(raw)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signToken(secret: string, userId: string, username: string) {
  return new SignJWT({ sub: userId, username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(encoder.encode(secret));
}

async function verifyToken(secret: string, token: string) {
  const { payload } = await jwtVerify(token, encoder.encode(secret));
  return payload;
}

const auth = async (c: any, next: () => Promise<void>) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'unauthorized' }, 401);
  try {
    const payload = await verifyToken(c.env.JWT_SECRET, authHeader.slice(7));
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ error: 'invalid token' }, 401);
  }
};

async function ensurePlaylistOwner(c: any, playlistId: string, userId: string) {
  const row = await c.env.DB.prepare('SELECT id FROM playlists WHERE id = ? AND user_id = ?').bind(playlistId, userId).first();
  return Boolean(row);
}

app.get('/', (c) => c.html('<h1>Listen Online Together API</h1><p>Use frontend for full player UI.</p>'));
app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/auth/register', async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  if (!body.username || !body.password) return c.json({ error: 'missing username/password' }, 400);
  const salt = uuid();
  const hash = await hashPassword(body.password, salt);
  const id = uuid();
  const result = await c.env.DB.prepare('INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, body.username, hash, salt, nowIso())
    .run();
  if (!result.success) return c.json({ error: 'username exists' }, 409);
  return c.json({ token: await signToken(c.env.JWT_SECRET, id, body.username) });
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  if (!body.username || !body.password) return c.json({ error: 'missing username/password' }, 400);
  const user = await c.env.DB.prepare('SELECT id, username, password_hash, salt FROM users WHERE username = ?')
    .bind(body.username)
    .first<{ id: string; username: string; password_hash: string; salt: string }>();
  if (!user) return c.json({ error: 'invalid credentials' }, 401);
  if ((await hashPassword(body.password, user.salt)) !== user.password_hash) return c.json({ error: 'invalid credentials' }, 401);
  return c.json({ token: await signToken(c.env.JWT_SECRET, user.id, user.username) });
});

app.get('/api/music/search', async (c) => {
  const name = c.req.query('q') ?? '';
  const source = parseSource(c.req.query('source'));
  const count = Number(c.req.query('count') ?? '20');
  const pages = Number(c.req.query('pages') ?? '1');
  const url = `${musicBase(c.env)}?types=search&source=${encodeURIComponent(source)}&name=${encodeURIComponent(name)}&count=${count}&pages=${pages}`;
  const resp = await fetch(url);
  if (!resp.ok) return c.json({ error: 'upstream_error', status: resp.status }, 502);
  const data = await resp.json<any[]>();
  return c.json({
    result: (data ?? []).map((song: any) => ({
      id: String(song.id),
      name: String(song.name ?? 'Unknown'),
      artist: Array.isArray(song.artist) ? song.artist.join(' / ') : String(song.artist ?? 'Unknown'),
      album: String(song.album ?? ''),
      source: String(song.source ?? source),
      lyricId: String(song.lyric_id ?? song.id ?? ''),
      picId: String(song.pic_id ?? ''),
      cover: ''
    }))
  });
});

app.get('/api/music/url/:id', async (c) => {
  const id = c.req.param('id');
  const source = parseSource(c.req.query('source'));
  const br = c.req.query('br') ?? '999';
  const url = `${musicBase(c.env)}?types=url&source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&br=${encodeURIComponent(br)}`;
  const resp = await fetch(url);
  if (!resp.ok) return c.json({ error: 'upstream_error', status: resp.status }, 502);
  const data = await resp.json<any>();
  return c.json({ id, source, url: data?.url ?? null, br: data?.br ?? null, size: data?.size ?? null });
});

app.get('/api/music/pic/:id', async (c) => {
  const id = c.req.param('id');
  const source = parseSource(c.req.query('source'));
  const size = c.req.query('size') ?? '500';
  const url = `${musicBase(c.env)}?types=pic&source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&size=${encodeURIComponent(size)}`;
  const resp = await fetch(url);
  if (!resp.ok) return c.json({ error: 'upstream_error', status: resp.status }, 502);
  const data = await resp.json<any>();
  return c.json({ id, source, url: data?.url ?? '' });
});

app.get('/api/music/lyric/:id', async (c) => {
  const id = c.req.param('id');
  const source = parseSource(c.req.query('source'));
  const url = `${musicBase(c.env)}?types=lyric&source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`;
  const resp = await fetch(url);
  if (!resp.ok) return c.json({ error: 'upstream_error', status: resp.status }, 502);
  const data = await resp.json<any>();
  return c.json({ id, source, lyric: data?.lyric ?? '暂无歌词', tlyric: data?.tlyric ?? '' });
});

app.post('/api/playlists', auth, async (c) => {
  const body = await c.req.json<{ name: string }>();
  const user = c.get('user') as JWTPayload;
  const id = uuid();
  await c.env.DB.prepare('INSERT INTO playlists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)').bind(id, user.sub, body.name, nowIso()).run();
  return c.json({ id, name: body.name });
});

app.get('/api/playlists', auth, async (c) => {
  const user = c.get('user') as JWTPayload;
  const rows = await c.env.DB.prepare('SELECT id, name, created_at FROM playlists WHERE user_id = ? ORDER BY created_at DESC').bind(user.sub).all();
  return c.json({ result: rows.results ?? [] });
});

app.get('/api/playlists/:id/tracks', auth, async (c) => {
  const playlistId = c.req.param('id');
  const user = c.get('user') as JWTPayload;
  if (!(await ensurePlaylistOwner(c, playlistId, String(user.sub)))) return c.json({ error: 'forbidden' }, 403);
  const rows = await c.env.DB.prepare(
    'SELECT id, playlist_id, track_id, song_name, artist_name, cover_url, source, lyric_id, pic_id, created_at FROM playlist_tracks WHERE playlist_id = ? ORDER BY created_at DESC'
  ).bind(playlistId).all();
  return c.json({ result: rows.results ?? [] });
});

app.post('/api/playlists/:id/tracks', auth, async (c) => {
  const playlistId = c.req.param('id');
  const user = c.get('user') as JWTPayload;
  if (!(await ensurePlaylistOwner(c, playlistId, String(user.sub)))) return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json<{ trackId: string; songName: string; artistName: string; coverUrl: string; source?: string; lyricId?: string; picId?: string }>();
  await c.env.DB.prepare(
    'INSERT INTO playlist_tracks (playlist_id, track_id, song_name, artist_name, cover_url, source, lyric_id, pic_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(playlistId, body.trackId, body.songName, body.artistName, body.coverUrl, parseSource(body.source), body.lyricId ?? null, body.picId ?? null, nowIso()).run();
  return c.json({ ok: true });
});

app.delete('/api/playlists/:id/tracks/:trackId', auth, async (c) => {
  const user = c.get('user') as JWTPayload;
  if (!(await ensurePlaylistOwner(c, c.req.param('id'), String(user.sub)))) return c.json({ error: 'forbidden' }, 403);
  await c.env.DB.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').bind(c.req.param('id'), c.req.param('trackId')).run();
  return c.json({ ok: true });
});

app.post('/api/rooms', auth, async (c) => {
  const body = await c.req.json<{ playlistId?: string }>();
  const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  const user = c.get('user') as JWTPayload;
  await c.env.ROOM_META.put(`room:${roomCode}`, JSON.stringify({ roomCode, createdBy: user.sub, playlistId: body.playlistId ?? null, createdAt: nowIso() }), { expirationTtl: 86400 });
  return c.json({ roomCode });
});

app.get('/api/rooms/:code/ws', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'missing token' }, 401);
  let userId = 'anonymous';
  try {
    const p = await verifyToken(c.env.JWT_SECRET, token);
    userId = String(p.sub ?? 'anonymous');
  } catch {
    return c.json({ error: 'invalid token' }, 401);
  }
  const roomCode = c.req.param('code').toUpperCase();
  const id = c.env.ROOMS.idFromName(roomCode);
  const req = new Request(c.req.raw, { headers: new Headers(c.req.raw.headers) });
  req.headers.set('x-user-id', userId);
  return c.env.ROOMS.get(id).fetch(req);
});

export class RoomSyncDO {
  sessions = new Set<WebSocket>();
  users = new Map<WebSocket, string>();
  roomState: RoomState = { songId: null, playbackMs: 0, isPlaying: false, source: 'netease' };

  async fetch(request: Request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sessions.add(server);
    this.users.set(server, request.headers.get('x-user-id') ?? 'anonymous');

    const broadcastMeta = () => {
      const payload = JSON.stringify({ type: 'meta', online: this.sessions.size, ...this.roomState });
      for (const ws of this.sessions) ws.send(payload);
    };
    broadcastMeta();

    server.addEventListener('message', (event) => {
      let msg: any;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.type === 'leave') return server.close();
      if (msg.type === 'join') return broadcastMeta();
      if (msg.type !== 'control') return;
      this.roomState = {
        songId: String(msg.songId ?? ''),
        playbackMs: Number(msg.playbackMs ?? 0),
        isPlaying: msg.action === 'play' || msg.action === 'next',
        source: parseSource(msg.source)
      };
      const payload = JSON.stringify({ type: 'sync', action: msg.action, songId: msg.songId, playbackMs: msg.playbackMs, source: this.roomState.source, sentAt: msg.sentAt, from: this.users.get(server), online: this.sessions.size });
      for (const ws of this.sessions) if (ws !== server) ws.send(payload);
      broadcastMeta();
    });

    server.addEventListener('close', () => {
      this.sessions.delete(server);
      this.users.delete(server);
      broadcastMeta();
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default app;
