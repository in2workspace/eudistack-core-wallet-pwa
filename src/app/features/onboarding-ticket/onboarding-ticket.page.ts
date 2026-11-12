import { Component, ElementRef, Injector, OnInit, ViewChild, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { filter, firstValueFrom, take } from 'rxjs';
import { ACCESS_ROUTE, RemoteAuthService } from 'src/app/core/services/auth.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { WebAuthnBrowserService } from 'src/app/core/services/webauthn-browser.service';
import { SingleInstanceService } from 'src/app/core/services/single-instance.service';
import { RegistrationTicketService } from 'src/app/core/services/registration-ticket.service';
import {
  ONBOARDING_TICKET_PATTERN,
  OnboardingAccessEntry,
  OnboardingTicketRedemption,
  OnboardingTicketService,
} from 'src/app/core/services/onboarding-ticket.service';
import { AUTH_PROBLEM_TYPE, authProblemType } from 'src/app/core/models/error/WalletAuthError';
import { WALLET_HOME_ROUTE } from 'src/app/core/guards/auth.guard';
import {
  clearPendingDeepLink,
  savePendingCredentialOffer,
  takePendingDeepLink,
} from 'src/app/shared/helpers/pending-deep-link';

/** What replaces `/t#<ticket>` in the address bar and in the history (AC-04). */
export const TICKET_FREE_PATH = '/t';

/**
 * Onboarding address `/t#<ticket>` (EUD-315, design §2.6, wireframes "CanjeTicket").
 * The ticket is in the fragment, which never reaches the server: not in access logs
 * nor in the Referer header (P18).
 * Not a screen of its own: a wait notice while the ticket is redeemed, then
 * - Crear passkey without the step indicator (email without account, or without passkeys),
 * - Acceso with the "you already have a wallet" notice (account with passkeys),
 * - the wallet, resuming the offer (a session of the ticket's account is open),
 * - Ticket no válido (`invalid_ticket`).
 * The offer of the ticket is saved as a pending deep link in the three valid
 * cases. A temporary failure keeps the ticket in memory to retry.
 */
@Component({
  selector: 'app-onboarding-ticket',
  templateUrl: './onboarding-ticket.page.html',
  styleUrls: ['../auth/login/login.page.scss', './onboarding-ticket.page.scss'],
  imports: [IonicModule, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class OnboardingTicketPage implements OnInit {
  /**
   * `redeeming` shows the wait notice; `failed` a temporary failure with a retry; `invalid` the
   * Ticket no válido screen in a tab with a session, which cannot reach the access screen (AC-06).
   */
  public readonly state = signal<'redeeming' | 'failed' | 'invalid'>('redeeming');
  public readonly errorKey = signal('');

  @ViewChild('heading') private readonly heading?: ElementRef<HTMLElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly injector = inject(Injector);
  private readonly discovery = inject(WalletDiscoveryService);
  private readonly webAuthnBrowser = inject(WebAuthnBrowserService);
  private readonly onboardingTickets = inject(OnboardingTicketService);
  private readonly registrationTicket = inject(RegistrationTicketService);
  private readonly singleInstance = inject(SingleInstanceService);

  /** In memory only, for a retry after a temporary failure: it is no longer in the URL. */
  private ticket = '';

  public ngOnInit(): void {
    this.ticket = this.route.snapshot.fragment ?? '';
    // AC-04: the ticket leaves the address bar before anything else, replacing
    // its history entry. Location applies the base href (/wallet/ when deployed).
    this.location.replaceState(TICKET_FREE_PATH);
    void this.start();
  }

  public retry(): void {
    this.state.set('redeeming');
    void this.redeem();
  }

  public goToWallet(): void {
    void this.router.navigateByUrl(WALLET_HOME_ROUTE, { replaceUrl: true });
  }

  public goToAccess(): void {
    void this.router.navigateByUrl(ACCESS_ROUTE, { replaceUrl: true });
  }

  private async start(): Promise<void> {
    // EC-17 (task 46): with the Wallet App already open in another tab, that tab redeems the ticket,
    // which this one hands over; a duplicate tab never consumes it.
    if (!(await this.singleInstance.whenLeaderDecided())) {
      return;
    }
    // Onboarding tickets belong to the Wallet Unit Service (server mode).
    if (this.discovery.mode() !== 'server') {
      await this.router.navigateByUrl('/', { replaceUrl: true });
      return;
    }
    // EC-06, FR-01: without passkey support the ticket is not redeemed; the
    // access screen shows Requisitos no cumplidos.
    if (!(await this.webAuthnBrowser.isPasskeySupported())) {
      this.goToAccess();
      return;
    }
    if (!ONBOARDING_TICKET_PATTERN.test(this.ticket)) {
      // The service would answer 400: same screen as an unknown ticket (FR-30).
      await this.showInvalidTicket();
      return;
    }
    await this.redeem();
  }

  private async redeem(): Promise<void> {
    const auth = this.injector.get(RemoteAuthService);
    // The redemption carries the session token when a session is open (AC-09):
    // the start-up resume has to settle first.
    await firstValueFrom(auth.isInitialized$().pipe(filter(Boolean), take(1)));
    let redemption: OnboardingTicketRedemption;
    try {
      redemption = await firstValueFrom(this.onboardingTickets.redeem(this.ticket));
    } catch (err: unknown) {
      await this.handleRedeemError(err);
      return;
    }
    this.ticket = '';
    await this.continueAfterRedemption(auth, redemption);
  }

  private async continueAfterRedemption(auth: RemoteAuthService, redemption: OnboardingTicketRedemption): Promise<void> {
    if (redemption.sessionOfAccount && auth.isLoggedIn()) {
      this.keepOffer(redemption);
      await this.enterWallet(auth, redemption);
      return;
    }
    if (auth.isLoggedIn()) {
      // PRD §3.4, EC-02: a session of another account is closed and the onboarding
      // goes on. Done before keeping the registration ticket: ending a session forgets it.
      await firstValueFrom(auth.logout());
    }
    this.keepOffer(redemption);
    if (redemption.hasPasskeys) {
      await this.goToAccessWith('ticket-has-wallet');
      return;
    }
    if (redemption.registrationTicket === null) {
      // Outside the contract: hasPasskeys = false always carries a registration ticket.
      console.error('[OnboardingTicketPage] Redemption without a registration ticket');
      this.fail('wallet-access.errors.generic');
      return;
    }
    this.registrationTicket.set(redemption.registrationTicket, redemption.expiresIn);
    await this.goToAccessWith('ticket-create-passkey');
  }

  /** The ticket's offer is resumed once the session is open; without one, nothing is (EC-05). */
  private keepOffer(redemption: OnboardingTicketRedemption): void {
    if (redemption.credentialOffer) {
      savePendingCredentialOffer(redemption.credentialOffer);
    } else {
      clearPendingDeepLink();
    }
  }

  private async enterWallet(auth: RemoteAuthService, redemption: OnboardingTicketRedemption): Promise<void> {
    if (redemption.credentialOffer) {
      // As in the access screen: the offer waits for the session's attestations.
      await auth.sessionDataReady();
    }
    await this.router.navigateByUrl(takePendingDeepLink() || WALLET_HOME_ROUTE, { replaceUrl: true });
  }

  private async handleRedeemError(err: unknown): Promise<void> {
    const type = authProblemType(err);
    const status = err instanceof HttpErrorResponse ? err.status : undefined;
    if (type === AUTH_PROBLEM_TYPE.INVALID_TICKET || status === 401 || status === 400) {
      this.ticket = '';
      await this.showInvalidTicket();
      return;
    }
    if (status === 429) {
      this.fail('auth.errors.too-many-attempts');
      return;
    }
    console.error('[OnboardingTicketPage] Redemption failed:', err);
    this.fail(status === 0 ? 'errors.network-error' : 'wallet-access.errors.generic');
  }

  /**
   * AC-06, AC-12: Ticket no válido. The access screen shows it, but a tab with a session never gets
   * there (its guard sends it to the wallet), so that tab shows it here, with a way back to the wallet.
   */
  private async showInvalidTicket(): Promise<void> {
    const auth = this.injector.get(RemoteAuthService);
    await firstValueFrom(auth.isInitialized$().pipe(filter(Boolean), take(1)));
    if (!auth.isLoggedIn()) {
      await this.goToAccessWith('invalid-ticket');
      return;
    }
    this.state.set('invalid');
    setTimeout(() => this.heading?.nativeElement.focus());
  }

  private fail(errorKey: string): void {
    this.errorKey.set(errorKey);
    this.state.set('failed');
    // Announce the new screen to screen readers (WCAG 2.4.3), as the access screen does.
    setTimeout(() => this.heading?.nativeElement.focus());
  }

  private async goToAccessWith(entry: OnboardingAccessEntry): Promise<void> {
    this.onboardingTickets.setAccessEntry(entry);
    await this.router.navigateByUrl(ACCESS_ROUTE, { replaceUrl: true });
  }
}
