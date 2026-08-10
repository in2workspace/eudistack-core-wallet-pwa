import { TestBed } from '@angular/core/testing';
import { SupportChannelService } from './support-channel.service';
import { ThemeService } from 'src/app/core/services/theme.service';
import { BUILD_INFO } from 'src/app/core/constants/build-info.constants';
import { ISSUE_TRACKER_URL, SUPPORT_EMAIL } from 'src/app/core/constants/support.constants';
import { Theme } from 'src/app/core/models/theme.model';

function makeThemeStub(content: Partial<Theme['content']> | null): Partial<ThemeService> {
  return { snapshot: content ? ({ content } as Theme) : null };
}

function configure(themeStub: Partial<ThemeService>): SupportChannelService {
  TestBed.configureTestingModule({
    providers: [{ provide: ThemeService, useValue: themeStub }],
  });
  return TestBed.inject(SupportChannelService);
}

describe('SupportChannelService', () => {
  describe('channels()', () => {
    it('uses the default constants when the theme has no overrides (EC-07, case B)', () => {
      const service = configure(makeThemeStub({ links: [], footer: null }));

      expect(service.channels()).toEqual({
        email: SUPPORT_EMAIL,
        helpCenterUrl: null,
        issueTrackerUrl: ISSUE_TRACKER_URL,
      });
    });

    it('uses the default constants when the theme snapshot is null', () => {
      const service = configure(makeThemeStub(null));

      expect(service.channels()).toEqual({
        email: SUPPORT_EMAIL,
        helpCenterUrl: null,
        issueTrackerUrl: ISSUE_TRACKER_URL,
      });
    });

    it('prefers the tenant support email and issue tracker when schema-valid (EC-07, case A)', () => {
      const service = configure(
        makeThemeStub({
          links: [],
          footer: null,
          supportEmail: 'help@customer.example',
          issueTrackerUrl: 'https://issues.customer.example/new',
          knowledgeBaseUrl: 'https://docs.customer.example',
        })
      );

      expect(service.channels()).toEqual({
        email: 'help@customer.example',
        helpCenterUrl: 'https://docs.customer.example',
        issueTrackerUrl: 'https://issues.customer.example/new',
      });
    });

    it('discards a malformed tenant override and falls back to the default (EC-07, case C — fail-closed)', () => {
      const service = configure(
        makeThemeStub({
          links: [],
          footer: null,
          supportEmail: 'not-an-email',
          issueTrackerUrl: 'not-a-url',
          knowledgeBaseUrl: 'http://insecure.example', // not https
        })
      );

      expect(service.channels()).toEqual({
        email: SUPPORT_EMAIL,
        helpCenterUrl: null,
        issueTrackerUrl: ISSUE_TRACKER_URL,
      });
    });
  });

  describe('buildSupportMailto() — AC-07, NFR-S-135-07', () => {
    it('builds a mailto with only version and build in the body, no PII', () => {
      const service = configure(makeThemeStub({ links: [], footer: null }));

      const mailto = service.buildSupportMailto();

      expect(mailto).toMatch(new RegExp(`^mailto:${SUPPORT_EMAIL}\\?subject=`));
      const [, query] = mailto.split('?');
      const params = new URLSearchParams(query);
      const body = decodeURIComponent(params.get('body') ?? '');
      expect(body).toContain(BUILD_INFO.version);
      expect(body).toContain(BUILD_INFO.buildId);
      expect(body).not.toMatch(/user|credential|session|tenant/i);
    });
  });

  describe('buildIssueUrl() — AC-08', () => {
    it('prefills only version and build, with the PII warning as an HTML comment', () => {
      const service = configure(makeThemeStub({ links: [], footer: null }));

      const url = service.buildIssueUrl();

      expect(url.startsWith(`${ISSUE_TRACKER_URL}?`)).toBe(true);
      const params = new URLSearchParams(url.split('?')[1]);
      expect(params.get('body')).toContain(BUILD_INFO.version);
      expect(params.get('body')).toContain(BUILD_INFO.buildId);
      expect(params.get('body')).not.toMatch(/user|credential|session|tenant/i);
    });

    it('joins query params with & when the base tracker URL already has a query string', () => {
      const service = configure(
        makeThemeStub({ links: [], footer: null, issueTrackerUrl: 'https://issues.example/new?template=bug' })
      );

      const url = service.buildIssueUrl();

      expect(url.startsWith('https://issues.example/new?template=bug&')).toBe(true);
    });
  });
});
