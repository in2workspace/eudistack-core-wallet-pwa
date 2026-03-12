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

export interface DisplaySection {
  section: string;
  fields: DisplayField[];
}