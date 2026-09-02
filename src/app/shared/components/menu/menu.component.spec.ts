import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MenuComponent } from './menu.component';
import { IonicModule, PopoverController } from '@ionic/angular';
import { AuthService } from 'src/app/core/services/auth.service';
import { ActivatedRoute, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

describe('MenuComponent', () => {
  let component: MenuComponent;
  let fixture: ComponentFixture<MenuComponent>;
  let popoverController = 
    {
      dismiss: jest.fn(() => Promise.resolve())
    }

  const mockAuthService = {
    logout: jest.fn(() => of(undefined)),
    getName$: jest.fn(() => of('isabella.rossellini@eng.it')),
  };
  const mockRouter = {
    navigate: jest.fn(),
    navigateByUrl: jest.fn(),
    createUrlTree: jest.fn((commands: unknown[]) => commands),
    serializeUrl: jest.fn((tree: unknown) => String(tree)),
    events: new Subject<unknown>(),
  };

  const menuItemByLabel = (key: string): DebugElement | undefined =>
    fixture.debugElement
      .queryAll(By.css('ion-item'))
      .find(item => item.nativeElement.textContent.trim() === key);

  beforeEach(async () => {
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [MenuComponent, IonicModule.forRoot(), TranslateModule.forRoot() ],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: {} },
      ],
    })
    .overrideProvider(PopoverController, { useValue: popoverController })
    .compileComponents();

    fixture = TestBed.createComponent(MenuComponent);
    component = fixture.componentInstance;
    console.log(component['popOverController']);
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  describe('navigation items', () => {
    const navigationItems = [
      { label: 'menu.activity', route: '/tabs/activity' },
      { label: 'menu.settings', route: '/tabs/settings' },
      { label: 'menu.connected-devices', route: '/tabs/devices' },
    ];

    it.each(navigationItems)('should render the $label entry', ({ label }) => {
      expect(menuItemByLabel(label)).toBeTruthy();
    });

    it.each(navigationItems)('should navigate to $route when $label is clicked', ({ label, route }) => {
      menuItemByLabel(label)!.nativeElement.click();

      expect(mockRouter.createUrlTree).toHaveBeenCalledWith([route], expect.any(Object));
      expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    it('should not navigate on load', () => {
      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('logoutOnKeydown', () => {
    it('should call logout on Enter key press', () => {
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      jest.spyOn(event, 'preventDefault');

      const logoutSpy = jest.spyOn(component, 'logout');

      component.logoutOnKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(logoutSpy).toHaveBeenCalled();
    });

    it('should call logout on Space key press', () => {
      const event = new KeyboardEvent('keydown', { key: ' ' });
      jest.spyOn(event, 'preventDefault');

      const logoutSpy = jest.spyOn(component, 'logout');

      component.logoutOnKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(logoutSpy).toHaveBeenCalled();
    });

    it('should not call logout on other key presses', () => {
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      jest.spyOn(event, 'preventDefault');

      const logoutSpy = jest.spyOn(component, 'logout');

      component.logoutOnKeydown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(logoutSpy).not.toHaveBeenCalled();
    });
  });
});
