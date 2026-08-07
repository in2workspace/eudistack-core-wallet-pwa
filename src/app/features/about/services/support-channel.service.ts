import { Injectable, inject } from '@angular/core';
import { ThemeService } from 'src/app/core/services/theme.service';
import { BUILD_INFO } from 'src/app/core/constants/build-info.constants';
import {
  ISSUE_TRACKER_URL,
  SUPPORT_EMAIL,
  SupportChannels,
  isEmailAddress,
  isHttpsUrl,
} from 'src/app/core/constants/support.constants';

/**
 * EC-07 / AD-4 — resolves support channels with tenant → constant precedence,
 * validating the tenant-provided value's schema before trusting it. A
 * malformed or manipulated theme.json falls back to the known default
 * instead of redirecting support to an arbitrary destination (STRIDE Spoofing).
 */
@Injectable({ providedIn: 'root' })
export class SupportChannelService {
  private readonly theme = inject(ThemeService);

  channels(): SupportChannels {
    const content = this.theme.snapshot?.content;
    return {
      email: isEmailAddress(content?.supportEmail) ? content!.supportEmail! : SUPPORT_EMAIL,
      helpCenterUrl: isHttpsUrl(content?.knowledgeBaseUrl) ? content!.knowledgeBaseUrl! : null,
      issueTrackerUrl: isHttpsUrl(content?.issueTrackerUrl) ? content!.issueTrackerUrl! : ISSUE_TRACKER_URL,
    };
  }

  /**
   * AC-07 / NFR-S-135-07 — the body contains EXACTLY version and build.
   * No user identifier, credential, tenant or session data.
   */
  buildSupportMailto(): string {
    const subject = `EUDIStack Wallet ${BUILD_INFO.version} (${BUILD_INFO.buildId})`;
    const body = `\n\n---\nversion: ${BUILD_INFO.version}\nbuild: ${BUILD_INFO.buildId}\n`;
    return (
      `mailto:${this.channels().email}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`
    );
  }

  /**
   * AC-08 — the issue template is prefilled ONLY with version and build.
   * Forbidden to auto-attach logs, app state, or session identifiers (AD-5).
   */
  buildIssueUrl(): string {
    const base = this.channels().issueTrackerUrl;
    const params = new URLSearchParams({
      title: '[wallet] ',
      body:
        `**Version:** ${BUILD_INFO.version}\n**Build:** ${BUILD_INFO.buildId}\n\n` +
        `<!-- Do not include personal data or screenshots with identifiable information. -->\n\n`,
    });
    return `${base}${base.includes('?') ? '&' : '?'}${params.toString()}`;
  }
}
