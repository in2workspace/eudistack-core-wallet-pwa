import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { UrlResolverService } from './url-resolver.service';

/** Shape of an onboarding ticket (EUD-8 `annex/openapi.yaml`, `POST /auth/onboarding-tickets/redeem`). */
export const ONBOARDING_TICKET_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Shape of an "it was not me" token (`POST /auth/onboarding-tickets/disavowals`). */
export const DISAVOWAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

/** Scheme of the only offers an onboarding ticket carries: by reference, `openid-credential-offer://`. */
const CREDENTIAL_OFFER_SCHEME = 'openid-credential-offer://';

/** What redeeming an onboarding ticket gives the Wallet App (EUD-315, design §2.6). */
export interface OnboardingTicketRedemption {
  /** The email's account already has passkeys: no registration ticket, the user signs in. */
  hasPasskeys: boolean;
  /** The request carried a session of the ticket's account: the offer is resumed at once. */
  sessionOfAccount: boolean;
  /** Registration ticket bound to the pre-registration, only when `hasPasskeys` is false. */
  registrationTicket: string | null;
  /** Seconds the registration ticket is valid. */
  expiresIn: number;
  /** Offer sent by the system that asked for the ticket, if any. */
  credentialOffer: string | null;
}

/**
 * How the access screen is entered after an onboarding ticket (EUD-315):
 * - `ticket-create-passkey`: straight to Crear passkey, without the step indicator.
 * - `ticket-has-wallet`: Acceso with the notice "you already have a wallet".
 * - `invalid-ticket`: the Ticket no válido screen.
 */
export type OnboardingAccessEntry = 'ticket-create-passkey' | 'ticket-has-wallet' | 'invalid-ticket';

interface RedeemResponse {
  hasPasskeys?: unknown;
  sessionOfAccount?: unknown;
  registrationTicket?: unknown;
  expiresIn?: unknown;
  credentialOffer?: unknown;
}

/**
 * Calls of the Wallet Unit Service for the onboarding with a ticket (EUD-315):
 * redeeming the ticket and the "it was not me" disavowal. Both are public; the
 * auth interceptor adds the session token to the redemption only when a session
 * is open.
 *
 * Also carries, once, how the access screen has to be entered after a ticket
 * (`setAccessEntry` / `takeAccessEntry`), in memory only.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingTicketService {
  private readonly http = inject(HttpClient);
  private readonly urlResolver = inject(UrlResolverService);
  private accessEntry: OnboardingAccessEntry | null = null;

  private get base(): string { return `${this.urlResolver.serverUrl()}/api/v1/auth/onboarding-tickets`; }

  /** Consumes the ticket. Errors with the service's problem (401 `invalid_ticket`, 400, 429…). */
  public redeem(ticket: string): Observable<OnboardingTicketRedemption> {
    return this.http.post<RedeemResponse>(`${this.base}/redeem`, { ticket }).pipe(map(toRedemption));
  }

  /** Confirms "it was not me" with the token of the new-account email. 401 `invalid_token` when used or expired. */
  public disavow(token: string): Observable<void> {
    return this.http.post<void>(`${this.base}/disavowals`, { token }).pipe(map(() => undefined));
  }

  public setAccessEntry(entry: OnboardingAccessEntry): void {
    this.accessEntry = entry;
  }

  /** The pending entry of the access screen, cleared on read. */
  public takeAccessEntry(): OnboardingAccessEntry | null {
    const entry = this.accessEntry;
    this.accessEntry = null;
    return entry;
  }
}

function toRedemption(body: RedeemResponse | null): OnboardingTicketRedemption {
  const response = body ?? {};
  const registrationTicket = typeof response.registrationTicket === 'string' && response.registrationTicket !== ''
    ? response.registrationTicket
    : null;
  const offer = response.credentialOffer;
  return {
    hasPasskeys: response.hasPasskeys === true,
    sessionOfAccount: response.sessionOfAccount === true,
    registrationTicket,
    expiresIn: typeof response.expiresIn === 'number' && response.expiresIn > 0 ? response.expiresIn : 0,
    // The service only accepts offers by reference; anything else is not resumed.
    credentialOffer: typeof offer === 'string' && offer.startsWith(CREDENTIAL_OFFER_SCHEME) ? offer : null,
  };
}
