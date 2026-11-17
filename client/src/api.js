// Small fetch wrapper: JSON in, JSON out, throws Error(message) on failure.
export async function api(path, { method = 'GET', body } = {}) {
  // The server only accepts changes sent as JSON (a guard against other websites posting here), so every
  // non-GET request carries a JSON body, even an empty one (e.g. sign out).
  if (method !== 'GET' && body === undefined) body = {};
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
