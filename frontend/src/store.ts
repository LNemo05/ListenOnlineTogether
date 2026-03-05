import { create } from 'zustand';

export type SyncAction = 'play' | 'pause' | 'seek' | 'next';

type AppState = {
  token: string | null;
  roomCode: string;
  playingSongId: string | null;
  playbackMs: number;
  isPlaying: boolean;
  setToken: (token: string | null) => void;
  setRoomCode: (roomCode: string) => void;
  setPlayback: (songId: string | null, playbackMs: number, isPlaying: boolean) => void;
};

export const useAppStore = create<AppState>((set) => ({
  token: localStorage.getItem('lot_token'),
  roomCode: '',
  playingSongId: null,
  playbackMs: 0,
  isPlaying: false,
  setToken: (token) =>
    set(() => {
      if (token) localStorage.setItem('lot_token', token);
      else localStorage.removeItem('lot_token');
      return { token };
    }),
  setRoomCode: (roomCode) => set(() => ({ roomCode })),
  setPlayback: (playingSongId, playbackMs, isPlaying) => set(() => ({ playingSongId, playbackMs, isPlaying }))
}));
