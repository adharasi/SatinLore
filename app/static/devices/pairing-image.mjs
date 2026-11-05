export function safeQrUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    const allowed = ["lovense-api.com", "lovense.com"].some(domain =>
      url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    return url.protocol === "https:" && !url.username && !url.password && !url.port && allowed ? url.href : null;
  } catch { return null; }
}

// The base64 prefix is the PNG signature and IHDR header for 256 × 256.
// The browser still decodes the complete image before the reader shows it.
export function safeGeneratedQrImage(value) {
  if (typeof value !== "string" || value.length > 32_768 || value.trim() !== value) return null;
  const image = /^data:image\/png;base64,(iVBORw0KGgoAAAANSUhEUgAAAQAAAAEA[A-Za-z0-9+/]+={0,2})$/.exec(value)?.[1];
  return image && image.length % 4 === 0 ? value : null;
}
