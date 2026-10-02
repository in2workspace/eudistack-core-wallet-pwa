import { TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { AlertController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';
import { Oid4vciEngineService } from './oid4vci.engine.service';
import { CredentialIssuerMetadataService } from './credential-issuer-metadata.service';
import { AuthorisationServerMetadataService } from './authorisation-server-metadata.service';
import { PreAuthorizedTokenService } from './pre-authorized-token.service';
import { AuthorizationCodeTokenService } from './authorization-code-token.service';
import { CredentialService } from './credential.service';
import { ProofBuilderService } from './proof-builder.service';
import { JwtService } from './jwt.service';
import { NonceService } from './nonce.service';
import { DpopService } from './dpop.service';
import { KeyStorageProvider } from '../../spi/key-storage.provider.service';
import { HttpErrorInterceptor } from '../../interceptors/error-handler.interceptor';
import { AuthService } from '../../services/auth.service';
import { LocalCredentialStorageService } from '../../services/local-credential-storage.service';
import { CredentialParserService } from '../../utils/credential-parser.util';
import { WalletDiscoveryService } from '../../services/wallet-discovery.service';
import { SupportChannelService } from '../../services/support-channel.service';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { CredentialAlreadyIssuedError, CredentialOfferExpiredError, CredentialOfferNotFoundError } from '../../models/error/Oid4vciError';

// Real translations: the assertion is on the text the user actually reads.
// eslint-disable-next-line @typescript-eslint/no-var-requires, no-var
declare var require: (id: string) => { errors: Record<string, string> };
const esTranslations = require('../../../../assets/i18n/es.json');

/**
 * End-to-end through the real stack: HttpClient → HttpErrorInterceptor →
 * WalletService → CredentialOfferService → Oid4vciEngineService →
 * LoaderHandledFlowService → ToastServiceHandler (real, Spanish). Only the
 * network (HttpTestingController) and the Ionic alert are faked.
 */
describe('Integration: credential offer expired (HTTP 410 credential_offer_expired)', () => {
  const OFFER_URI = 'https://tenant.eudistack.test/issuer/oid4vci/v1/credential-offer/aa7ead92';
  const PROBLEM = {
    type: 'credential_offer_expired',
    title: 'Credential offer expired',
    status: 410,
    detail: 'The credential offer has expired.',
    instance: 'aa7ead92-35f7-4c24-af44-678d35dd38c0',
  };

  let engine: Oid4vciEngineService;
  let httpMock: HttpTestingController;
  let alertCreate: jest.Mock;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    alertCreate = jest.fn().mockResolvedValue({
      present: jest.fn().mockResolvedValue(undefined),
      onDidDismiss: jest.fn().mockResolvedValue(undefined),
    });

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: HttpErrorInterceptor, multi: true },
        { provide: AuthService, useValue: { isLoggedIn: () => true } },
        { provide: AlertController, useValue: { create: alertCreate } },
        { provide: SupportChannelService, useValue: { channels: () => ({ supportUrl: 'https://support.test' }) } },
        { provide: LoaderService, useValue: { addLoadingProcess: jest.fn(), removeLoadingProcess: jest.fn() } },
        // WalletService collaborators not involved in fetching the offer
        { provide: LocalCredentialStorageService, useValue: {} },
        { provide: CredentialParserService, useValue: {} },
        { provide: WalletDiscoveryService, useValue: { mode: signal('browser') } },
        { provide: CredentialCacheService, useValue: {} },
        // Engine steps after the offer: must never be reached
        { provide: KeyStorageProvider, useValue: { init: jest.fn().mockResolvedValue(undefined) } },
        { provide: CredentialIssuerMetadataService, useValue: { getCredentialIssuerMetadataFromCredentialOffer: jest.fn() } },
        { provide: AuthorisationServerMetadataService, useValue: {} },
        { provide: PreAuthorizedTokenService, useValue: {} },
        { provide: AuthorizationCodeTokenService, useValue: {} },
        { provide: CredentialService, useValue: {} },
        { provide: ProofBuilderService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: NonceService, useValue: {} },
        { provide: DpopService, useValue: {} },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('es', esTranslations);
    translate.use('es');

    engine = TestBed.inject(Oid4vciEngineService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    jest.restoreAllMocks();
  });

  async function runFlowAnswering410(body: string): Promise<unknown> {
    return runFlowAnswering(body, 410, 'Gone');
  }

  async function runFlowAnswering(body: string, status: number, statusText: string): Promise<unknown> {
    const flow = engine.performOid4vciFlow(OFFER_URI).catch((e: unknown) => e);
    const request = await waitForRequest(OFFER_URI);
    request.flush(body, { status, statusText });
    const error = await flow;
    await settle(); // the alert is presented asynchronously (translate → AlertController)
    return error;
  }

  /** The engine awaits init() before fetching, so the request is not issued synchronously. */
  async function waitForRequest(url: string): Promise<TestRequest> {
    for (let i = 0; i < 20; i++) {
      const [request] = httpMock.match(url);
      if (request) return request;
      await settle();
    }
    return httpMock.expectOne(url); // fails with a descriptive message
  }

  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function shownAlertText(): string {
    return alertCreate.mock.calls.map(([opts]) => String(opts.message)).join('\n');
  }

  it('captures the error as CredentialOfferExpiredError (no crash)', async () => {
    const error = await runFlowAnswering410(JSON.stringify(PROBLEM));

    expect(error).toBeInstanceOf(CredentialOfferExpiredError);
  });

  it('shows the specific Spanish message to the user', async () => {
    await runFlowAnswering410(JSON.stringify(PROBLEM));

    expect(shownAlertText()).toMatch(/ha expirado/i);
  });

  it('shows exactly one alert, never the generic or "cannot download" ones', async () => {
    await runFlowAnswering410(JSON.stringify(PROBLEM));

    // ASCII-only fragments: the alert HTML is sanitized, which entity-encodes accents.
    expect(alertCreate).toHaveBeenCalledTimes(1);
    expect(shownAlertText()).not.toMatch(/algo ha salido mal/i);
    expect(shownAlertText()).not.toMatch(/podido descargar/i);
  });

  it('does not leak technical details (detail/instance) to the user', async () => {
    await runFlowAnswering410(JSON.stringify(PROBLEM));

    expect(shownAlertText()).not.toContain(PROBLEM.detail);
    expect(shownAlertText()).not.toContain(PROBLEM.instance);
  });

  it('works with a minimal body carrying only the type', async () => {
    const error = await runFlowAnswering410(JSON.stringify({ type: 'credential_offer_expired' }));

    expect(error).toBeInstanceOf(CredentialOfferExpiredError);
  });

  it('logs status, type and instance for debugging', async () => {
    await runFlowAnswering410(JSON.stringify(PROBLEM));

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Credential offer expired'),
      { status: 410, type: 'credential_offer_expired', instance: PROBLEM.instance },
    );
  });

  it('stops the flow before contacting the issuer metadata', async () => {
    await runFlowAnswering410(JSON.stringify(PROBLEM));

    const metadata = TestBed.inject(CredentialIssuerMetadataService);
    expect(metadata.getCredentialIssuerMetadataFromCredentialOffer).not.toHaveBeenCalled();
  });

  describe('HTTP 404 credential_offer_not_found', () => {
    const NOT_FOUND = {
      type: 'credential_offer_not_found',
      title: 'Credential offer not found',
      status: 404,
      detail: 'CredentialOffer not found for nonce: hIDaRQRSQHWOX7gM8fsihQ',
      instance: '0b92da9f-8799-48a9-a44e-ebdcdf8c7612',
    };

    it('captures the error as CredentialOfferNotFoundError (no crash)', async () => {
      const error = await runFlowAnswering(JSON.stringify(NOT_FOUND), 404, 'Not Found');

      expect(error).toBeInstanceOf(CredentialOfferNotFoundError);
    });

    it('asks for a new offer and links to support, in a single alert', async () => {
      await runFlowAnswering(JSON.stringify(NOT_FOUND), 404, 'Not Found');

      expect(alertCreate).toHaveBeenCalledTimes(1);
      expect(shownAlertText()).toMatch(/genere una nueva/i);
      expect(shownAlertText()).toContain('href="https://support.test"');
    });

    it('never shows the generic or "cannot download" messages nor the nonce', async () => {
      await runFlowAnswering(JSON.stringify(NOT_FOUND), 404, 'Not Found');

      expect(shownAlertText()).not.toMatch(/algo ha salido mal|podido descargar/i);
      expect(shownAlertText()).not.toContain('hIDaRQRSQHWOX7gM8fsihQ');
    });
  });

  describe('HTTP 410 credential_already_issued', () => {
    const ALREADY_ISSUED = {
      type: 'credential_already_issued',
      title: 'Credential already issued',
      status: 410,
      detail: 'The credential has already been issued.',
      instance: '5b1d6a4e-1f0e-4c39-9d0f-2a7f3c1e9b10',
    };

    it('captures the error as CredentialAlreadyIssuedError (no crash)', async () => {
      const error = await runFlowAnswering410(JSON.stringify(ALREADY_ISSUED));

      expect(error).toBeInstanceOf(CredentialAlreadyIssuedError);
    });

    it('tells the user the credential is already in the wallet, in a single alert', async () => {
      await runFlowAnswering410(JSON.stringify(ALREADY_ISSUED));

      expect(alertCreate).toHaveBeenCalledTimes(1);
      expect(shownAlertText()).toMatch(/ya se encuentra en tu wallet/i);
    });

    it('never shows the generic, "cannot download" or "already processed" messages', async () => {
      await runFlowAnswering410(JSON.stringify(ALREADY_ISSUED));

      expect(shownAlertText()).not.toMatch(/algo ha salido mal|podido descargar|ya ha sido procesada/i);
    });
  });
});
