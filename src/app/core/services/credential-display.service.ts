import { inject, Injectable } from '@angular/core';
import { IssuerMetadataCacheService } from './issuer-metadata-cache.service';
import { CredentialMetadata, ClaimDefinition } from '../models/dto/CredentialIssuerMetadata';
import { VerifiableCredential } from '../models/verifiable-credential';
import { EvaluatedField, EvaluatedSection, CredentialDetailMap } from '../models/credential-detail-map';
import { CredentialMapConfig, CredentialTypeMap } from '../models/credential-type-map';
import { getExtendedCredentialType, isValidCredentialType } from 'src/app/shared/helpers/get-credential-type.helpers';

@Injectable({ providedIn: 'root' })
export class CredentialDisplayService {

  private readonly issuerMetadataCache = inject(IssuerMetadataCacheService);

  /**
   * Returns 2-3 summary fields for the card view.
   * Tries issuer metadata first, falls back to hardcoded CredentialTypeMap.
   */
  async getCardFields(credential: VerifiableCredential): Promise<EvaluatedField[]> {
    const meta = await this.issuerMetadataCache.getCredentialMetadata(credential.id, credential.type);
    if (meta?.claims?.length) {
      // Use first 3 claims as card summary
      return meta.claims.slice(0, 3)
        .map(claim => ({
          label: claim.display?.[0]?.name ?? claim.path.join('.'),
          value: this.stringifyValue(resolveByPath(credential.credentialSubject, claim.path)),
        }))
        .filter(f => !!f.value);
    }

    // Fallback to hardcoded map
    const credType = getExtendedCredentialType(credential);
    const config: CredentialMapConfig | undefined = isValidCredentialType(credType)
      ? CredentialTypeMap[credType]
      : undefined;

    return config?.fields.map(f => ({
      label: f.label,
      value: f.valueGetter(credential.credentialSubject),
    })) ?? [];
  }

  /**
   * Returns all sections with fields for the detail modal.
   * Tries issuer metadata first, falls back to hardcoded CredentialDetailMap.
   */
  async getDetailSections(credential: VerifiableCredential): Promise<EvaluatedSection[]> {
    const meta = await this.issuerMetadataCache.getCredentialMetadata(credential.id, credential.type);
    if (meta?.claims?.length) {
      return this.buildDynamicSections(credential, meta);
    }

    // Fallback to hardcoded detail map
    return this.buildHardcodedSections(credential);
  }

  /**
   * Gets the display name of the credential type from issuer metadata.
   */
  async getDisplayName(credential: VerifiableCredential): Promise<string> {
    const name = await this.issuerMetadataCache.getCredentialDisplayName(credential.id, credential.type);
    if (name) return name;

    // Fallback: use the type array
    const types = credential.type?.filter(t => t !== 'VerifiableCredential') ?? [];
    return types[0] ?? 'Credential';
  }

  /**
   * Returns a human-readable format label (e.g. "SD-JWT", "JWT").
   */
  getFormatLabel(credential: VerifiableCredential): string {
    switch (credential.credentialFormat) {
      case 'DC_SD_JWT': return 'SD-JWT';
      case 'JWT_VC': case 'JWT_VC_JSON': return 'JWT';
      case 'CWT_VC': return 'CWT';
      default: return credential.credentialFormat ?? '';
    }
  }

  private buildDynamicSections(
    credential: VerifiableCredential,
    meta: CredentialMetadata
  ): EvaluatedSection[] {
    // Group claims by the first path segment (e.g. "mandate.mandatee" → "Mandatee")
    const groups = new Map<string, { claim: ClaimDefinition; value: unknown }[]>();

    for (const claim of meta.claims) {
      const value = resolveByPath(credential.credentialSubject, claim.path);
      if (value == null || value === '') continue;

      // Derive section key from path: use first 2 segments if available
      const sectionKey = claim.path.length >= 2
        ? claim.path.slice(0, 2).join('.')
        : claim.path[0] ?? 'General';

      if (!groups.has(sectionKey)) {
        groups.set(sectionKey, []);
      }
      groups.get(sectionKey)!.push({ claim, value });
    }

    return Array.from(groups.entries()).map(([sectionKey, items]) => {
      // Derive a human-readable section title from the path
      const lastSegment = sectionKey.split('.').pop() ?? sectionKey;
      const sectionTitle = capitalize(lastSegment);

      return {
        section: sectionTitle,
        fields: items.map(({ claim, value }) => ({
          label: claim.display?.[0]?.name ?? claim.path[claim.path.length - 1],
          value: this.stringifyValue(value),
        })),
      };
    });
  }

  private buildHardcodedSections(credential: VerifiableCredential): EvaluatedSection[] {
    const credType = getExtendedCredentialType(credential);
    const entry = isValidCredentialType(credType) ? CredentialDetailMap[credType] : undefined;
    if (!entry) return [];

    const cs = credential.credentialSubject;
    const sections = typeof entry === 'function' ? entry(cs, credential) : entry;

    return sections.map(section => ({
      section: section.section,
      fields: section.fields
        .map(f => ({
          label: f.label,
          value: f.valueGetter(cs as any, credential as any),
        }))
        .filter(f => !!f.value && f.value !== ''),
    }));
  }

  private stringifyValue(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      return value.map(v => this.stringifyValue(v)).join(', ');
    }
    if (typeof value === 'object') {
      // For complex objects (e.g. power array items), show a readable summary
      return JSON.stringify(value);
    }
    return String(value);
  }
}

function resolveByPath(obj: any, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
