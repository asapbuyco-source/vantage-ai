import { auth } from "../firebaseConfig";

let cachedJwt: { token: string; expiresAt: number } | null = null;

const backendUrl = () => {
  const url = import.meta.env.VITE_BACKEND_URL;
  if (!url) throw new Error("VITE_BACKEND_URL is not configured");
  return url.replace(/\/$/, "");
};

async function fetchAdminJwt(force = false): Promise<string> {
  const now = Date.now();
  if (!force && cachedJwt && cachedJwt.expiresAt - 30_000 > now) {
    return cachedJwt.token;
  }

  const user = auth.currentUser;
  if (!user) throw new Error("Admin login required");

  const idToken = await user.getIdToken(force);
  const res = await fetch(`${backendUrl()}/api/admin/token`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new Error(data.error || "Could not get admin token");
  }

  cachedJwt = {
    token: data.token,
    expiresAt: Date.now() + Number(data.expiresIn || 900) * 1000,
  };
  sessionStorage.setItem("admin_jwt", cachedJwt.token);
  return cachedJwt.token;
}

export async function adminFetch(path: string, init: RequestInit = {}) {
  let token = await fetchAdminJwt();
  let res = await fetch(`${backendUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    token = await fetchAdminJwt(true);
    res = await fetch(`${backendUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Admin request failed: ${res.status}`);
  return data;
}