const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8787';

export type Song = { id: string; name: string; artist: string; cover: string };

export async function apiFetch<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function searchSongs(keyword: string) {
  return apiFetch<{ result: Song[] }>(`/api/music/search?q=${encodeURIComponent(keyword)}`);
}
