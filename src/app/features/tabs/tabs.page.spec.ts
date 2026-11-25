import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { TabsPage } from './tabs.page';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from 'src/app/core/services/auth.service';

describe('TabsPage', () => {
  let component: TabsPage;
  let fixture: ComponentFixture<TabsPage>;
  const auth = { deviceUnavailable: jest.fn().mockReturnValue(false) };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
        RouterTestingModule,
        TranslateModule.forRoot()
      ],
      providers: [{ provide: AuthService, useValue: auth }]
    });

    fixture = TestBed.createComponent(TabsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('enables scanning while the session is bound to its device', () => {
    auth.deviceUnavailable.mockReturnValue(false);
    expect(component.scanDisabled()).toBe(false);
  });

  it('disables scanning while the binding of the device is being retried (EUD-15 design §2.2)', () => {
    auth.deviceUnavailable.mockReturnValue(true);
    expect(component.scanDisabled()).toBe(true);
  });
});
