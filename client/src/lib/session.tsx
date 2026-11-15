import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth, type User } from './ns';

interface Session { user: User | null | undefined; setUser: (u: User | null) => void; refresh: () => Promise<void> }
const Ctx = createContext<Session>({ user: undefined, setUser: () => undefined, refresh: async () => undefined });

/** `user` is undefined while the first check is in flight, null when signed out. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const refresh = useCallback(async () => setUser(await auth.me()), []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <Ctx.Provider value={{ user, setUser, refresh }}>{children}</Ctx.Provider>;
}
export const useSession = () => useContext(Ctx);
