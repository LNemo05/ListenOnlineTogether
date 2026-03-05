import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, Playlist, PlaylistTrack, searchSongs, Song, trackDetail, trackLyric, trackUrl, wsBase } from './api';
import { useAppStore } from './store';

function App() {
  const { token, setToken, roomCode, setRoomCode, setPlayback, playingSongId, playbackMs, isPlaying } = useAppStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [keyword, setKeyword] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistName, setPlaylistName] = useState('我的歌单');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState('未播放');
  const [currentArtist, setCurrentArtist] = useState('');
  const [currentLyric, setCurrentLyric] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const seekTimer = useRef<number | null>(null);
  const applyingRemote = useRef(false);

  const authLabel = useMemo(() => (token ? '已登录' : '未登录'), [token]);

  const auth = async (endpoint: '/api/auth/register' | '/api/auth/login', e: FormEvent) => {
    e.preventDefault();
    const result = await apiFetch<{ token: string }>(endpoint, {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setToken(result.token);
  };

  const loadPlaylists = async () => {
    if (!token) return;
    const res = await apiFetch<{ result: Playlist[] }>('/api/playlists', {}, token);
    setPlaylists(res.result);
    if (!selectedPlaylistId && res.result[0]) setSelectedPlaylistId(res.result[0].id);
  };

  const loadTracks = async (playlistId: string) => {
    if (!token || !playlistId) return;
    const res = await apiFetch<{ result: PlaylistTrack[] }>(`/api/playlists/${playlistId}/tracks`, {}, token);
    setTracks(res.result);
  };

  useEffect(() => {
    loadPlaylists();
  }, [token]);

  useEffect(() => {
    loadTracks(selectedPlaylistId);
  }, [selectedPlaylistId, token]);

  const startTrack = async (song: { id: string; name?: string; artist?: string }) => {
    const [urlRes, detailRes, lyricRes] = await Promise.all([trackUrl(song.id), trackDetail(song.id), trackLyric(song.id)]);
    if (!urlRes.url) throw new Error('该歌曲暂无可用播放链接');
    setCurrentUrl(urlRes.url);
    setCurrentTitle(detailRes.name || song.name || '未知歌曲');
    setCurrentArtist(detailRes.artist || song.artist || '未知歌手');
    setCurrentLyric(lyricRes.lyric || '暂无歌词');
    setPlayback(song.id, 0, true);
    requestAnimationFrame(() => {
      audioRef.current?.play().catch(() => undefined);
    });
  };

  const sendControl = (action: 'play' | 'pause' | 'seek' | 'next', songId: string, ms: number) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'control', action, songId, playbackMs: Math.floor(ms), sentAt: Date.now() }));
  };

  const connectRoom = () => {
    if (!token || !roomCode) return;
    wsRef.current?.close();
    const ws = new WebSocket(`${wsBase()}/api/rooms/${roomCode}/ws?token=${token}`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', roomCode }));
    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data as string);
      if (data.type !== 'sync') return;
      applyingRemote.current = true;
      try {
        if (data.songId && data.songId !== playingSongId) {
          await startTrack({ id: data.songId });
        }
        if (audioRef.current) {
          if (typeof data.playbackMs === 'number') audioRef.current.currentTime = data.playbackMs / 1000;
          if (data.action === 'play' || data.action === 'next') await audioRef.current.play().catch(() => undefined);
          if (data.action === 'pause') audioRef.current.pause();
          setPlayback(data.songId ?? playingSongId, data.playbackMs ?? 0, data.action === 'play' || data.action === 'next');
        }
      } finally {
        applyingRemote.current = false;
      }
    };
    wsRef.current = ws;
  };

  const createRoom = async () => {
    if (!token || !selectedPlaylistId) return;
    const res = await apiFetch<{ roomCode: string }>('/api/rooms', { method: 'POST', body: JSON.stringify({ playlistId: selectedPlaylistId }) }, token);
    setRoomCode(res.roomCode);
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
        <h2>音乐搜索 & 在线播放</h2>
        <div className="row">
          <input placeholder="输入关键字" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <button onClick={async () => setSongs((await searchSongs(keyword)).result)}>搜索</button>
        </div>
        <div className="small">正在播放：{currentTitle} {currentArtist ? `- ${currentArtist}` : ''}</div>
        <audio
          ref={audioRef}
          src={currentUrl ?? undefined}
          controls
          className="audio"
          onPlay={() => {
            if (applyingRemote.current || !playingSongId) return;
            setPlayback(playingSongId, (audioRef.current?.currentTime ?? 0) * 1000, true);
            sendControl('play', playingSongId, (audioRef.current?.currentTime ?? 0) * 1000);
          }}
          onPause={() => {
            if (applyingRemote.current || !playingSongId) return;
            setPlayback(playingSongId, (audioRef.current?.currentTime ?? 0) * 1000, false);
            sendControl('pause', playingSongId, (audioRef.current?.currentTime ?? 0) * 1000);
          }}
          onSeeked={() => {
            if (applyingRemote.current || !playingSongId) return;
            if (seekTimer.current) window.clearTimeout(seekTimer.current);
            seekTimer.current = window.setTimeout(() => sendControl('seek', playingSongId, (audioRef.current?.currentTime ?? 0) * 1000), 120);
          }}
        />
        <pre className="lyric">{currentLyric}</pre>
        {songs.map((song) => (
          <div key={song.id} className="track">
            <div><strong>{song.name}</strong><div className="small">{song.artist}</div></div>
            <div className="row">
              <button onClick={() => startTrack(song)}>播放</button>
              <button className="secondary" onClick={async () => {
                if (!token || !selectedPlaylistId) return;
                await apiFetch(`/api/playlists/${selectedPlaylistId}/tracks`, {
                  method: 'POST',
                  body: JSON.stringify({ trackId: song.id, songName: song.name, artistName: song.artist, coverUrl: song.cover })
                }, token);
                loadTracks(selectedPlaylistId);
              }}>加入歌单</button>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>歌单管理</h2>
        <div className="row">
          <input value={playlistName} onChange={(e) => setPlaylistName(e.target.value)} placeholder="新歌单名称" />
          <button onClick={async () => {
            if (!token) return;
            await apiFetch('/api/playlists', { method: 'POST', body: JSON.stringify({ name: playlistName }) }, token);
            loadPlaylists();
          }}>创建歌单</button>
          <select value={selectedPlaylistId} onChange={(e) => setSelectedPlaylistId(e.target.value)}>
            <option value="">选择歌单</option>
            {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {tracks.map((t, idx) => (
          <div key={`${t.playlist_id}-${t.track_id}`} className="track">
            <div><strong>{t.song_name}</strong><div className="small">{t.artist_name}</div></div>
            <div className="row">
              <button onClick={async () => {
                await startTrack({ id: t.track_id });
                sendControl('next', t.track_id, 0);
              }}>播放</button>
              <button className="secondary" onClick={async () => {
                if (!token || !selectedPlaylistId) return;
                await apiFetch(`/api/playlists/${selectedPlaylistId}/tracks/${t.track_id}`, { method: 'DELETE' }, token);
                loadTracks(selectedPlaylistId);
              }}>删除</button>
              {idx < tracks.length - 1 && <button className="secondary" onClick={async () => {
                const next = tracks[idx + 1];
                await startTrack({ id: next.track_id });
                sendControl('next', next.track_id, 0);
              }}>下一首</button>}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>多人同步房间（全员平权）</h2>
        <div className="row">
          <button onClick={createRoom}>按当前歌单创建房间</button>
          <input placeholder="输入匹配码" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} />
          <button onClick={connectRoom}>加入房间</button>
        </div>
        <p className="small">当前播放：{playingSongId ?? '无'} · {isPlaying ? '播放中' : '暂停'} · {Math.floor(playbackMs)}ms</p>
      </section>
    </main>
  );
}

export default App;
