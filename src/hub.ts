import type { HubImage, HubTag } from './protocol';
type Fetch = typeof fetch;
export class DockerHub {
  private cache = new Map<string, { expires: number; data: any }>();
  constructor(private request: Fetch = fetch) {}
  private async get(path: string): Promise<any> {
    const cached = this.cache.get(path);
    if (cached && cached.expires > Date.now()) return cached.data;
    const response = await this.request(`https://hub.docker.com${path}`, {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json' },
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? 'Docker Hub rate limit reached. Try again shortly.'
          : `Docker Hub returned HTTP ${response.status}. You can still enter an image manually.`,
      );
    const data = await response.json();
    if (this.cache.size > 100) this.cache.clear();
    this.cache.set(path, { expires: Date.now() + 300_000, data });
    return data;
  }
  async search(query: string): Promise<HubImage[]> {
    const term = query.trim().slice(0, 120);
    if (term.length < 2) return [];
    const data = await this.get(
      `/v2/search/repositories/?query=${encodeURIComponent(term)}&page_size=20`,
    );
    return (data.results ?? [])
      .map((r: any) => ({
        name: String(r.repo_name ?? r.name ?? ''),
        description: String(r.short_description ?? r.description ?? ''),
        stars: Number(r.star_count) || 0,
        pulls: Number(r.pull_count) || 0,
        official: !!r.is_official,
      }))
      .filter((r: HubImage) => r.name);
  }
  async tags(image: string): Promise<HubTag[]> {
    const parts = image.replace(/^library\//, '').split('/');
    if (parts.length > 2 || parts.some((part) => !/^[a-z0-9][a-z0-9_.-]*$/.test(part)))
      throw new Error('Invalid Docker Hub repository.');
    const [namespace, repo] = parts.length === 1 ? ['library', parts[0]] : parts;
    const data = await this.get(
      `/v2/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/tags/?page_size=50&ordering=last_updated`,
    );
    return (data.results ?? []).map((r: any) => ({
      name: String(r.name),
      architectures: [
        ...new Set<string>((r.images ?? []).map((image: any) => String(image.architecture))),
      ].filter((a) => a !== 'unknown'),
    }));
  }
}
