const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8787';

export type Song = {
  id: string;
  name: string;
  artist: string;
  album: string;
  source: string;
  lyricId: string;
  picId: string;
  cover: string;
};

export type Playlist = { id: string; name: string; created_at: string };

export type PlaylistTrack = {
  id: number;
  playlist_id: string;
  track_id: string;
  song_name: string;
  artist_name: string;
  cover_url: string;
  source?: string;
  lyric_id?: string;
  pic_id?: string;
  created_at: string;
};

export async function apiFetch<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error((await res.text()) || `Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export const wsBase = () => API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');

export const searchSongs = (keyword: string, source: string, count = 20, pages = 1) =>
  apiFetch<{ result: Song[] }>(`/api/music/search?q=${encodeURIComponent(keyword)}&source=${source}&count=${count}&pages=${pages}`);

export const trackUrl = (id: string, source: string, br: string) =>
  apiFetch<{ id: string; source: string; url: string | null; br?: string }>(`/api/music/url/${id}?source=${source}&br=${br}`);

export const trackPic = (picId: string, source: string, size = '500') =>
  apiFetch<{ id: string; source: string; url: string }>(`/api/music/pic/${picId}?source=${source}&size=${size}`);

export const trackLyric = (lyricId: string, source: string) =>
  apiFetch<{ id: string; source: string; lyric: string; tlyric?: string }>(`/api/music/lyric/${lyricId}?source=${source}`);
