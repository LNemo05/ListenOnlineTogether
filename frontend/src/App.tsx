import { FormEvent, useMemo, useRef, useState } from 'react';
import { apiFetch, searchSongs, Song } from './api';
import { useAppStore } from './store';

function App() {
  const { token, setToken, roomCode, setRoomCode, applyRemoteAction, playingSongId, playbackMs, isPlaying } = useAppStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [keyword, setKeyword] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const seekTimer = useRef<number | null>(null);

  const authLabel = useMemo(() => (token ? '已登录' : '未登录'), [token]);

  const auth = async (endpoint: '/api/auth/register' | '/api/auth/login', e: FormEvent) => {
    e.preventDefault();
    const result = await apiFetch<{ token: string }>(endpoint, {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setToken(result.token);
  };

  const connectRoom = () => {
    if (!token || !roomCode) return;
    wsRef.current?.close();
    const ws = new WebSocket(`ws://127.0.0.1:8787/api/rooms/${roomCode}/ws?token=${token}`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'sync') {
        applyRemoteAction(data.action, data.songId, data.playbackMs);
      }
    };
    wsRef.current = ws;
  };

  const sendSync = (action: 'play' | 'pause' | 'seek' | 'next', songId: string, ms: number) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'control', action, songId, playbackMs: ms, sentAt: Date.now() }));
  };

  const handleSeek = (songId: string, ms: number) => {
    if (seekTimer.current) window.clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(() => sendSync('seek', songId, ms), 120);
  };

  return (
    <main className="container">
      <h1>Listen Online Together</h1>
      <p className="small">状态：{authLabel} · 房间：{roomCode || '未加入'}</p>
      <section className="card">
        <h2>注册 / 登录（用户名 + 密码）</h2>
        <p className="warning">⚠️ 本站不绑定邮箱，忘记密码将无法找回账号及歌单，请务必牢记密码。</p>
        <form className="row" onSubmit={(e) => auth('/api/auth/login', e)}>
          <input placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input placeholder="密码" value={password} type="password" onChange={(e) => setPassword(e.target.value)} />
          <button type="button" onClick={(e) => auth('/api/auth/register', e as unknown as FormEvent)}>注册</button>
          <button type="submit">登录</button>
        </form>
      </section>

      <section className="card">
        <h2>音乐搜索（经后端代理）</h2>
        <div className="row">
          <input placeholder="输入关键字" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <button onClick={async () => setSongs((await searchSongs(keyword)).result)}>搜索</button>
        </div>
        {songs.map((song) => (
          <div key={song.id} className="track">
            <div>
              <strong>{song.name}</strong>
              <div className="small">{song.artist}</div>
            </div>
            <div className="row">
              <button onClick={() => sendSync('play', song.id, 0)}>同步播放</button>
              <button className="secondary" onClick={() => sendSync('pause', song.id, playbackMs)}>暂停</button>
              <button className="secondary" onClick={() => handleSeek(song.id, 45000)}>跳转45s</button>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>多人同步房间（全员平权）</h2>
        <div className="row">
          <input placeholder="输入匹配码" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} />
          <button onClick={connectRoom}>加入房间</button>
        </div>
        <p className="small">当前状态：{isPlaying ? '播放中' : '暂停'} · 歌曲ID：{playingSongId ?? '无'} · 进度：{playbackMs} ms</p>
      </section>
    </main>
  );
}

export default App;
