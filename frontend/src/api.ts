const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8787';

export type Song = { id: string; name: string; artist: string; cover: string };
export type Playlist = { id: string; name: string; created_at: string };
export type PlaylistTrack = {
  id: number;
  playlist_id: string;
  track_id: string;
  song_name: string;
  artist_name: string;
  cover_url: string;
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

export function wsBase() {
  return API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');
}

export async function searchSongs(keyword: string) {
  return apiFetch<{ result: Song[] }>(`/api/music/search?q=${encodeURIComponent(keyword)}`);
}

export async function trackUrl(id: string) {
  return apiFetch<{ id: string; url: string | null }>(`/api/music/url/${id}`);
}

export async function trackDetail(id: string) {
  return apiFetch<{ id: string; name: string; artist: string; cover: string }>(`/api/music/detail/${id}`);
}

export async function trackLyric(id: string) {
  return apiFetch<{ id: string; lyric: string }>(`/api/music/lyric/${id}`);
}
