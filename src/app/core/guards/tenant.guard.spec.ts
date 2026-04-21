import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { tenantGuard } from './tenant.guard';

describe('tenantGuard (wallet)', () => {
  let routerMock: jest.Mocked<Pick<Router, 'createUrlTree'>>;
  const fakeUrlTree = {} as UrlTree;

  beforeEach(() => {
    routerMock = {
      createUrlTree: jest.fn().mockReturnValue(fakeUrlTree),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: routerMock },
      ],
    });
  });

  function runGuard(): boolean | UrlTree {
    return TestBed.runInInjectionContext(() => tenantGuard(null as any, null as any)) as boolean | UrlTree;
  }

  function mockHostname(hostname: string): void {
    Object.defineProperty(window, 'location', {
      value: { hostname },
      writable: true,
    });
  }

  it('retorna true per un tenant conegut', () => {
    mockHostname('dome.eudistack.net');
    expect(runGuard()).toBe(true);
    expect(routerMock.createUrlTree).not.toHaveBeenCalled();
  });

  it('retorna UrlTree a /tenant-not-found per un subdomain desconegut', () => {
    mockHostname('patata.eudistack.net');
    const result = runGuard();
    expect(result).toBe(fakeUrlTree);
    expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/tenant-not-found']);
  });

  it('accepta localhost per desenvolupament', () => {
    mockHostname('localhost');
    expect(runGuard()).toBe(true);
  });
});
