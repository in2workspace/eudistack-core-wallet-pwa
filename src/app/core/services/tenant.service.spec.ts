import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TenantService } from './tenant.service';
import { KNOWN_TENANTS } from '../constants/tenants.constants';

function setHostname(hostname: string, extra?: Partial<Location>): void {
  Object.defineProperty(window, 'location', {
    value: { hostname, protocol: 'https:', port: '', ...extra } as Location,
    writable: true,
    configurable: true,
  });
}

function fakeLocation(overrides: Partial<Location>): Location {
  return { protocol: 'https:', hostname: '', port: '', ...overrides } as Location;
}

describe('TenantService', () => {
  let service: TenantService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TenantService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  // ── resolve(): hostname-based ──────────────────────────────────────────────

  describe('resolve() — hostname-based', () => {
    it('resol un tenant conegut des del primer segment del hostname', async () => {
      setHostname('sandbox.eudistack.net');
      await service.resolve();
      expect(service.tenant()).toBe('sandbox');
      http.expectNone('/assets/tenants/custom-domain.json');
    });

    it('normalitza el hostname a minúscules', async () => {
      setHostname('DOME.eudistack.net');
      await service.resolve();
      expect(service.tenant()).toBe('dome');
    });

    it('elimina el sufix d\'entorn -stg', async () => {
      setHostname('sandbox-stg.eudistack.net');
      await service.resolve();
      expect(service.tenant()).toBe('sandbox');
    });

    it('elimina el sufix d\'entorn -dev', async () => {
      setHostname('kpmg-dev.eudistack.net');
      await service.resolve();
      expect(service.tenant()).toBe('kpmg');
    });

    it('elimina el sufix d\'entorn -pre', async () => {
      setHostname('dome-pre.eudistack.net');
      await service.resolve();
      expect(service.tenant()).toBe('dome');
    });

    it.each(KNOWN_TENANTS)('accepta tots els tenants coneguts: %s', async (tenant) => {
      setHostname(`${tenant}.eudistack.net`);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });
      const svc = TestBed.inject(TenantService);
      const ctrl = TestBed.inject(HttpTestingController);

      await svc.resolve();

      expect(svc.tenant()).toBe(tenant);
      ctrl.expectNone('/assets/tenants/custom-domain.json');
      ctrl.verify();
    });

    it('no fa cap petició HTTP si el hostname ja es resol', async () => {
      setHostname('eudistack.eudistack.net');
      await service.resolve();
      http.expectNone('/assets/tenants/custom-domain.json');
    });
  });

  // ── resolve(): custom-domain.json fallback ────────────────────────────────

  describe('resolve() — custom-domain.json fallback', () => {
    it('resol el tenant des del JSON si el hostname no és un subdomain conegut', async () => {
      setHostname('wallet.acme.com');

      const resolvePromise = service.resolve();
      const req = http.expectOne('/assets/tenants/custom-domain.json');
      req.flush({ domains: { 'wallet.acme.com': { tenantId: 'kpmg', envId: 'pro' } }, env: {} });
      await resolvePromise;

      expect(service.tenant()).toBe('kpmg');
    });

    it('rebutja un tenantId del JSON que no és a KNOWN_TENANTS', async () => {
      setHostname('wallet.acme.com');

      const resolvePromise = service.resolve();
      const req = http.expectOne('/assets/tenants/custom-domain.json');
      req.flush({ domains: { 'wallet.acme.com': { tenantId: 'unknown-tenant', envId: 'pro' } }, env: {} });
      await resolvePromise;

      expect(service.tenant()).toBeNull();
    });

    it('retorna null si el JSON no conté el hostname', async () => {
      setHostname('wallet.acme.com');

      const resolvePromise = service.resolve();
      const req = http.expectOne('/assets/tenants/custom-domain.json');
      req.flush({ domains: { 'other.domain.com': { tenantId: 'sandbox', envId: 'pro' } }, env: {} });
      await resolvePromise;

      expect(service.tenant()).toBeNull();
    });

    it('retorna null si el JSON té el hostname però el tenantId és buit', async () => {
      setHostname('wallet.acme.com');

      const resolvePromise = service.resolve();
      const req = http.expectOne('/assets/tenants/custom-domain.json');
      req.flush({ domains: { 'wallet.acme.com': { tenantId: '', envId: 'pro' } }, env: {} });
      await resolvePromise;

      expect(service.tenant()).toBeNull();
    });

    it('retorna null si la petició al JSON falla amb 404', async () => {
      setHostname('wallet.acme.com');

      const resolvePromise = service.resolve();
      const req = http.expectOne('/assets/tenants/custom-domain.json');
      req.flush('Not found', { status: 404, statusText: 'Not Found' });
      await resolvePromise;

      expect(service.tenant()).toBeNull();
    });

    it('retorna null si la xarxa falla', async () => {
      setHostname('wallet.acme.com');

      const resolvePromise = service.resolve();
      const req = http.expectOne('/assets/tenants/custom-domain.json');
      req.error(new ProgressEvent('network error'));
      await resolvePromise;

      expect(service.tenant()).toBeNull();
    });
  });

  // ── resolve(): memoïtzació ────────────────────────────────────────────────

  describe('resolve() — memoïtzació', () => {
    it('cridades successives retornen la mateixa Promise', () => {
      setHostname('wallet.acme.com');
      const p1 = service.resolve();
      const p2 = service.resolve();
      expect(p1).toBe(p2);
      // Flush for cleanup
      http.expectOne('/assets/tenants/custom-domain.json').flush({ domains: {}, env: {} });
    });

    it('no torna a fer la petició HTTP si ja s\'ha resolt', async () => {
      setHostname('wallet.acme.com');

      const p1 = service.resolve();
      http.expectOne('/assets/tenants/custom-domain.json').flush({
        domains: { 'wallet.acme.com': { tenantId: 'dome', envId: 'pro' } },
        env: {},
      });
      await p1;

      await service.resolve(); // second call — no new HTTP request
      http.expectNone('/assets/tenants/custom-domain.json');
      expect(service.tenant()).toBe('dome');
    });
  });

  // ── buildFallbackUrl() ────────────────────────────────────────────────────

  describe('buildFallbackUrl()', () => {
    it('reemplaça el primer segment del hostname per sandbox en PRD', () => {
      const url = service.buildFallbackUrl(
        fakeLocation({ hostname: 'patata.eudistack.net' }),
      );
      expect(url).toBe('https://sandbox.eudistack.net/wallet/');
    });

    it('preserva el sufix -stg per no saltar de STG a PROD', () => {
      const url = service.buildFallbackUrl(
        fakeLocation({ hostname: 'patata-stg.eudistack.net' }),
      );
      expect(url).toBe('https://sandbox-stg.eudistack.net/wallet/');
    });

    it('preserva el sufix -dev', () => {
      const url = service.buildFallbackUrl(
        fakeLocation({ hostname: 'kpmg-dev.eudistack.net' }),
      );
      expect(url).toBe('https://sandbox-dev.eudistack.net/wallet/');
    });

    it('manté port i protocol en nip.io local', () => {
      const url = service.buildFallbackUrl(
        fakeLocation({ protocol: 'https:', hostname: 'patata.127.0.0.1.nip.io', port: '4443' }),
      );
      expect(url).toBe('https://sandbox.127.0.0.1.nip.io:4443/wallet/');
    });

    it('manté hostname sense subdomini (localhost)', () => {
      const url = service.buildFallbackUrl(
        fakeLocation({ protocol: 'http:', hostname: 'localhost', port: '4200' }),
      );
      expect(url).toBe('http://localhost:4200/wallet/');
    });

    it('usa window.location per defecte quan no es passa cap argument', () => {
      setHostname('unknown.eudistack.net');
      const url = service.buildFallbackUrl();
      expect(url).toBe('https://sandbox.eudistack.net/wallet/');
    });
  });
});
