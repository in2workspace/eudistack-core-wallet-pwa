import { KNOWN_TENANTS, FALLBACK_TENANT } from './tenants.constants';

describe('tenants.constants', () => {
  it('FALLBACK_TENANT és a KNOWN_TENANTS', () => {
    expect(KNOWN_TENANTS).toContain(FALLBACK_TENANT);
  });
});
