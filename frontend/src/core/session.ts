import { create } from 'zustand';
import { ApiError, fetchMe, signIn as apiSignIn, signOut as apiSignOut, type Credentials, type User } from './api';

export type SessionStatus = 'loading' | 'anonymous' | 'signed-in';

interface SessionState {
  status: SessionStatus;
  user: User | null;
  error: string | null;
  bootstrap(): Promise<void>;
  signIn(credentials: Credentials): Promise<boolean>;
  signOut(): Promise<void>;
}

const UNREACHABLE = 'The Spot Canvas API is not reachable.';

const describe = (error: unknown): string => (error instanceof ApiError ? error.message : UNREACHABLE);

export const useSession = create<SessionState>()((set) => ({
  status: 'loading',
  user: null,
  error: null,

  async bootstrap() {
    try {
      const user = await fetchMe();
      set(user ? { status: 'signed-in', user, error: null } : { status: 'anonymous', user: null, error: null });
    } catch (error) {
      set({ status: 'anonymous', user: null, error: describe(error) });
    }
  },

  async signIn(credentials) {
    try {
      const user = await apiSignIn(credentials);
      set({ status: 'signed-in', user, error: null });
      return true;
    } catch (error) {
      set({ status: 'anonymous', user: null, error: describe(error) });
      return false;
    }
  },

  async signOut() {
    try {
      await apiSignOut();
    } catch (error) {
      // The server session may outlive this tab, but the client is signed out regardless.
      console.warn('[spot-canvas] sign-out request failed', error);
    }
    set({ status: 'anonymous', user: null, error: null });
  }
}));
