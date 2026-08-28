import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { tenantGuard } from './tenant.guard';
import { TenantService } from '../services/tenant.service';

describe('tenantGuard (wallet)', () => {
  let routerMock: jest.Mocked<Pick<Router, 'createUrlTree'>>;
  const fakeUrlTree = {} as UrlTree;

  function buildTenantServiceMock(tenantId: string | null) {
    return { tenant: () => tenantId };
  }

  function setup(tenantId: string | null): void {
    routerMock = { createUrlTree: jest.fn().mockReturnValue(fakeUrlTree) };

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: TenantService, useValue: buildTenantServiceMock(tenantId) },
      ],
    });
  }

  function runGuard(): boolean | UrlTree {
    return TestBed.runInInjectionContext(
      () => tenantGuard(null as any, null as any),
    ) as boolean | UrlTree;
  }

  it('retorna true quan el tenant és resolt', () => {
    setup('sandbox');
    expect(runGuard()).toBe(true);
    expect(routerMock.createUrlTree).not.toHaveBeenCalled();
  });

  it('retorna true per qualsevol tenant no-null', () => {
    setup('dome');
    expect(runGuard()).toBe(true);
  });

  it('redirigeix a /tenant-not-found quan el tenant no s\'ha pogut resoldre (null)', () => {
    setup(null);
    const result = runGuard();
    expect(result).toBe(fakeUrlTree);
    expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/tenant-not-found']);
  });
});
