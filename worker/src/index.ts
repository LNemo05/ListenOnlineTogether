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

type Variables = {
  user: JWTPayload;
};

type RoomState = {
  songId: string | null;
  playbackMs: number;
  isPlaying: boolean;
};

const encoder = new TextEncoder();
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', cors());

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

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
    const token = authHeader.slice(7);
    const payload = await verifyToken(c.env.JWT_SECRET, token);
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ error: 'invalid token' }, 401);
  }
};

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/auth/register', async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  if (!body.username || !body.password) return c.json({ error: 'missing username/password' }, 400);

  const salt = uuid();
  const hash = await hashPassword(body.password, salt);
  const id = uuid();

  const result = await c.env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, body.username, hash, salt, nowIso())
    .run();

  if (!result.success) return c.json({ error: 'username exists' }, 409);
  const token = await signToken(c.env.JWT_SECRET, id, body.username);
  return c.json({ token });
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  if (!body.username || !body.password) return c.json({ error: 'missing username/password' }, 400);

  const user = await c.env.DB.prepare('SELECT id, username, password_hash, salt FROM users WHERE username = ?')
    .bind(body.username)
    .first<{ id: string; username: string; password_hash: string; salt: string }>();

  if (!user) return c.json({ error: 'invalid credentials' }, 401);

  const hash = await hashPassword(body.password, user.salt);
  if (hash !== user.password_hash) return c.json({ error: 'invalid credentials' }, 401);

  const token = await signToken(c.env.JWT_SECRET, user.id, user.username);
  return c.json({ token });
});

app.get('/api/music/search', async (c) => {
  const q = c.req.query('q') ?? '';
  const base = c.env.MUSIC_API_BASE ?? 'https://music.gdstudio.xyz';

  const resp = await fetch(`${base}/search?keywords=${encodeURIComponent(q)}`);
  if (!resp.ok) return c.json({ error: 'upstream_error', status: resp.status }, 502);

  const data = await resp.json<any>();
  const result = (data?.result?.songs ?? []).slice(0, 10).map((song: any) => ({
    id: String(song.id),
    name: song.name,
    artist: song.artists?.[0]?.name ?? 'Unknown',
    cover: song.album?.picUrl ?? ''
  }));

  return c.json({ result });
});

app.post('/api/playlists', auth, async (c) => {
  const body = await c.req.json<{ name: string }>();
  const user = c.get('user') as JWTPayload;
  const id = uuid();

  await c.env.DB.prepare('INSERT INTO playlists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, user.sub, body.name, nowIso())
    .run();

  return c.json({ id, name: body.name });
});

app.get('/api/playlists', auth, async (c) => {
  const user = c.get('user') as JWTPayload;
  const rows = await c.env.DB.prepare('SELECT id, name, created_at FROM playlists WHERE user_id = ? ORDER BY created_at DESC')
    .bind(user.sub)
    .all();
  return c.json({ result: rows.results ?? [] });
});

app.post('/api/rooms', auth, async (c) => {
  const body = await c.req.json<{ playlistId?: string }>();
  const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  const user = c.get('user') as JWTPayload;
  await c.env.ROOM_META.put(
    `room:${roomCode}`,
    JSON.stringify({ roomCode, createdBy: user.sub, playlistId: body.playlistId ?? null, createdAt: nowIso() }),
    { expirationTtl: 60 * 60 * 24 }
  );
  return c.json({ roomCode });
});

app.get('/api/rooms/:code/meta', auth, async (c) => {
  const code = c.req.param('code').toUpperCase();
  const meta = await c.env.ROOM_META.get(`room:${code}`);
  if (!meta) return c.json({ error: 'room_not_found' }, 404);
  return c.json(JSON.parse(meta));
});

app.get('/api/rooms/:code/ws', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'missing token' }, 401);

  try {
    await verifyToken(c.env.JWT_SECRET, token);
  } catch {
    return c.json({ error: 'invalid token' }, 401);
  }

  const id = c.env.ROOMS.idFromName(code);
  return c.env.ROOMS.get(id).fetch(c.req.raw);
});

export class RoomSyncDO {
  sessions = new Set<WebSocket>();
  roomState: RoomState = { songId: null, playbackMs: 0, isPlaying: false };

  async fetch(request: Request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sessions.add(server);

    server.send(JSON.stringify({ type: 'meta', online: this.sessions.size, ...this.roomState }));

    server.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.type !== 'control') return;

      this.roomState = {
        songId: msg.songId,
        playbackMs: msg.playbackMs,
        isPlaying: msg.action === 'play'
      };

      const payload = JSON.stringify({
        type: 'sync',
        action: msg.action,
        songId: msg.songId,
        playbackMs: msg.playbackMs,
        sentAt: msg.sentAt,
        online: this.sessions.size
      });

      for (const ws of this.sessions) {
        if (ws !== server) ws.send(payload);
      }
    });

    server.addEventListener('close', () => {
      this.sessions.delete(server);
      const payload = JSON.stringify({ type: 'meta', online: this.sessions.size, ...this.roomState });
      for (const ws of this.sessions) ws.send(payload);
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default app;
