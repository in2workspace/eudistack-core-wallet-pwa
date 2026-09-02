import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { StorageService } from 'src/app/shared/services/storage.service';
import { WalletService } from 'src/app/core/services/wallet.service';
import { VcViewComponent } from '../../shared/components/vc-view/vc-view.component';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LifeCycleStatus, VerifiableCredential } from 'src/app/core/models/verifiable-credential';
import { CameraLogsService } from 'src/app/shared/services/camera-logs.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { catchError, EMPTY, finalize, forkJoin, from, Observable, of, switchMap, take, tap } from 'rxjs';
import { ExtendedHttpErrorResponse } from 'src/app/core/models/errors';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { Oid4vciEngineService } from 'src/app/core/protocol/oid4vci/oid4vci.engine.service';
import { AuthorizationRequestService, InvalidQrError } from 'src/app/core/protocol/oid4vp/authorization-request.service';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';
import { CredentialPreviewBuilderService } from 'src/app/core/services/credential-preview-builder.service';
import { CredentialDecisionService } from 'src/app/core/services/credential-decision.service';
import { IssuerNotificationService, NOTIFICATION_EVENT } from 'src/app/core/services/issuer-notification.service';
import { FinalizeIssuancePayload } from 'src/app/core/models/FinalizeIssuancePayload';
import { SkeletonComponent } from 'src/app/shared/components/skeleton/skeleton.component';
import { IssuerMetadataCacheService } from 'src/app/core/services/issuer-metadata-cache.service';
import { ActivityService } from 'src/app/core/services/activity.service';
import { UserPreferencesService } from 'src/app/shared/services/user-preferences.service';
import { HapticService } from 'src/app/shared/services/haptic.service';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { CredentialVerificationService } from 'src/app/core/services/credential-verification.service';
import dayjs from 'dayjs';

@Component({
    selector: 'app-credentials',
    templateUrl: './credentials.page.html',
    styleUrls: ['./credentials.page.scss'],
    providers: [StorageService],
    imports: [
        IonicModule,
        CommonModule,
        VcViewComponent,
        TranslateModule,
        SkeletonComponent
    ]
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class CredentialsPage implements OnInit, ViewWillEnter {
  public credentialOfferUri = '';
  public bannerDismissed = false;
  readonly prefs = inject(UserPreferencesService);
  public selectedCredentialId: string | null = null;

  private readonly authorizationRequestService = inject(AuthorizationRequestService);
  private readonly cameraLogsService = inject(CameraLogsService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly credentialCacheService = inject(CredentialCacheService);
  private readonly credentialDecisionService = inject(CredentialDecisionService);
  private readonly credentialPreviewBuilder = inject(CredentialPreviewBuilderService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly issuerMetadataCache = inject(IssuerMetadataCacheService);
  private readonly issuerNotificationService = inject(IssuerNotificationService);
  private readonly loader = inject(LoaderService);
  private readonly oid4vciEngineService = inject(Oid4vciEngineService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastServiceHandler = inject(ToastServiceHandler);
  private readonly walletService = inject(WalletService);
  private readonly activityService = inject(ActivityService);
  private readonly hapticService = inject(HapticService);
  private readonly verificationService = inject(CredentialVerificationService);
  private readonly pwaInstallService = inject(PwaInstallService);

  public readonly canInstall$ = this.pwaInstallService.installable$;

  private authorizationRequest = '';
  private revokedCredentialIds = new Set<string>();

  /** Reactive credential list + load status, owned by CredentialCacheService. */
  public readonly credList = this.credentialCacheService.credentials;
  public readonly loadStatus = this.credentialCacheService.status;
  /** True once ngOnInit has run; distinguishes first mount from later (cached-page) navigations. */
  private initialized = false;

  public constructor(){
    //todo move to ngOnInit to avoid using credentialOfferUri
    this.route.queryParams
      .pipe(takeUntilDestroyed())
      .subscribe((params) => {
        this.credentialOfferUri = params['credentialOfferUri'] || params['credential_offer_uri'];
        this.authorizationRequest = params['authorizationRequest'] ?? '';
        this.selectedCredentialId = params['id'] ?? null;
        this.cdr.detectChanges();

        // IonicRouteStrategy caches pages — ngOnInit won't re-run when the leader tab
        // receives a NAVIGATE / deep-link replay and lands here with new protocol params.
        // Once initialized, trigger the flow directly. Both flows self-load credentials,
        // so no readiness guard is needed.
        if (this.initialized) {
          this.runPendingProtocolFlow();
        }
      });
  }

  public async installApp(): Promise<void> {
    await this.pwaInstallService.promptInstall();
  }

  public dismissInstallBanner(): void {
    this.bannerDismissed = true;
  }

  public startScan(): void {
    this.hapticService.impact();
    this.router.navigate(['/tabs/scan'])
      .catch(() => this.toastServiceHandler.showErrorAlertByTranslateLabel('errors.navigation').subscribe());
  }

  public ngOnInit(): void {
    this.initialized = true;
    // Protocol flows self-load the credential list (VP gates on refreshCredentials()).
    // A plain visit relies on ionViewWillEnter to populate the reactive store.
    this.runPendingProtocolFlow();
  }

  public ionViewWillEnter(): void {
    // When a protocol flow (VP / credential offer) is pending, that flow owns the
    // credential load (verifiablePresentationFlow gates on refreshCredentials) and
    // then navigates away. Refreshing here too would be a redundant, overlapping
    // IndexedDB read and could flicker the skeleton on an empty wallet.
    if (!this.authorizationRequest && !this.credentialOfferUri) {
      this.refreshForDisplay();
    }
    this.cdr.detectChanges();
  }

  private runPendingProtocolFlow(): void {
    if (this.credentialOfferUri) {
      this.sameDeviceVcActivationFlow(this.credentialOfferUri);
    } else if (this.authorizationRequest) {
      console.info('Processing authorization request via same-device flow.');
      this.verifiablePresentationFlow(this.authorizationRequest);
    }
  }

  /** Reloads the reactive store for display; the skeleton is driven by loadStatus(). */
  private refreshForDisplay(): void {
    this.walletService.refreshCredentials()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.reapplyKnownRevocations();
        this.checkCredentialStatuses();
      });
  }

  private reapplyKnownRevocations(): void {
    for (const id of this.revokedCredentialIds) {
      this.credentialCacheService.patchStatus(id, 'REVOKED');
    }
  }

  public ionViewDidEnter(): void {
    this.requestPendingSignatures();
  }


  public onPrivacyModeChange(event: CustomEvent<{ value?: string | number }>): void {
    const shouldBlur = event.detail.value === 'hide';
    if (this.prefs.privacyBlur() !== shouldBlur) {
      this.prefs.togglePrivacyBlur();
    }
  }

  public onCredentialStatusChanged(event: { id: string; status: LifeCycleStatus }): void {
    this.credentialCacheService.patchStatus(event.id, event.status);
    if (event.status === 'REVOKED') {
      this.revokedCredentialIds.add(event.id);
    }
  }

  public vcDelete(cred: VerifiableCredential): void {
    this.loader.addLoadingProcess();
    this.walletService.deleteVC(cred.id)
    .pipe(
      tap(() => {
        const credName = cred.name ?? cred.type?.[0] ?? 'Unknown';
        const issuer = cred.issuer?.organization ?? cred.issuer?.id ?? '';
        this.activityService.log('deleted', credName, issuer);
        this.toastServiceHandler.showToast('vc-view.delete-success');
      }),
      switchMap(() => this.walletService.refreshCredentials()),
      finalize(() => this.loader.removeLoadingProcess()),
      takeUntilDestroyed(this.destroyRef)
    )
    .subscribe();
  }


  public handleRefresh(event: { target: { complete: () => void } }): void {
    this.walletService.refreshCredentials()
      .pipe(
        finalize(() => event.target.complete()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.reapplyKnownRevocations();
        this.checkCredentialStatuses();
      });
  }


  private sameDeviceVcActivationFlow(credentialOfferUri: string): void {
    console.info('Requesting Credential Offer via same-device flow.')
    this.credentialActivationFlow(credentialOfferUri);
  }

  private credentialActivationFlow(credentialOfferUri: string): void{
    from(this.oid4vciEngineService.performOid4vciFlow(credentialOfferUri))
      .pipe(
        switchMap((flowResult: FinalizeIssuancePayload) => {
          // Deferred credentials (202): save to backend without user decision
          if (flowResult.credentialResponseWithStatus.statusCode === 202) {
            return this.walletService.finalizeCredentialIssuance(flowResult)
              .pipe(switchMap(() => this.handleActivationSuccess()));
          }

          // Normal flow (200): show preview and ask user
          const configId = flowResult.credentialConfigurationId;
          const config = flowResult.issuerMetadata.credential_configurations_supported?.[configId];
          const credentialMetadata = config?.credential_metadata;

          const preview = this.credentialPreviewBuilder.buildPreview(
            flowResult.credentialResponseWithStatus.credentialResponse,
            credentialMetadata,
            flowResult.format
          );

          return from(this.credentialDecisionService.showDecisionDialog(preview))
            .pipe(
              switchMap((decision) => {
                if (decision === 'ACCEPTED') {
                  return this.handleCredentialAccepted(flowResult);
                }
                return this.handleCredentialRejected(flowResult, decision);
              })
            );
        }),

        catchError((err: ExtendedHttpErrorResponse) => {
          console.error(err);
          this.handleContentExecutionError(err);
          return of(null);
        }),

        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private handleCredentialAccepted(flowResult: FinalizeIssuancePayload): Observable<boolean> {
    return this.walletService.finalizeCredentialIssuance(flowResult).pipe(
      tap(() => this.notifyIssuer(flowResult, NOTIFICATION_EVENT.CREDENTIAL_ACCEPTED, 'Credential accepted by user')),
      tap(() => this.credentialDecisionService.showTempMessage('home.ok-msg')),
      tap(() => this.registerIssuerMetadata(flowResult)),
      tap(() => {
        const configId = flowResult.credentialConfigurationId;
        const config = flowResult.issuerMetadata.credential_configurations_supported?.[configId];
        const credName = config?.credential_metadata?.display?.[0]?.name ?? configId ?? 'Unknown';
        const issuer = flowResult.issuerMetadata.credentialIssuer ?? '';
        this.activityService.log('issued', credName, issuer);
      }),
      switchMap(() => this.handleActivationSuccess())
    );
  }

  private registerIssuerMetadata(flowResult: FinalizeIssuancePayload): void {
    const issuerUrl = flowResult.issuerMetadata.credentialIssuer;
    const configId = flowResult.credentialConfigurationId;
    if (!issuerUrl || !configId) return;

    // Registration is fire-and-forget; credential ID will be mapped when refreshCredentials() runs
    // We use a placeholder since we don't have the backend-assigned ID yet
    // The actual mapping will happen when the credential list is reloaded
    this.issuerMetadataCache.registerIssuance(
      `pending-${Date.now()}`, issuerUrl, configId, flowResult.issuerMetadata
    ).catch(console.warn);
  }

  private handleCredentialRejected(flowResult: FinalizeIssuancePayload, decision: string): Observable<boolean> {
    const event = decision === 'REJECTED'
      ? NOTIFICATION_EVENT.CREDENTIAL_DELETED
      : NOTIFICATION_EVENT.CREDENTIAL_FAILURE;
    const description = decision === 'REJECTED'
      ? 'User rejected credential'
      : 'Timeout waiting for user decision';

    this.notifyIssuer(flowResult, event, description);
    this.credentialDecisionService.showTempMessage('home.rejected-msg', 'error');
    return from(this.router.navigate(['/tabs/credentials']));
  }

  private notifyIssuer(flowResult: FinalizeIssuancePayload, event: string, description: string): void {
    const notificationId = flowResult.credentialResponseWithStatus.credentialResponse.notification_id;
    const notificationEndpoint = flowResult.issuerMetadata.notification_endpoint;
    const accessToken = flowResult.tokenResponse.access_token;

    if (notificationId && notificationEndpoint && accessToken) {
      this.issuerNotificationService.notifyIssuer(
        notificationEndpoint, accessToken, notificationId, event as any, description
      ).pipe(
        catchError((e) => { console.error('Issuer notification failed:', e); return of(null); })
      ).subscribe();
    }
  }

  private verifiablePresentationFlow(qrCode: string): void{
    this.loader.addLoadingProcess();

    // Gate on the load operation: refreshCredentials() completes once the store is
    // 'loaded' or 'error', so we never filter against a half-synced / stale cache.
    this.walletService.refreshCredentials().pipe(
      switchMap(() => {
        // A load FAILURE is not an empty wallet — surface a load error, not "no credentials".
        if (this.credentialCacheService.status() === 'error') {
          return from(this.router.navigate(['/tabs/credentials'])).pipe(
            switchMap(() =>
              this.toastServiceHandler
                .showErrorAlertByTranslateLabel('errors.loading-VCs')
                .pipe(take(1))
            ),
            switchMap(() => EMPTY)
          );
        }

        return from(this.authorizationRequestService.parseAuthorizationRequestFromQr(qrCode)).pipe(
          switchMap((authRequest) => {
            // Filter credentials using DCQL query or scope fallback
            let selectableVcList: VerifiableCredential[];
            if (authRequest.dcqlQuery) {
              selectableVcList = this.credentialCacheService.findCredentialsByDcqlQuery(authRequest.dcqlQuery);
            } else if (authRequest.scope) {
              selectableVcList = this.credentialCacheService.findCredentialsByScope(authRequest.scope);
            } else {
              selectableVcList = this.credentialCacheService.getAll();
            }

            selectableVcList = selectableVcList.filter(c => c.lifeCycleStatus === 'VALID');
            if (selectableVcList.length === 0) {
              // Genuinely empty (store is loaded, no matching credentials).
              return from(this.router.navigate(['/tabs/credentials'])).pipe(
                switchMap(() =>
                  this.toastServiceHandler
                    .showErrorAlertByTranslateLabel('errors.no-credentials-available')
                    .pipe(take(1))
                ),
                switchMap(() => EMPTY)
              );
            }

            const executionResponse = {
              redirectUri: authRequest.responseUri,
              state: authRequest.state,
              nonce: authRequest.nonce,
              clientId: authRequest.clientId,
              dcqlQuery: authRequest.dcqlQuery,
              selectableVcList,
              clientMetadata: authRequest.clientMetadata,
            };

            return from(
              this.router.navigate(['/tabs/vc-selector/'], {
                queryParams: { executionResponse: JSON.stringify(executionResponse) },
              })
            );
          })
        );
      }),

      finalize(() => {
        this.loader.removeLoadingProcess();
      }),

      catchError((error: ExtendedHttpErrorResponse) => {
        this.handleContentExecutionError(error);
        return of(null);
      }),
      takeUntilDestroyed(this.destroyRef)
    )
    .subscribe();
  }


  private handleActivationSuccess(): Observable<boolean> {
    this.loader.addLoadingProcess();

    return this.walletService.refreshCredentials()
      .pipe(
        switchMap(() => from(this.router.navigate(['/tabs/credentials']))),
        tap(() => {
          this.loader.removeLoadingProcess();
        })
      )
  }

  private async checkCredentialStatuses(): Promise<void> {
    const credentials = this.credentialCacheService.snapshot().credentials;

    // Check expiration for VALID credentials
    for (const cred of credentials) {
      if (cred.lifeCycleStatus === 'VALID' && cred.validUntil) {
        const expiry = dayjs(cred.validUntil);
        if (expiry.isValid() && expiry.isBefore(dayjs())) {
          this.credentialCacheService.patchStatus(cred.id, 'EXPIRED');
          this.walletService.updateCredentialStatus(cred.id, 'EXPIRED').subscribe();
        }
      }
    }

    // Check revocation via status list for remaining VALID credentials
    const candidates = this.credentialCacheService.snapshot().credentials
      .filter(c => c.lifeCycleStatus === 'VALID' && c.credentialStatus?.statusListCredential);
    if (candidates.length > 0) {
      const checks = await Promise.allSettled(
        candidates.map(async (cred) => {
          const result = await this.verificationService.isRevoked(cred);
          return { cred, result };
        })
      );

      // 'unknown' (status list unreachable) intentionally leaves the credential's
      // cached status untouched — never treated as a confirmed non-revoked result.
      for (const settled of checks) {
        if (settled.status === 'fulfilled' && settled.value.result === 'revoked') {
          this.revokedCredentialIds.add(settled.value.cred.id);
          this.credentialCacheService.patchStatus(settled.value.cred.id, 'REVOKED');
          this.walletService.updateCredentialStatus(settled.value.cred.id, 'REVOKED').subscribe();
        }
      }
    }
  }

  private requestPendingSignatures(): void {
    const credentials = this.credList();
    if(credentials.length === 0){
      return;
    }
    const pendingCredentials = credentials.filter(
      (credential) => credential.lifeCycleStatus === 'ISSUED'
    );

    if (pendingCredentials.length === 0) {
      return;
    }

    console.log('Requesting signatures for pending credentials...');

    const requests = pendingCredentials.map((credential) =>
      this.walletService.requestSignature(credential.id).pipe(
        catchError((error) => {
          console.error(`Error signing credential ${credential.id}:`, error.message);
          return of({ status: 500 });
        })
      )
    );

    forkJoin(requests).subscribe({
      next: (responses: (HttpResponse<string> | { status: number })[]) => {
        const successfulResponses = responses.filter(response => response.status === 204);

        if (successfulResponses.length > 0) {
          console.log('Signed credentials:', successfulResponses.length);
          this.refreshForDisplay();
        }
      },
      error: (error: HttpErrorResponse) => {
        console.error('Unexpected error in signature requests:', error.message);
        this.toastServiceHandler.showErrorAlert('ErrorUnsigned').subscribe();
      },
    });
  }

  //todo review this (it is storing camera logs, but is used after API calls)
  private handleContentExecutionError(errorResponse: ExtendedHttpErrorResponse | Error): void{
    const httpErr = (errorResponse as ExtendedHttpErrorResponse)?.error;
    const message = httpErr?.message || (errorResponse as ExtendedHttpErrorResponse)?.message || errorResponse?.message || 'No error message';
    const title = httpErr?.title || (errorResponse as ExtendedHttpErrorResponse)?.title || '(No title)';
    const path = httpErr?.path || (errorResponse as ExtendedHttpErrorResponse)?.path || '(No path)';

    const error = title + ' . ' + message + ' . ' + path;
    this.cameraLogsService.addCameraLog(new Error(error), 'httpError');

    console.error(errorResponse);

    const translationKey = errorResponse instanceof InvalidQrError
      ? 'errors.invalid-qr'
      : 'errors.failed-qr-process';
    this.toastServiceHandler
      .showErrorAlertByTranslateLabel(translationKey)
      .pipe(take(1))
      .subscribe();

    setTimeout(()=>{
      this.router.navigate(['/tabs/credentials'])
    }, 1000);
  }

}
