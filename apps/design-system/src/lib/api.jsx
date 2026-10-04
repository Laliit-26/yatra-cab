import { createContext, useContext, useEffect, useState, useCallback } from 'react';

/**
 * Fetch-based API client with in-memory access token + one-shot refresh on 401.
 * The refresh token lives in an httpOnly cookie (credentials: 'include').
 */
export function createApi(baseURL) {
  let accessToken = null;

  const setToken = (t) => {
    accessToken = t;
  };

  async function raw(method, path, body, { auth = true, isRetry = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

    // fetch only rejects when the request never got an answer — server down,
    // wrong port, DNS, CORS, offline. Its own message ("Failed to fetch") ends
    // up in front of the user, so say the useful thing instead.
    let res;
    try {
      res = await fetch(`${baseURL}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      const err = new Error(
        navigator.onLine === false
          ? 'You appear to be offline.'
          : `Could not reach the server at ${baseURL}. Is the backend running?`
      );
      err.status = 0;
      throw err;
    }

    // Attempt a silent refresh once on 401.
    if (res.status === 401 && auth && !isRetry && path !== '/auth/refresh') {
      const refreshed = await tryRefresh();
      if (refreshed) return raw(method, path, body, { auth, isRetry: true });
    }

    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok) {
      const err = new Error(data?.message || `Request failed (${res.status})`);
      err.status = res.status;
      err.details = data?.details;
      throw err;
    }
    return data;
  }

  async function tryRefresh() {
    try {
      const res = await fetch(`${baseURL}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.accessToken) {
        accessToken = data.accessToken;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  return {
    baseURL,
    setToken,
    getToken: () => accessToken,
    get: (p, opts) => raw('GET', p, undefined, opts),
    post: (p, b, opts) => raw('POST', p, b, opts),
    patch: (p, b, opts) => raw('PATCH', p, b, opts),
    del: (p, b, opts) => raw('DELETE', p, b, opts),
    refresh: tryRefresh,
  };
}

const AuthContext = createContext(null);

/**
 * Restores the session on load via the refresh cookie, exposes the current
 * user, and provides login/logout. `mapMe` extracts extra profile data
 * (e.g. the driver document) from GET /auth/me.
 */
export function AuthProvider({ api, children, mapMe, roles }) {
  const [user, setUser] = useState(null);
  const [extra, setExtra] = useState(null);
  const [loading, setLoading] = useState(true);

  // A portal only accepts its own role(s). On localhost the refresh cookie is
  // shared across ports, so without this the customer/driver/admin portals
  // would restore each other's sessions. In production they live on separate
  // domains and never collide.
  const roleAllowed = useCallback((role) => !roles || roles.includes(role), [roles]);

  const loadMe = useCallback(async () => {
    const me = await api.get('/auth/me');
    if (!roleAllowed(me.user.role)) {
      api.setToken(null);
      setUser(null);
      setExtra(null);
      return null;
    }
    setUser(me.user);
    setExtra(mapMe ? mapMe(me) : null);
    return me;
  }, [api, mapMe, roleAllowed]);

  useEffect(() => {
    let active = true;
    (async () => {
      const ok = await api.refresh();
      if (!active) return;
      if (ok) {
        try {
          await loadMe();
        } catch {
          setUser(null);
        }
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [api, loadMe]);

  const login = useCallback(
    async (u, token) => {
      api.setToken(token);
      setUser(u);
      try {
        await loadMe();
      } catch {
        /* keep basic user */
      }
    },
    [api, loadMe]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    api.setToken(null);
    setUser(null);
    setExtra(null);
  }, [api]);

  return (
    <AuthContext.Provider value={{ user, setUser, extra, setExtra, loading, login, logout, refreshMe: loadMe, api }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
