import { inject, Injectable } from '@angular/core';
import { IssuerMetadataCacheService } from './issuer-metadata-cache.service';
import { CredentialSchemaRegistryService } from './credential-schema-registry.service';
import { CredentialMetadata, ClaimDefinition } from '../models/dto/CredentialIssuerMetadata';
import { VerifiableCredential } from '../models/verifiable-credential';
import { DisplayField, DisplayFieldItem, DisplaySection } from '../models/display-field.model';
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
  async resolveMetadata(credential: VerifiableCredential): Promise<CredentialMetadata | null> {
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

  // ── Core: shared field generation from claims ────────

  /**
   * Builds a flat list of DisplayField from a credentialSubject and metadata claims.
   * Used by both the acceptance preview and the detail/card views.
   */
  buildFieldsFromClaims(subject: any, meta: CredentialMetadata): DisplayField[] {
    if (!subject || !meta?.claims?.length) return [];

    const fields: DisplayField[] = [];
    for (const claim of meta.claims) {
      const value = resolveByPath(subject, claim.path);
      if (value == null || value === '') continue;

      const label = claim.display?.[0]?.name ?? claim.path[claim.path.length - 1];

      // Array of objects (e.g. powers) → structured items
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        fields.push({
          label,
          value: '',
          structured: value.map((item: Record<string, unknown>) => formatObjectItem(item)),
        });
        continue;
      }

      const mapped = claim.value_map && typeof value === 'string' && value in claim.value_map
        ? claim.value_map[value]
        : value;
      fields.push({ label, value: stringifyValue(mapped) });
    }
    return fields;
  }

  // ── Card view ────────────────────────────────────────

  /** Returns 2-3 summary fields for the card view (scalar values only). */
  async getCardFields(credential: VerifiableCredential): Promise<DisplayField[]> {
    const meta = await this.resolveMetadata(credential);
    if (!meta?.claims?.length) return [];

    return this.buildFieldsFromClaims(credential.credentialSubject, meta)
      .filter(f => !f.structured && !!f.value)
      .slice(0, 3);
  }

  // ── Detail view ──────────────────────────────────────

  /** Returns all sections with fields for the detail modal. */
  async getDetailSections(credential: VerifiableCredential): Promise<DisplaySection[]> {
    const meta = await this.resolveMetadata(credential);
    if (!meta?.claims?.length) return [];

    return this.createSectionsFromClaims(credential.credentialSubject, meta);
  }

  // ── Display name & format ────────────────────────────

  async getDisplayName(credential: VerifiableCredential): Promise<string> {
    const meta = await this.resolveMetadata(credential);
    const name = meta?.display?.[0]?.name;
    if (name) return name;

    const types = credential.type?.filter(t => t !== 'VerifiableCredential') ?? [];
    return types[0] ?? 'Credential';
  }

  getFormatLabel(credential: VerifiableCredential): string {
    switch (credential.credentialFormat) {
      case 'DC_SD_JWT': return 'dc+sd-jwt';
      case 'JWT_VC': case 'JWT_VC_JSON': return 'jwt_vc_json';
      case 'CWT_VC': return 'cwt_vc';
      default: return credential.credentialFormat ?? '';
    }
  }

  // ── Private ──────────────────────────────────────────

  private createSectionsFromClaims(subject: any, meta: CredentialMetadata): DisplaySection[] {
    const arraySections: DisplaySection[] = [];
    const groups = new Map<string, { claim: ClaimDefinition; value: unknown }[]>();

    for (const claim of meta.claims) {
      const value = resolveByPath(subject, claim.path);
      if (value == null || value === '') continue;

      // Array of objects → dedicated section
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        const title = claim.display?.[0]?.name ?? claim.path[claim.path.length - 1];
        arraySections.push({
          section: title,
          fields: [{
            label: title,
            value: '',
            structured: value.map((item: any) => formatObjectItem(item)),
          }],
        });
        continue;
      }

      const sectionKey = claim.path.length >= 2
        ? claim.path.slice(0, 2).join('.')
        : claim.path[0] ?? 'General';

      if (!groups.has(sectionKey)) groups.set(sectionKey, []);
      groups.get(sectionKey)!.push({ claim, value });
    }

    const scalarSections = Array.from(groups.entries()).map(([key, items]) => ({
      section: humanizeKey(key.split('.').pop() ?? key),
      fields: items.map(({ claim, value }) => {
        const mapped = claim.value_map && typeof value === 'string' && value in claim.value_map
          ? claim.value_map[value]
          : value;
        return {
          label: claim.display?.[0]?.name ?? claim.path[claim.path.length - 1],
          value: stringifyValue(mapped),
        };
      }),
    }));

    return [...scalarSections, ...arraySections];
  }
}

// ── Utilities (module-private) ───────────────────────

function resolveByPath(obj: any, path: string[]): unknown {
  const normalized = path[0] === 'credentialSubject' ? path.slice(1) : path;
  let current = obj;
  for (const key of normalized) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

function formatObjectItem(obj: Record<string, unknown>): DisplayFieldItem {
  if ('function' in obj && 'domain' in obj) {
    const fn = String(obj['function'] ?? '');
    const domain = String(obj['domain'] ?? '');
    const action = Array.isArray(obj['action'])
      ? obj['action'].join(', ')
      : String(obj['action'] ?? '');
    return { label: `${fn} (${domain})`, value: action };
  }

  const entries = Object.entries(obj)
    .filter(([k, v]) => v != null && v !== '' && k !== 'type' && k !== 'id')
    .slice(0, 2);

  if (entries.length > 0) {
    return {
      label: humanizeKey(String(entries[0][0])),
      value: entries.map(([, v]) => stringifyValue(v)).join(' — '),
    };
  }

  return { label: '', value: stringifyValue(obj) };
}

function stringifyValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(v => stringifyValue(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function humanizeKey(str: string): string {
  const spaced = str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}