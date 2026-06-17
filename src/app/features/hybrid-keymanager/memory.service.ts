import { Injectable } from '@angular/core';

const TTL_MS = 300_000; // 5 minutes — AC-02 key lifetime bound

interface CachedKey {
  wrapKey: CryptoKey;
  timerId: ReturnType<typeof setTimeout>;
}

/**
 * In-memory cache for AES-256-GCM wrap keys derived from the PRF output.
 *
 * Keys live at most 5 minutes (TTL_MS) and are deleted from SubtleCrypto on
 * eviction or page unload — they are never serialised to storage.
 *
 * Spec: EUDISTACK-534 AC-02; technical-design.md §3.2 T12.
 */
@Injectable({ providedIn: 'root' })
export class MemoryService {
  private readonly cache = new Map<string, CachedKey>();

  constructor() {
    window.addEventListener('beforeunload', () => this.clear());
  }

  set(credentialId: string, wrapKey: CryptoKey): void {
    const existing = this.cache.get(credentialId);
    if (existing) {
      clearTimeout(existing.timerId);
      void crypto.subtle.deleteKey(existing.wrapKey);
    }
    const timerId = setTimeout(() => this.evict(credentialId), TTL_MS);
    this.cache.set(credentialId, { wrapKey, timerId });
  }

  get(credentialId: string): CryptoKey | undefined {
    return this.cache.get(credentialId)?.wrapKey;
  }

  delete(credentialId: string): void {
    this.evict(credentialId);
  }

  private evict(credentialId: string): void {
    const entry = this.cache.get(credentialId);
    if (!entry) return;
    clearTimeout(entry.timerId);
    void crypto.subtle.deleteKey(entry.wrapKey);
    this.cache.delete(credentialId);
  }

  clear(): void {
    for (const [id] of this.cache) {
      this.evict(id);
    }
  }
}