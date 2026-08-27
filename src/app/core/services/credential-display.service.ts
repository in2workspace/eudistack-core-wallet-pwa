import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { IssuerMetadataCacheService } from './issuer-metadata-cache.service';
import { CredentialMetadata, ClaimDefinition, MetadataDisplay } from '../models/dto/CredentialIssuerMetadata';
import { VerifiableCredential } from '../models/verifiable-credential';
import { CardStyle, DisplayField, DisplayFieldItem, DisplaySection } from '../models/display-field.model';

/** How far the derived gradient stop is lifted towards white. Enough for depth, not a wash. */
const GRADIENT_LIGHTEN = 0.14;

@Injectable({ providedIn: 'root' })
export class CredentialDisplayService {

  private readonly issuerMetadataCache = inject(IssuerMetadataCacheService);
  private readonly translate = inject(TranslateService);

  /** The display object for the active language, falling back to English and then to the first. */
  private pickDisplay(displays: MetadataDisplay[] | undefined): MetadataDisplay | null {
    if (!displays?.length) return null;
    const lang = this.translate.currentLang || this.translate.defaultLang;
    return displays.find(d => d.locale === lang)
      ?? displays.find(d => d.locale === 'en')
      ?? displays[0];
  }

  private resolveDisplayName(displays: MetadataDisplay[] | undefined, fallback: string): string {
    return this.pickDisplay(displays)?.name ?? fallback;
  }

  /**
   * Resolves credential metadata from the issuer metadata cache (runtime, from OID4VCI/OID4VP
   * flows). Returned as-is, including when `claims` is empty/absent — display-only metadata
   * (name, no claims) is still useful to `getDisplayName()`. Callers that need claims check
   * `meta?.claims?.length` themselves.
   */
  async resolveMetadata(credential: VerifiableCredential): Promise<CredentialMetadata | null> {
    return this.issuerMetadataCache.findCredentialMetadata(
      credential.id, credential.type, credential.credentialFormat
    );
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

      const label = this.resolveDisplayName(claim.display, claim.path[claim.path.length - 1]);

      // Array of objects (e.g. powers) → structured items
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        fields.push({
          label,
          value: '',
          structured: value.map((item: Record<string, unknown>) => formatObjectItem(item)),
        });
        continue;
      }

      fields.push({ label, value: stringifyValue(value) });
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

  /**
   * The card styling the issuer publishes for this credential, or null when it publishes none —
   * in which case the caller keeps whatever the wallet's own theme decides.
   *
   * `background_color` and `text_color` are OID4VCI display members, so any issuer can drive
   * the look of its own credentials and the same credential type looks the same in every
   * wallet. `background_image` wins over the colour when present, per section 12.2.4.
   */
  async getCardStyle(credential: VerifiableCredential): Promise<CardStyle | null> {
    const meta = await this.resolveMetadata(credential);
    const display = this.pickDisplay(meta?.display);
    if (!display?.background_color && !display?.background_image?.uri) return null;

    const background = display.background_color ?? 'transparent';
    return {
      background,
      gradientEnd: lightenHex(background, GRADIENT_LIGHTEN) ?? background,
      text: display.text_color,
      backgroundImage: display.background_image?.uri,
      logoUri: display.logo?.uri,
      logoAlt: display.logo?.alt_text,
    };
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
    const name = this.resolveDisplayName(meta?.display, '');
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

  // ── Section builder ─────────────────────────────────

  createSectionsFromClaims(subject: any, meta: CredentialMetadata): DisplaySection[] {
    const arraySections: DisplaySection[] = [];
    const groups = new Map<string, { claim: ClaimDefinition; value: unknown }[]>();

    for (const claim of meta.claims) {
      const value = resolveByPath(subject, claim.path);
      if (value == null || value === '') continue;

      // Array of objects → dedicated section
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        const title = this.resolveDisplayName(claim.display, claim.path[claim.path.length - 1]);
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
        ? claim.path.slice(0, -1).join('.')
        : 'General';

      if (!groups.has(sectionKey)) groups.set(sectionKey, []);
      groups.get(sectionKey)!.push({ claim, value });
    }

    const scalarSections = Array.from(groups.entries()).map(([key, items]) => ({
      section: humanizeKey(key.split('.').pop() ?? key),
      fields: items.map(({ claim, value }) => ({
        label: this.resolveDisplayName(claim.display, claim.path[claim.path.length - 1]),
        value: stringifyValue(value),
      })),
    }));

    return [...scalarSections, ...arraySections];
  }
}

// ── Utilities (module-private) ───────────────────────

function resolveByPath(obj: any, path: string[]): unknown {
  const normalized = path[0] === 'credentialSubject' ? path.slice(1) : path;

  // Try direct resolution first.
  const direct = walkPath(obj, normalized);
  if (direct !== undefined) return direct;

  // SD-JWT schema paths are flat (e.g. ["mandator","commonName"]) but the
  // normaliser may have wrapped them under "mandate". Try through "mandate".
  if (obj?.mandate && normalized[0] !== 'mandate') {
    return walkPath(obj.mandate, normalized);
  }

  return undefined;
}

function walkPath(obj: any, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current === undefined ? undefined : current;
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

/**
 * Mixes a `#rgb`/`#rrggbb` colour towards white by `ratio`. Returns null for anything else —
 * a named colour or a `color()` function is valid CSS the issuer may publish, and a card with
 * a flat background reads better than one with a wrong second stop.
 */
function lightenHex(color: string, ratio: number): string | null {
  const hex = color.trim().replace('#', '');
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  const channels = [0, 2, 4]
    .map(i => parseInt(full.slice(i, i + 2), 16))
    .map(value => Math.round(value + (255 - value) * ratio))
    .map(value => value.toString(16).padStart(2, '0'));
  return `#${channels.join('')}`;
}

function humanizeKey(str: string): string {
  const spaced = str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
