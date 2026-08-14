// Cache em memoria com TTL e teto de entradas (LRU simples por ordem de insercao).

export class TTLCache {
  constructor({ ttlMs = 30 * 60 * 1000, max = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.store = new Map();
  }

  get(key) {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) {
      this.store.delete(key);
      return undefined;
    }
    // renova posicao (mais recente no fim)
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.store.size >= this.max) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }

  async wrap(key, producer, ttlMs = this.ttlMs) {
    const cached = this.get(key);
    if (cached !== undefined) return { value: cached, cached: true };
    const value = await producer();
    this.set(key, value, ttlMs);
    return { value, cached: false };
  }
}
