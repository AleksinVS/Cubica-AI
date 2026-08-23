/** Fail-closed PostgreSQL connection-string validation shared by shadow jobs. */
export function safeShadowDatabaseUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash || url.pathname.length <= 1 ||
        !url.hostname || url.hostname.includes('%')) return null;
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    const query = [...url.searchParams.entries()];
    // pg-connection-string lets query parameters such as `host` override the
    // authority component. Accepting only the one required TLS parameter for
    // remote hosts prevents a reviewed URL from being redirected elsewhere.
    if (loopback) {
      if (query.length !== 0) return null;
    } else if (query.length !== 1 || query[0]![0] !== 'sslmode' || query[0]![1] !== 'verify-full') {
      return null;
    }
    return url.toString();
  } catch { return null; }
}
