import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { OssLicenseService } from './oss-license.service';
import { TelemetryService } from 'src/app/core/services/telemetry.service';
import { OssLicense } from '../models/oss-license.model';

describe('OssLicenseService', () => {
  let service: OssLicenseService;
  let httpMock: HttpTestingController;
  let telemetryMock: { track: jest.Mock };

  beforeEach(() => {
    telemetryMock = { track: jest.fn() };
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: TelemetryService, useValue: telemetryMock }],
    });
    service = TestBed.inject(OssLicenseService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('returns the packages array from the generated manifest (AC-05)', () => {
    let result: readonly OssLicense[] | undefined;
    service.load().subscribe((r) => (result = r));

    httpMock.expectOne('assets/legal/oss-licenses.json').flush({
      generatedAt: '2026-08-04T09:31:24.002Z',
      packages: [{ name: '@angular/core', version: '19.2.19', license: 'MIT', repository: null }],
    });

    expect(result).toEqual([{ name: '@angular/core', version: '19.2.19', license: 'MIT', repository: null }]);
  });

  it('degrades to an empty list and records the failure when the manifest is missing (ES-03)', () => {
    let result: readonly OssLicense[] | undefined;
    service.load().subscribe((r) => (result = r));

    httpMock.expectOne('assets/legal/oss-licenses.json').flush(null, { status: 404, statusText: 'Not Found' });

    expect(result).toEqual([]);
    expect(telemetryMock.track).toHaveBeenCalledWith('about_oss_licenses_unavailable');
  });
});
