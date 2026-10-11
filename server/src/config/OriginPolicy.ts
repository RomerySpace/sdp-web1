export class OriginPolicy {
  private readonly origins: Set<string>;

  constructor(value = process.env.ALLOWED_ORIGINS, production = process.env.NODE_ENV === 'production') {
    this.origins = new Set((value || '').split(',').map((origin) => origin.trim()).filter(Boolean).map((origin) => {
      const url = new URL(origin);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('ALLOWED_ORIGINS must contain exact http(s) origins, separated by commas, without paths or wildcards.');
      }
      if (production && url.protocol !== 'https:') throw new Error('Production ALLOWED_ORIGINS must use HTTPS.');
      return url.origin;
    }));
    if (production && this.origins.size === 0) throw new Error('Set ALLOWED_ORIGINS to the exact Vercel URL before starting the production server.');
  }

  allows(origin: string | null | undefined): boolean {
    // Health checks and server SDKs do not send Origin. This is not account authentication.
    if (!origin) return true;
    if (origin === 'null') return false;
    return this.origins.size === 0 || this.origins.has(origin);
  }

  corsOrigin(origin: string | null): string {
    return this.allows(origin) ? origin || '*' : 'null';
  }
}
