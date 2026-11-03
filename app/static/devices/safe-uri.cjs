/**
 * Socket.IO 2.x's legacy parseuri contract, implemented with the browser URL
 * parser. The private bridge bundles this in place of its vulnerable regex
 * dependency; the wire protocol stays compatible with Lovense's 2.x service.
 */
module.exports = function safeUri(input) {
  if (typeof input !== "string" || !input || input.length > 8192) throw new TypeError("Invalid connection address.");
  const source = input;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !/^(?:https?|wss?):\/\//i.test(input)) throw new TypeError("Invalid connection protocol.");
  if (!/^(?:https?|wss?):\/\//i.test(input)) input = "https://" + input;
  const value = new URL(input);
  if (!["https:", "http:", "wss:", "ws:"].includes(value.protocol)) throw new TypeError("Invalid connection protocol.");
  const path = value.pathname;
  const query = value.search.slice(1);
  const host = value.hostname.replace(/^\[|\]$/g, "");
  const userInfo = value.username + (value.password ? ":" + value.password : "");
  const queryKey = Object.create(null);
  for (const part of query.split("&")) {
    if (!part) continue;
    const at = part.indexOf("=");
    queryKey[at < 0 ? part : part.slice(0, at)] = at < 0 ? "" : part.slice(at + 1);
  }
  return {
    source, protocol: value.protocol.slice(0, -1), authority: value.host,
    userInfo, user: value.username, password: value.password,
    host, port: value.port, relative: path + value.search + value.hash,
    path, directory: path.slice(0, path.lastIndexOf("/") + 1),
    file: path.slice(path.lastIndexOf("/") + 1), query, anchor: value.hash.slice(1),
    pathNames: path.split("/").filter(Boolean), queryKey,
    ...(value.hostname.startsWith("[") ? {ipv6uri: true} : {}),
  };
};
