import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { TranslateService } from '@ngx-translate/core';
import { PopoverController, IonicModule, NavController } from '@ionic/angular';
import { Router, ActivatedRoute, ActivatedRouteSnapshot, NavigationEnd } from '@angular/router';
import { of, Subject } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { StorageService } from './shared/services/storage.service';
import { RouterTestingModule } from '@angular/router/testing';
import { LoaderService } from './shared/services/loader.service';
import { MenuComponent } from './shared/components/menu/menu.component';
import { Oid4vciEngineService } from './core/protocol/oid4vci/oid4vci.engine.service';
import { ThemeService } from './core/services/theme.service';

describe('AppComponent', () => {
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;
  let translateServiceMock: jest.Mocked<TranslateService>;
  let popoverControllerMock: jest.Mocked<PopoverController>;
  let routerMock: jest.Mocked<Router>;
  let authServiceMock: jest.Mocked<AuthService>;
  let storageServiceMock: jest.Mocked<StorageService>;
  let routerEventsSubject: Subject<Event>;
  let themeServiceMock: { snapshot: any; getLogoUrl: jest.Mock };
  let oid4vciEngineMock: { init: jest.Mock };

  const activatedRouteMock: Partial<ActivatedRoute> = {
    snapshot: {
      queryParams: { nocache: 'true' },
      url: [],
      params: {},
      fragment: null,
      data: {},
      outlet: '',
      component: null,
      routeConfig: null,
      root: null,
      parent: null,
      firstChild: null,
      children: [],
      pathFromRoot: [],
      paramMap: {
        keys: [],
        get: jest.fn(),
        has: jest.fn(),
        getAll: jest.fn(),
      },
      queryParamMap: {
        keys: ['nocache'],
        get: jest.fn((key) => (key === 'nocache' ? 'true' : null)),
        has: jest.fn((key) => key === 'nocache'),
        getAll: jest.fn(),
      },
    } as unknown as ActivatedRouteSnapshot,
  };

  const navControllerMock = {
    navigateForward: jest.fn(),
    navigateBack: jest.fn(),
    setDirection: jest.fn(),
  } as unknown as jest.Mocked<NavController>;

  const saveNavigator = () => ({ languages: navigator.languages, language: navigator.language } as any);
  const mockNavigator = (langs: string[], lang: string) => {
    Object.defineProperty(window.navigator, 'languages', { value: langs, configurable: true });
    Object.defineProperty(window.navigator, 'language', { value: lang, configurable: true });
  };
  const restoreNavigator = (snapshot: any) => {
    Object.defineProperty(window.navigator, 'languages', { value: snapshot.languages, configurable: true });
    Object.defineProperty(window.navigator, 'language', { value: snapshot.language, configurable: true });
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    routerEventsSubject = new Subject<Event>();

    themeServiceMock = {
      snapshot: { branding: { logoUrl: null, logoDarkUrl: null } },
      getLogoUrl: jest.fn().mockReturnValue(null)
    };
    translateServiceMock = {
      addLangs: jest.fn(),
      getLangs: jest.fn().mockReturnValue(['en', 'es', 'ca']),
      setDefaultLang: jest.fn(),
      use: jest.fn()
    } as unknown as jest.Mocked<TranslateService>;

    popoverControllerMock = {
      create: jest.fn().mockResolvedValue({
        present: jest.fn(),
      }),
    } as unknown as jest.Mocked<PopoverController>;

    routerMock = {
      navigate: jest.fn(),
      events: routerEventsSubject as any,
      url: '/auth/login',
    } as unknown as jest.Mocked<Router>;

    authServiceMock = {
      getName$: jest.fn().mockReturnValue(of('John Doe')),
    } as unknown as jest.Mocked<AuthService>;

    storageServiceMock = {
      get: jest.fn().mockResolvedValue('en'),
      set: jest.fn(),
      remove: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;

    oid4vciEngineMock = {
      init: jest.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [
        AppComponent,
        IonicModule.forRoot(),
        RouterTestingModule,
      ],
      providers: [
        LoaderService,
        { provide: TranslateService, useValue: translateServiceMock },
        { provide: PopoverController, useValue: popoverControllerMock },
        { provide: Router, useValue: routerMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: StorageService, useValue: storageServiceMock },
        { provide: ActivatedRoute, useValue: activatedRouteMock },
        { provide: NavController, useValue: navControllerMock },
        { provide: ThemeService, useValue: themeServiceMock },
        { provide: Oid4vciEngineService, useValue: oid4vciEngineMock }
      ],
    })
      .overrideComponent(AppComponent, {
        add: {
          providers: [{ provide: PopoverController, useValue: popoverControllerMock }]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the app component', () => {
    expect(component).toBeTruthy();
  });

  it('should read logoSrc from ThemeService snapshot', () => {
    expect(component.logoSrc).toBeNull();
  });

  it('should show an alert if the device is iOS < 14.3 and not Safari', () => {
    const isIOSVersionLowerThanSpy = jest
      .spyOn(component['cameraService'], 'isIOSVersionLowerThan')
      .mockReturnValue(true);
    const isNotSafariSpy = jest
      .spyOn(component['cameraService'], 'isNotSafari')
      .mockReturnValue(true);
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

    (component as any).alertIncompatibleDevice();

    expect(isIOSVersionLowerThanSpy).toHaveBeenCalledWith(14.3);
    expect(isNotSafariSpy).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'This application scanner is probably not supported on this device with this browser. If you have issues, use Safari browser.'
    );

    jest.restoreAllMocks();
  });

  it('should NOT show an alert if iOS version is >= 14.3', () => {
    jest.spyOn(component['cameraService'], 'isIOSVersionLowerThan').mockReturnValue(false);
    jest.spyOn(component['cameraService'], 'isNotSafari').mockReturnValue(true);
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

    (component as any).alertIncompatibleDevice();

    expect(alertSpy).not.toHaveBeenCalled();

    jest.restoreAllMocks();
  });

  it('should NOT show an alert if browser is Safari', () => {
    jest.spyOn(component['cameraService'], 'isIOSVersionLowerThan').mockReturnValue(true);
    jest.spyOn(component['cameraService'], 'isNotSafari').mockReturnValue(false);
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

    (component as any).alertIncompatibleDevice();

    expect(alertSpy).not.toHaveBeenCalled();

    jest.restoreAllMocks();
  });

  it('should open a popover on Enter or Space keydown', () => {
    const mockEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    jest.spyOn(component, 'openPopover').mockImplementation();

    component.openPopoverByKeydown(mockEvent);
    expect(component.openPopover).toHaveBeenCalledWith(mockEvent);
  });

  it('should NOT open popover on /auth route', async () => {
    const event = new MouseEvent('click');

    (routerMock as any).url = '/auth/login';
    routerEventsSubject.next(new NavigationEnd(1, '/auth/login', '/auth/login') as any);

    await component.openPopover(event);

    expect(popoverControllerMock.create).not.toHaveBeenCalled();
  });

  it('should open popover on non-auth route', async () => {
    (component as any).isAuthRoute$ = () => false;

    popoverControllerMock.create.mockResolvedValue({
      present: jest.fn(),
    } as any);

    const event = new MouseEvent('click');
    await component.openPopover(event);

    expect(popoverControllerMock.create).toHaveBeenCalledWith({
      component: MenuComponent,
      event,
      translucent: true,
      cssClass: 'custom-popover',
    });
  });

  it('should emit and complete destroy subject', () => {
    const nextSpy = jest.spyOn(component['destroy$'], 'next');
    const completeSpy = jest.spyOn(component['destroy$'], 'complete');

    component['ngOnDestroy']();

    expect(nextSpy).toHaveBeenCalledTimes(1);
    expect(completeSpy).toHaveBeenCalledTimes(1);
  });

  describe('isAuthRoute$', () => {
    it('should return true for /auth/login route', fakeAsync(() => {
      (routerMock as any).url = '/auth/login';
      routerEventsSubject.next(new NavigationEnd(1, '/auth/login', '/auth/login') as any);
      tick();
      expect(component.isAuthRoute$()).toBe(true);
    }));

    it('should return false for non-auth route', fakeAsync(() => {
      (routerMock as any).url = '/home';
      routerEventsSubject.next(new NavigationEnd(1, '/home', '/home') as any);
      tick();
      expect(component.isAuthRoute$()).toBe(false);
    }));

    it('should return true for /auth/register route', fakeAsync(() => {
      (routerMock as any).url = '/auth/register';
      routerEventsSubject.next(new NavigationEnd(1, '/auth/register', '/auth/register') as any);
      tick();
      expect(component.isAuthRoute$()).toBe(true);
    }));
  });

  it('should synchronize isLoading$ with loader service', () => {
    const loaderService = TestBed.inject(LoaderService);
    expect(component.isLoading$()).toBe(loaderService.isLoading$());
    loaderService.addLoadingProcess();
    expect(component.isLoading$()).toBe(loaderService.isLoading$());
    expect(component.isLoading$()).toBeTruthy();
  });
});
