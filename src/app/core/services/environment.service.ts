import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

const DEV_HOST_SUFFIX = '.dev.eudistack.net';
const STG_HOST_SUFFIX = '.stg.eudistack.net';

/**
 * Label shown for non-production deployments, or null when the host is not one of them
 * (PRO is intentionally not labelled).
 */
export function resolveEnvironmentLabel(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (host.endsWith(DEV_HOST_SUFFIX)) return 'DEV';
  if (host.endsWith(STG_HOST_SUFFIX)) return 'STG';
  return null;
}

@Injectable({ providedIn: 'root' })
export class EnvironmentService {
  /** Environment label ('DEV', 'STG') or null on PRO. Resolved from the hostname at runtime. */
  readonly label: string | null = resolveEnvironmentLabel(inject(DOCUMENT).location.hostname);

  /** Appends the environment label to a display name; returns it untouched when there is none. */
  decorate(name: string): string {
    return this.label ? `${name} (${this.label})` : name;
  }

  /** Same as decorate() but without parentheses, for short labels (e.g. the icon caption). */
  decorateShort(name: string): string {
    return this.label ? `${name} ${this.label}` : name;
  }
}
