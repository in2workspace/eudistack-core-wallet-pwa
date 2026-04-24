import { buildFallbackUrl, isKnownTenant, resolveTenant, KNOWN_TENANTS } from './tenants.constants';

describe('tenants.constants (wallet)', () => {
  describe('resolveTenant', () => {
    it('extrae el primer segment del hostname en minuscules', () => {
      expect(resolveTenant('DOME.eudistack.net')).toBe('dome');
      expect(resolveTenant('kpmg.eudistack.net')).toBe('kpmg');
      expect(resolveTenant('localhost')).toBe('localhost');
    });

    it('elimina sufijos de entorno (-stg, -dev, -pre)', () => {
      expect(resolveTenant('sandbox-stg.eudistack.net')).toBe('sandbox');
      expect(resolveTenant('kpmg-dev.eudistack.net')).toBe('kpmg');
      expect(resolveTenant('dome-pre.eudistack.net')).toBe('dome');
    });
  });

  describe('isKnownTenant', () => {
    it.each(KNOWN_TENANTS)('accepta el tenant conegut "%s"', (tenant) => {
      expect(isKnownTenant(`${tenant}.eudistack.net`)).toBe(true);
    });

    it.each(KNOWN_TENANTS)('accepta el tenant conegut "%s" amb sufix -stg', (tenant) => {
      expect(isKnownTenant(`${tenant}-stg.eudistack.net`)).toBe(true);
    });

    it('rebutja un subdomain desconegut', () => {
      expect(isKnownTenant('patata.eudistack.net')).toBe(false);
    });

    it('rebutja un subdomain desconegut amb majuscules', () => {
      expect(isKnownTenant('PATATA.eudistack.net')).toBe(false);
    });
  });

  describe('buildFallbackUrl', () => {
    function fakeLocation(overrides: Partial<Location>): Location {
      return { protocol: 'https:', hostname: '', port: '', ...overrides } as Location;
    }

    it('reemplaça el primer segment del hostname per sandbox en PRD', () => {
      const url = buildFallbackUrl(fakeLocation({ hostname: 'patata.eudistack.net' }));
      expect(url).toBe('https://sandbox.eudistack.net/wallet/');
    });

    it('preserva el sufix -stg per no saltar de STG a PROD', () => {
      const url = buildFallbackUrl(fakeLocation({ hostname: 'patata-stg.eudistack.net' }));
      expect(url).toBe('https://sandbox-stg.eudistack.net/wallet/');
    });

    it('mante port i protocol en nip.io local', () => {
      const url = buildFallbackUrl(fakeLocation({
        protocol: 'https:',
        hostname: 'patata.127.0.0.1.nip.io',
        port: '4443',
      }));
      expect(url).toBe('https://sandbox.127.0.0.1.nip.io:4443/wallet/');
    });

    it('mante hostname sense subdomini (localhost)', () => {
      const url = buildFallbackUrl(fakeLocation({
        protocol: 'http:',
        hostname: 'localhost',
        port: '4200',
      }));
      expect(url).toBe('http://localhost:4200/wallet/');
    });
  });
});
