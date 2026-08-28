import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { InstanceGroupService } from './instance-group.service';
import { InstanceGroupsConfig } from '../models/instance-group.model';

const CONFIG_URL = '/assets/tenants/instance-groups.json';

const DOME_STG_CONFIG: InstanceGroupsConfig = {
  groups: [
    {
      id: 'dome-stg',
      brokerUrl: 'https://dome.stg.eudistack.net/wallet/assets/instance-broker.html',
      memberOrigins: [
        'https://dome.stg.eudistack.net',
        'https://wallet.dome-marketplace-lcl.org',
        'https://wallet.dome-marketplace-sbx.org',
      ],
    },
  ],
};

describe('InstanceGroupService', () => {
  let service: InstanceGroupService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InstanceGroupService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  describe('resolveGroupForOrigin()', () => {
    it('returns the matching group for a member origin', async () => {
      // Arrange
      const promise = service.resolveGroupForOrigin('https://wallet.dome-marketplace-lcl.org');

      // Act
      http.expectOne(CONFIG_URL).flush(DOME_STG_CONFIG);
      const result = await promise;

      // Assert
      expect(result?.id).toBe('dome-stg');
    });

    it('returns null for an origin absent from every group', async () => {
      // Arrange
      const promise = service.resolveGroupForOrigin('https://wallet-dome.127.0.0.1.nip.io:4443');

      // Act
      http.expectOne(CONFIG_URL).flush(DOME_STG_CONFIG);
      const result = await promise;

      // Assert
      expect(result).toBeNull();
    });

    it('returns null for a localhost/dev-network origin even when the tenant matches', async () => {
      // Arrange
      const promise = service.resolveGroupForOrigin('https://dome.127.0.0.1.nip.io:4445');

      // Act
      http.expectOne(CONFIG_URL).flush(DOME_STG_CONFIG);
      const result = await promise;

      // Assert
      expect(result).toBeNull();
    });

    it('returns null and swallows the error when the config request fails', async () => {
      // Arrange
      const promise = service.resolveGroupForOrigin('https://dome.stg.eudistack.net');

      // Act
      http.expectOne(CONFIG_URL).flush(null, { status: 500, statusText: 'Server Error' });
      const result = await promise;

      // Assert
      expect(result).toBeNull();
    });

    it('treats a malformed config (missing groups) as no groups instead of throwing', async () => {
      // Arrange
      const promise = service.resolveGroupForOrigin('https://dome.stg.eudistack.net');

      // Act — a 200 response that doesn't match the expected shape at all.
      http.expectOne(CONFIG_URL).flush({} as unknown as InstanceGroupsConfig);
      const result = await promise;

      // Assert
      expect(result).toBeNull();
    });

    it('falls back to no groups when the GET does not complete within the timeout', async () => {
      // Arrange
      jest.useFakeTimers();

      try {
        const promise = service.resolveGroupForOrigin('https://dome.stg.eudistack.net');
        http.expectOne(CONFIG_URL); // request made, but never flushed — simulates a hung connection

        // Act
        await jest.advanceTimersByTimeAsync(3001);
        const result = await promise;

        // Assert
        expect(result).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('defaults to window.location.origin when no origin is given', async () => {
      // Arrange
      const promise = service.resolveGroupForOrigin();

      // Act
      http.expectOne(CONFIG_URL).flush(DOME_STG_CONFIG);
      const result = await promise;

      // Assert — the test runner's own origin is never a member of any group.
      expect(result).toBeNull();
    });

    it('memoises the config request across calls', async () => {
      // Arrange
      const first = service.resolveGroupForOrigin('https://dome.stg.eudistack.net');
      http.expectOne(CONFIG_URL).flush(DOME_STG_CONFIG);
      await first;

      // Act
      const second = service.resolveGroupForOrigin('https://wallet.dome-marketplace-sbx.org');
      const result = await second;

      // Assert
      http.expectNone(CONFIG_URL);
      expect(result?.id).toBe('dome-stg');
    });
  });
});
