/**
 * Unified display model used by all 3 credential views:
 * - Card (summary): flat DisplayField[]
 * - Preview (acceptance modal): flat + structured DisplayField[]
 * - Detail (detail modal): grouped DisplaySection[]
 */

export interface DisplayFieldItem {
  label: string;
  value: string;
}

export interface DisplayField {
  label: string;
  value: string;
  /** For array-of-objects claims (e.g. powers), each item rendered as label/value. */
  structured?: DisplayFieldItem[];
}

/**
 * Card styling as the issuer publishes it (OID4VCI 1.0 Final section 12.2.4 display members).
 * `gradientEnd` is not a metadata member: the spec has no gradient, so it is derived from
 * `background` to keep the card's depth without inventing a field.
 */
export interface CardStyle {
  background: string;
  gradientEnd: string;
  text?: string;
  backgroundImage?: string;
  logoUri?: string;
  logoAlt?: string;
}

export interface DisplaySection {
  section: string;
  fields: DisplayField[];
}