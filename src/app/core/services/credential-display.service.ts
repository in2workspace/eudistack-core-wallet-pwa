import { inject, Injectable } from '@angular/core';
import { IssuerMetadataCacheService } from './issuer-metadata-cache.service';
import { CredentialSchemaRegistryService } from './credential-schema-registry.service';
import { CredentialMetadata, ClaimDefinition } from '../models/dto/CredentialIssuerMetadata';
import { VerifiableCredential } from '../models/verifiable-credential';
import { EvaluatedField, EvaluatedSection, CredentialDetailMap } from '../models/credential-detail-map';
import { CredentialMapConfig, CredentialTypeMap } from '../models/credential-type-map';
import { getExtendedCredentialType, isValidCredentialType } from 'src/app/shared/helpers/get-credential-type.helpers';

@Injectable({ providedIn: 'root' })
export class CredentialDisplayService {

  private readonly issuerMetadataCache = inject(IssuerMetadataCacheService);
  private readonly schemaRegistry = inject(CredentialSchemaRegistryService);

  /**
   * Resolves credential metadata from:
   * 1. Issuer metadata cache (runtime, from OID4VCI flow)
   * 2. Bundled schema registry (preconfigured supported types)
   */
  private async resolveMetadata(credential: VerifiableCredential): Promise<CredentialMetadata | null> {
    const issuerMeta = await this.issuerMetadataCache.findCredentialMetadata(
      credential.id, credential.type, credential.credentialFormat
    );
    if (issuerMeta?.claims?.length) return issuerMeta;

    await this.schemaRegistry.ensureLoaded();
    const credType = getExtendedCredentialType(credential);
    if (isValidCredentialType(credType)) {
      const schemaMeta = this.schemaRegistry.getCredentialMetadata(credType);
      if (schemaMeta?.claims?.length) return schemaMeta;
    }

    return null;
  }

  /**
   * Returns 2-3 summary fields for the card view.
   * Tries issuer metadata first, then schema registry, falls back to hardcoded CredentialTypeMap.
   */
  async getCardFields(credential: VerifiableCredential): Promise<EvaluatedField[]> {
    const meta = await this.resolveMetadata(credential);
    if (meta?.claims?.length) {
      // Use first 3 scalar claims as card summary (skip arrays like powers)
      return meta.claims
        .map(claim => {
          const value = resolveByPath(credential.credentialSubject, claim.path);
          if (Array.isArray(value) || (value != null && typeof value === 'object')) return null;
          return {
            label: claim.display?.[0]?.name ?? claim.path.join('.'),
            value: this.stringifyValue(value),
          };
        })
        .filter((f): f is EvaluatedField => f != null && !!f.value)
        .slice(0, 3);
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
    const meta = await this.resolveMetadata(credential);
    if (meta?.claims?.length) {
      return this.createDynamicSections(credential, meta);
    }

    // Fallback to hardcoded detail map
    return this.createHardcodedSections(credential);
  }

  /**
   * Gets the display name of the credential type.
   * Tries issuer metadata cache, then schema registry, then type array.
   */
  async getDisplayName(credential: VerifiableCredential): Promise<string> {
    const meta = await this.resolveMetadata(credential);
    const name = meta?.display?.[0]?.name;
    if (name) return name;

    // Fallback: use the type array
    const types = credential.type?.filter(t => t !== 'VerifiableCredential') ?? [];
    return types[0] ?? 'Credential';
  }

  /**
   * Returns the protocol format label for display (e.g. "dc+sd-jwt", "jwt_vc_json").
   */
  getFormatLabel(credential: VerifiableCredential): string {
    switch (credential.credentialFormat) {
      case 'DC_SD_JWT': return 'dc+sd-jwt';
      case 'JWT_VC': case 'JWT_VC_JSON': return 'jwt_vc_json';
      case 'CWT_VC': return 'cwt_vc';
      default: return credential.credentialFormat ?? '';
    }
  }

  private createDynamicSections(
    credential: VerifiableCredential,
    meta: CredentialMetadata
  ): EvaluatedSection[] {
    const sections: EvaluatedSection[] = [];
    // Group scalar claims by path prefix; handle array claims as separate sections
    const groups = new Map<string, { claim: ClaimDefinition; value: unknown }[]>();

    for (const claim of meta.claims) {
      const value = resolveByPath(credential.credentialSubject, claim.path);
      if (value == null || value === '') continue;

      // Array of objects (e.g. powers) → dedicated section
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        const sectionTitle = claim.display?.[0]?.name ?? claim.path[claim.path.length - 1];
        sections.push({
          section: sectionTitle,
          fields: value.map((item: any) => this.formatObjectAsField(item)),
        });
        continue;
      }

      // Derive section key from path: use first 2 segments if available
      const sectionKey = claim.path.length >= 2
        ? claim.path.slice(0, 2).join('.')
        : claim.path[0] ?? 'General';

      if (!groups.has(sectionKey)) {
        groups.set(sectionKey, []);
      }
      groups.get(sectionKey)!.push({ claim, value });
    }

    // Build sections from grouped scalar claims
    const scalarSections = Array.from(groups.entries()).map(([sectionKey, items]) => {
      const lastSegment = sectionKey.split('.').pop() ?? sectionKey;
      return {
        section: capitalize(lastSegment),
        fields: items.map(({ claim, value }) => ({
          label: claim.display?.[0]?.name ?? claim.path[claim.path.length - 1],
          value: this.stringifyValue(value),
        })),
      };
    });

    return [...scalarSections, ...sections];
  }

  /**
   * Formats a complex object (e.g. a power item) as a readable field.
   * Power objects: { function, domain, action } → label: "Onboarding (DOME)", value: "Execute"
   */
  private formatObjectAsField(obj: Record<string, unknown>): EvaluatedField {
    // Power-like objects
    if ('function' in obj && 'domain' in obj) {
      const fn = String(obj['function'] ?? '');
      const domain = String(obj['domain'] ?? '');
      const action = Array.isArray(obj['action'])
        ? obj['action'].join(', ')
        : String(obj['action'] ?? '');
      return { label: `${fn} (${domain})`, value: action };
    }

    // Generic object: use first meaningful key-value pairs
    const entries = Object.entries(obj)
      .filter(([k, v]) => v != null && v !== '' && k !== 'type' && k !== 'id')
      .slice(0, 2);

    if (entries.length > 0) {
      return {
        label: capitalize(String(entries[0][0])),
        value: entries.map(([, v]) => this.stringifyValue(v)).join(' — '),
      };
    }

    return { label: '', value: this.stringifyValue(obj) };
  }

  private createHardcodedSections(credential: VerifiableCredential): EvaluatedSection[] {
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

/**
 * Resolves a value from an object by following the given path segments.
 * Strips a leading "credentialSubject" segment if present, since the caller
 * already passes `credential.credentialSubject` as the root object.
 */
function resolveByPath(obj: any, path: string[]): unknown {
  const normalizedPath = path[0] === 'credentialSubject' ? path.slice(1) : path;
  let current = obj;
  for (const key of normalizedPath) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
