import { Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ACCESS_ROUTE } from 'src/app/core/services/auth.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { DISAVOWAL_TOKEN_PATTERN, OnboardingTicketService } from 'src/app/core/services/onboarding-ticket.service';

/** What replaces `/no-he-sido-yo#<token>` in the address bar: the token is a secret. */
export const NOT_ME_TOKEN_FREE_PATH = '/no-he-sido-yo';

/**
 * Screens of "No he sido yo" (EUD-315, wireframes "No he sido yo", FR-29, FR-32):
 * - `confirm`: the question, with confirm and cancel.
 * - `done`: the service ended the sessions and removed the passkey.
 * - `invalid`: the link was used or expired.
 */
export type NotMeScreen = 'confirm' | 'done' | 'invalid';

/**
 * Page the "it was not me" link of the new-account email opens (`/no-he-sido-yo#<token>`;
 * the token is in the fragment, which never reaches the server, P18).
 * It never starts a session nor asks for a passkey (AC-10): the only call is the
 * public disavowal, and only after the holder confirms (EC-10).
 */
@Component({
  selector: 'app-not-me',
  templateUrl: './not-me.page.html',
  styleUrls: ['../auth/login/login.page.scss', './not-me.page.scss'],
  imports: [IonicModule, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class NotMePage implements OnInit {
  public readonly screen = signal<NotMeScreen>('confirm');
  public readonly busy = signal(false);
  public readonly errorKey = signal('');

  @ViewChild('heading') private readonly heading?: ElementRef<HTMLElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly discovery = inject(WalletDiscoveryService);
  private readonly onboardingTickets = inject(OnboardingTicketService);

  /** In memory only once read from the URL. */
  private token = '';

  public ngOnInit(): void {
    this.token = this.route.snapshot.fragment ?? '';
    this.location.replaceState(NOT_ME_TOKEN_FREE_PATH);
    if (this.discovery.mode() !== 'server') {
      // Accounts and their disavowal belong to the Wallet Unit Service (server mode).
      void this.router.navigateByUrl('/', { replaceUrl: true });
      return;
    }
    if (!DISAVOWAL_TOKEN_PATTERN.test(this.token)) {
      this.goTo('invalid');
      return;
    }
    this.focusHeading();
  }

  public async confirm(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorKey.set('');
    try {
      await firstValueFrom(this.onboardingTickets.disavow(this.token));
      this.token = '';
      this.goTo('done');
    } catch (err: unknown) {
      this.handleError(err);
    } finally {
      this.busy.set(false);
    }
  }

  /** EC-10: nothing is sent; the link keeps working until it expires. */
  public cancel(): void {
    this.token = '';
    void this.router.navigateByUrl('/', { replaceUrl: true });
  }

  public goToAccess(): void {
    void this.router.navigateByUrl(ACCESS_ROUTE, { replaceUrl: true });
  }

  private handleError(err: unknown): void {
    const status = err instanceof HttpErrorResponse ? err.status : undefined;
    if (status === 401 || status === 400) {
      // 401 `invalid_token` (used or older than 7 days); 400 is a malformed token.
      this.token = '';
      this.goTo('invalid');
      return;
    }
    console.error('[NotMePage] Disavowal failed:', err);
    if (status === 429) {
      this.errorKey.set('auth.errors.too-many-attempts');
    } else {
      this.errorKey.set(status === 0 ? 'errors.network-error' : 'wallet-access.errors.generic');
    }
  }

  private goTo(screen: NotMeScreen): void {
    this.errorKey.set('');
    this.screen.set(screen);
    this.focusHeading();
  }

  /** Puts the focus on the heading so screen readers announce the screen (WCAG 2.4.3). */
  private focusHeading(): void {
    setTimeout(() => this.heading?.nativeElement.focus());
  }
}
