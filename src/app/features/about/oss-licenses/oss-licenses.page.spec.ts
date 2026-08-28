import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { OssLicensesPage } from './oss-licenses.page';
import { OssLicenseService } from '../services/oss-license.service';
import { SupportChannelService } from '../services/support-channel.service';
import { OssLicense } from '../models/oss-license.model';

async function createFixture(licenses: readonly OssLicense[]): Promise<ComponentFixture<OssLicensesPage>> {
  const ossLicenseServiceMock = { load: jest.fn().mockReturnValue(of(licenses)) };
  const supportStub = { buildSupportMailto: jest.fn().mockReturnValue('mailto:support@eudistack.com') };

  await TestBed.configureTestingModule({
    schemas: [NO_ERRORS_SCHEMA],
    imports: [OssLicensesPage, IonicModule.forRoot(), TranslateModule.forRoot()],
    providers: [
      { provide: OssLicenseService, useValue: ossLicenseServiceMock },
      { provide: SupportChannelService, useValue: supportStub },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OssLicensesPage);
  fixture.detectChanges();
  return fixture;
}

describe('OssLicensesPage', () => {
  it('renders name, version and license for each dependency (AC-05)', async () => {
    const licenses: OssLicense[] = [
      { name: '@angular/core', version: '19.2.19', license: 'MIT', repository: 'https://github.com/angular/angular' },
      { name: 'some-pkg', version: '1.0.0', license: 'UNKNOWN', repository: null },
    ];
    const fixture = await createFixture(licenses);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('@angular/core');
    expect(text).toContain('19.2.19');
    expect(text).toContain('MIT');
    expect(text).toContain('some-pkg');
    expect(text).toContain('UNKNOWN');
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('renders all 250 entries without dropping any, for a large catalogue (EC-06)', async () => {
    const licenses: OssLicense[] = Array.from({ length: 250 }, (_, i) => ({
      name: `pkg-${i}`,
      version: '1.0.0',
      license: 'MIT',
      repository: null,
    }));
    const fixture = await createFixture(licenses);

    const items = fixture.nativeElement.querySelectorAll('ion-item.oss-license-item');
    expect(items.length).toBe(250);
  });

  it('shows an explanatory empty state with a support contact when the manifest is missing (ES-03)', async () => {
    const fixture = await createFixture([]);

    const emptyState = fixture.nativeElement.querySelector('.oss-licenses-empty');
    expect(emptyState).toBeTruthy();
    const contactLink: HTMLAnchorElement = fixture.nativeElement.querySelector('.oss-licenses-contact-link');
    expect(contactLink.getAttribute('href')).toBe('mailto:support@eudistack.com');
    expect(fixture.nativeElement.querySelectorAll('ion-item.oss-license-item').length).toBe(0);
  });
});
