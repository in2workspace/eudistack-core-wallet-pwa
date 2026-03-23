import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CredentialMetadata } from '../models/dto/CredentialIssuerMetadata';

/**
 * Raw shape of a credential schema definition shipped in assets/schemas/.
 * May result from merging a core file ({id}.json) with a profile overlay
 * ({id}.profile.json). Only the fields consumed by this service are declared.
 */
interface CredentialSchemaProfile {
  credential_configuration_id: string;
  credential_format: string;
  credential_metadata?: CredentialMetadata;
  sd_jwt?: { vct: string; sd_alg: string; sd_claims: string[] };
}

const SUPPORTED_SCHEMAS = [
  'learcredential.employee.w3c.1',
  'learcredential.employee.sd.1',
  'learcredential.machine.w3c.1',
  'learcredential.machine.sd.1',
  'gx.labelcredential.w3c.1',
  'doctorid.sd.1',
] as const;

/**
 * Loads and serves the JSON Schema profiles bundled with the wallet.
 * Acts as a local source of truth for credential metadata (display names,
 * claim paths) so the wallet can render any supported credential type
 * without depending on the issuer at display time.
 */
@Injectable({ providedIn: 'root' })
export class CredentialSchemaRegistryService {

  private readonly http = inject(HttpClient);
  private readonly schemas = new Map<string, CredentialSchemaProfile>();
  private loadPromise: Promise<void> | null = null;

  /**
   * Ensures all bundled schemas are loaded. Safe to call multiple times.
   */
  ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.loadAll();
    return this.loadPromise;
  }

  getCredentialMetadata(configId: string): CredentialMetadata | null {
    return this.schemas.get(configId)?.credential_metadata ?? null;
  }

  getSdJwtConfig(configId: string): { vct: string; sd_alg: string; sd_claims: string[] } | null {
    return this.schemas.get(configId)?.sd_jwt ?? null;
  }

  getFormat(configId: string): string | null {
    return this.schemas.get(configId)?.credential_format ?? null;
  }

  private async loadAll(): Promise<void> {
    const results = await Promise.allSettled(
      SUPPORTED_SCHEMAS.map(id => this.loadSchema(id))
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('Failed to load credential schema:', result.reason);
      }
    }
  }

  private async loadSchema(configId: string): Promise<void> {
    const coreUrl = `assets/schemas/${configId}.json`;
    const profileUrl = `assets/schemas/${configId}.profile.json`;

    const core = await firstValueFrom(
      this.http.get<CredentialSchemaProfile>(coreUrl)
    );

    let merged = core;
    try {
      const profile = await firstValueFrom(
        this.http.get<Partial<CredentialSchemaProfile>>(profileUrl)
      );
      merged = { ...core, ...profile };
    } catch {
      // No profile file — use core as-is (backwards-compatible)
    }

    this.schemas.set(merged.credential_configuration_id, merged);
  }
}
