export class ApiError extends Error {
  constructor(status, code, details) { super(code); this.status = status; this.code = code; this.details = details; }
}

export async function api(method, path, body, opts = {}) {
  const headers = { 'X-Requested-With': 'mavrix' };
  let payload;
  if (body instanceof Blob) { headers['Content-Type'] = body.type; payload = body; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error || 'server_error', json.details);
  return json;
}
export const get = (p, o) => api('GET', p, undefined, o);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const patch = (p, b = {}) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);

// Upload an image file; the server validates + compresses and returns a storage URL.
export async function uploadImage(file) {
  const { url } = await api('POST', '/uploads', file);
  return url;
}

export const rupees = (paise) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format((paise || 0) / 100);
export const toPaise = (rs) => Math.round(Number(rs) * 100);
