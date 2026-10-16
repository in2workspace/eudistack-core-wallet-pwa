import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';
import { PasskeyStoreService } from '../services/passkey-store.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

describe('authGuard', () => {
  let router: Router;
  let initialized$: BehaviorSubject<boolean>;
  let authService: { isInitialized$: jest.Mock; isLoggedIn: jest.Mock };
  let passkeyStore: { hasPasskey: jest.Mock };

  const stateFor = (url: string) => ({ url }) as RouterStateSnapshot;
  const runGuard = (url: string) =>
    TestBed.runInInjectionContext(() => authGuard(null as any, stateFor(url))) as Observable<boolean | UrlTree>;

  beforeEach(() => {
    sessionStorage.clear();
    initialized$ = new BehaviorSubject<boolean>(true);
    authService = {
      isInitialized$: jest.fn().mockReturnValue(initialized$.asObservable()),
      isLoggedIn: jest.fn().mockReturnValue(false),
    };
    passkeyStore = { hasPasskey: jest.fn().mockReturnValue(true) };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authService },
        { provide: PasskeyStoreService, useValue: passkeyStore },
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => sessionStorage.clear());

  it('allows the navigation when the user is logged in', async () => {
    authService.isLoggedIn.mockReturnValue(true);

    expect(await firstValueFrom(runGuard('/tabs/credentials'))).toBe(true);
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
  });

  it('redirects to /auth/login when logged out and a passkey exists', async () => {
    const result = await firstValueFrom(runGuard('/tabs/credentials'));

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/auth/login');
  });

  it('redirects to /auth/register when logged out and there is no passkey', async () => {
    passkeyStore.hasPasskey.mockReturnValue(false);

    const result = await firstValueFrom(runGuard('/tabs/credentials'));

    expect(router.serializeUrl(result as UrlTree)).toBe('/auth/register');
  });

  it('keeps the requested URL as a pending deep link when logged out', async () => {
    await firstValueFrom(runGuard('/protocol/callback?code=abc'));

    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe('/protocol/callback?code=abc');
  });

  it('does not keep the root URL as a pending deep link', async () => {
    await firstValueFrom(runGuard('/'));

    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
  });

  it('waits for the auth service to be initialized before deciding', async () => {
    initialized$.next(false);
    authService.isLoggedIn.mockReturnValue(true);
    let emitted: boolean | UrlTree | undefined;
    runGuard('/tabs/credentials').subscribe(value => (emitted = value));

    expect(emitted).toBeUndefined();
    expect(authService.isLoggedIn).not.toHaveBeenCalled();

    initialized$.next(true);

    expect(emitted).toBe(true);
  });
});
