import { inject, Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CredentialIssuerMetadata, CredentialMetadata } from '../models/dto/CredentialIssuerMetadata';

interface CachedIssuerMetadata {
  metadata: CredentialIssuerMetadata;
  fetchedAt: number;
}

interface CredentialIssuerMapping {
  issuerUrl: string;
  configId: string;
}

const KNOWN_ISSUERS_KEY = 'known-issuers';
const ISSUER_META_PREFIX = 'issuer-meta:';
const CRED_ISSUER_PREFIX = 'cred-issuer:';
const STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

@Injectable({ providedIn: 'root' })
export class IssuerMetadataCacheService {

  private readonly storage = inject(Storage);
  private readonly http = inject(HttpClient);
  private initPromise: Promise<void> | null = null;

  private ensureInit(): Promise<void> {
    this.initPromise ??= this.storage.create().then(() => {});
    return this.initPromise;
  }

  /**
   * Called after successful issuance to register the issuer metadata
   * and the credential-to-issuer mapping.
   */
  async registerIssuance(
    credentialId: string,
    issuerUrl: string,
    configId: string,
    metadata: CredentialIssuerMetadata
  ): Promise<void> {
    await this.ensureInit();

    // Store full issuer metadata
    const cached: CachedIssuerMetadata = { metadata, fetchedAt: Date.now() };
    await this.storage.set(`${ISSUER_META_PREFIX}${issuerUrl}`, cached);

    // Store credential → issuer mapping
    const mapping: CredentialIssuerMapping = { issuerUrl, configId };
    await this.storage.set(`${CRED_ISSUER_PREFIX}${credentialId}`, mapping);

    // Track known issuers
    const knownIssuers: string[] = (await this.storage.get(KNOWN_ISSUERS_KEY)) ?? [];
    if (!knownIssuers.includes(issuerUrl)) {
      knownIssuers.push(issuerUrl);
      await this.storage.set(KNOWN_ISSUERS_KEY, knownIssuers);
    }
  }

  /**
   * Gets the credential_metadata for a specific credential.
   * First tries by credential ID mapping, then falls back to searching
   * by credential type across all known issuers.
   */
  async getCredentialMetadata(credentialId: string, credentialTypes?: string[]): Promise<CredentialMetadata | null> {
    await this.ensureInit();

    // Try direct mapping first
    const mapping: CredentialIssuerMapping | null = await this.storage.get(`${CRED_ISSUER_PREFIX}${credentialId}`);
    if (mapping) {
      const cached: CachedIssuerMetadata | null = await this.storage.get(`${ISSUER_META_PREFIX}${mapping.issuerUrl}`);
      if (cached) {
        const config = cached.metadata.credential_configurations_supported?.[mapping.configId];
        if (config?.credential_metadata) return config.credential_metadata;
      }
    }

    // Fallback: search by credential type across all known issuers
    if (credentialTypes?.length) {
      return this.findMetadataByType(credentialTypes);
    }

    return null;
  }

  /**
   * Gets the display name of a credential type from cached metadata.
   */
  async getCredentialDisplayName(credentialId: string, credentialTypes?: string[]): Promise<string | null> {
    const meta = await this.getCredentialMetadata(credentialId, credentialTypes);
    return meta?.display?.[0]?.name ?? null;
  }

  /**
   * Refreshes metadata for all known issuers that are older than TTL.
   * Should be called on app init.
   */
  async refreshStaleMetadata(): Promise<void> {
    await this.ensureInit();

    const knownIssuers: string[] = (await this.storage.get(KNOWN_ISSUERS_KEY)) ?? [];
    const now = Date.now();

    for (const issuerUrl of knownIssuers) {
      const cached: CachedIssuerMetadata | null = await this.storage.get(`${ISSUER_META_PREFIX}${issuerUrl}`);
      if (!cached || (now - cached.fetchedAt > STALE_TTL_MS)) {
        try {
          const wellKnownUrl = `${issuerUrl}/.well-known/openid-credential-issuer`;
          const text = await firstValueFrom(this.http.get(wellKnownUrl, { responseType: 'text' }));
          const metadata: CredentialIssuerMetadata = JSON.parse(text);
          await this.storage.set(`${ISSUER_META_PREFIX}${issuerUrl}`, {
            metadata,
            fetchedAt: Date.now(),
          } as CachedIssuerMetadata);
        } catch (e) {
          console.warn(`Failed to refresh issuer metadata for ${issuerUrl}:`, e);
        }
      }
    }
  }

  /**
   * Returns all known issuer URLs (for future wallet-initiated flows).
   */
  async getKnownIssuers(): Promise<{ url: string; name?: string }[]> {
    await this.ensureInit();
    const knownIssuers: string[] = (await this.storage.get(KNOWN_ISSUERS_KEY)) ?? [];
    return knownIssuers.map(url => ({ url }));
  }

  /**
   * Searches across all known issuers for a configuration matching the credential types.
   */
  private async findMetadataByType(credentialTypes: string[]): Promise<CredentialMetadata | null> {
    const knownIssuers: string[] = (await this.storage.get(KNOWN_ISSUERS_KEY)) ?? [];

    for (const issuerUrl of knownIssuers) {
      const cached: CachedIssuerMetadata | null = await this.storage.get(`${ISSUER_META_PREFIX}${issuerUrl}`);
      if (!cached?.metadata?.credential_configurations_supported) continue;

      for (const [configId, config] of Object.entries(cached.metadata.credential_configurations_supported)) {
        // Match by configId (e.g., "LEARCredentialEmployee") or by credential_definition.type
        const matchesConfigId = credentialTypes.includes(configId);
        const matchesDefinitionType = config.credential_definition?.type?.some(
          t => credentialTypes.includes(t)
        );

        if ((matchesConfigId || matchesDefinitionType) && config.credential_metadata) {
          return config.credential_metadata;
        }
      }
    }

    return null;
  }
}
