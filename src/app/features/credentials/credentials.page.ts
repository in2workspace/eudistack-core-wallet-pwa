import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ViewWillLeave } from '@ionic/angular';
import { StorageService } from 'src/app/shared/services/storage.service';
import { BarcodeScannerComponent } from 'src/app/shared/components/barcode-scanner/barcode-scanner.component';
import { QRCodeComponent } from 'angularx-qrcode';
import { WalletService } from 'src/app/core/services/wallet.service';
import { VcViewComponent } from '../../shared/components/vc-view/vc-view.component';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute, Router } from '@angular/router';
import { VerifiableCredential } from 'src/app/core/models/verifiable-credential';
import { VerifiableCredentialSubjectDataNormalizer } from 'src/app/core/models/verifiable-credential-subject-data-normalizer';
import { CameraLogsService } from 'src/app/shared/services/camera-logs.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { catchError, finalize, forkJoin, from, Observable, of, switchMap, tap } from 'rxjs';
import { ExtendedHttpErrorResponse } from 'src/app/core/models/errors';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { getExtendedCredentialType, isValidCredentialType } from 'src/app/shared/helpers/get-credential-type.helpers';
import { Oid4vciEngineService } from 'src/app/core/protocol/oid4vci/oid4vci.engine.service';
import { AuthorizationRequestService } from 'src/app/core/protocol/oid4vp/authorization-request.service';
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
import { CredentialVerificationService } from 'src/app/core/services/credential-verification.service';
import * as dayjs from 'dayjs';
//todo restore tests

// TODO separate scan in another component/ page

@Component({
    selector: 'app-credentials',
    templateUrl: './credentials.page.html',
    styleUrls: ['./credentials.page.scss'],
    providers: [StorageService],
    imports: [
        IonicModule,
        CommonModule,
        FormsModule,
        QRCodeComponent,
        VcViewComponent,
        TranslateModule,
        BarcodeScannerComponent,
        SkeletonComponent
    ]
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class CredentialsPage implements OnInit, ViewWillLeave {
  public credList: Array<VerifiableCredential> = [];
  public showScannerView = false;
  public showScanner = false;
  public isFirstCredentialLoadCompleted = false;
  public credentialOfferUri = '';
  public manualQrValue = '';
  readonly prefs = inject(UserPreferencesService);

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

  private authorizationRequest = '';
  private revokedCredentialIds = new Set<string>();

  public constructor(){
    //todo move to ngOnInit to avoid using credentialOfferUri
    this.route.queryParams
      .pipe(takeUntilDestroyed())
      .subscribe((params) => {
        this.showScannerView = params['showScannerView'] === 'true';
        this.showScanner = params['showScanner']     === 'true';
        this.credentialOfferUri = params['credentialOfferUri'];
        this.authorizationRequest = params['authorizationRequest'] ?? '';
        this.cdr.detectChanges();
      });
  }

  public ngOnInit(): void {
    this.loadCredentials()
    .pipe(
      finalize(() => this.isFirstCredentialLoadCompleted = true),
      takeUntilDestroyed(this.destroyRef)
    )
    .subscribe(() => {
      // Protocol flows run after credentials are loaded so the cache is populated
      if (this.credentialOfferUri) {
        this.sameDeviceVcActivationFlow(this.credentialOfferUri);
      } else if (this.authorizationRequest) {
        console.info('Processing authorization request via same-device flow.');
        this.verifiablePresentationFlow(this.authorizationRequest);
      }
    });
  }

  public ionViewDidEnter(): void {
    this.requestPendingSignatures();
  }

  //this is needed to ensure the scanner is destroyed when leaving page. Ionic
  //caches the component (it isn't destroyed when leaving route), so ngOnDestroy won't work
  //here we don't use the navigation to update he view to avoid circularity
  public ionViewWillLeave(): void{
    this.showScannerView = false;
    this.showScanner = false;
    this.cdr.detectChanges();
  }

  public openScannerViewWithoutScanner(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        showScannerView: true
      },
      queryParamsHandling: 'merge'
    });
  }

  public closeScannerViewAndScanner(): void{
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        showScannerView: false,
        showScanner: false
      },
      queryParamsHandling: 'merge'
    });
  }

  public closeScanner(): void{
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        showScanner: false
      },
      queryParamsHandling: 'merge'
    });
  }

  public vcDelete(cred: VerifiableCredential): void {
    this.loader.addLoadingProcess();
    this.walletService.deleteVC(cred.id)
    .pipe(
      tap(() => {
        const credName = cred.name ?? cred.type?.[0] ?? 'Unknown';
        const issuer = cred.issuer?.organization ?? cred.issuer?.id ?? '';
        this.activityService.log('deleted', credName, issuer);
      }),
      switchMap(() => this.loadCredentials()),
      finalize(() => this.loader.removeLoadingProcess())
    )
    .subscribe(() => {
      this.loader.removeLoadingProcess();
    });
  }

  public submitManualQr(): void {
    const value = this.manualQrValue?.trim();
    if (value) {
      this.manualQrValue = '';
      this.qrCodeEmit(value);
    }
  }

  public handleRefresh(event: any): void {
    this.loadCredentials()
      .pipe(
        finalize(() => event.target.complete()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  public qrCodeEmit(qrCode: string): void {
    this.hapticService.notification();
    const isCredentialOffer = qrCode.includes('credential_offer_uri');
    //todo don't accept qrs that are not to login or get VC
    if(isCredentialOffer){
      //CROSS-DEVICE VC OFFER
      //show VCs list
      this.closeScannerViewAndScanner();
      console.info('Requesting Credential Offer via cross-device flow.');
      this.credentialActivationFlow(qrCode);
    }else{
      // VERIFIABLE PRESENTATION
      // hide scanner but don't show VCs list
      this.closeScanner();
      console.info('Processing QR code for verifiable presentation.');
      this.verifiablePresentationFlow(qrCode);
      }
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

    // Registration is fire-and-forget; credential ID will be mapped when loadCredentials() runs
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

    from(this.authorizationRequestService.parseAuthorizationRequestFromQr(qrCode)).pipe(
      switchMap((authRequest) => {
        // Filter credentials using DCQL query or scope fallback
        let selectableVcList: VerifiableCredential[];
        if (authRequest.dcqlQuery) {
          selectableVcList = this.credentialCacheService.findCredentialsByDcqlQuery(authRequest.dcqlQuery);
        } else if (authRequest.scope) {
          selectableVcList = this.credentialCacheService.findCredentialsByScope(authRequest.scope);
        } else {
          selectableVcList = this.credentialCacheService.getAll().filter(c => c.lifeCycleStatus === 'VALID');
        }

        const executionResponse = {
          redirectUri: authRequest.responseUri,
          state: authRequest.state,
          nonce: authRequest.nonce,
          clientId: authRequest.clientId,
          dcqlQuery: authRequest.dcqlQuery,
          selectableVcList,
        };

        return from(
          this.router.navigate(['/tabs/vc-selector/'], {
            queryParams: { executionResponse: JSON.stringify(executionResponse) },
          })
        );
      }),

      finalize(() => {
        console.log("Finished processing QR code. Hiding loader.");
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
    console.log("Handling successful credential activation...");
    this.loader.addLoadingProcess();

    return this.loadCredentials()
      .pipe(
        switchMap(() => from(this.router.navigate(['/tabs/credentials']))),
        tap(() => {
          this.loader.removeLoadingProcess();
        })
      )
  }

  
  private loadCredentials(): Observable<VerifiableCredential[]> {
    // todo this conditional should be removed when scanner is moved to another page
    const isScannerOpen = this.isScannerOpen();
    if(!isScannerOpen){
      this.loader.addLoadingProcess();
    }

    const normalizer = new VerifiableCredentialSubjectDataNormalizer();

    return this.walletService.getAllVCs().pipe(
      takeUntilDestroyed(this.destroyRef),
      tap((credentialListResponse: VerifiableCredential[]) => {
        // Sync credential cache for OID4VP credential filtering
        this.credentialCacheService.syncFromBackend(credentialListResponse);

        // Iterate over the list and normalize each credentialSubject
        this.credList = credentialListResponse.slice().reverse().map(cred => {
          if (cred.credentialSubject && cred.type) {
            const credType = getExtendedCredentialType(cred);
            if(isValidCredentialType(credType)){
              cred.credentialSubject = normalizer.normalizeLearCredentialSubject(cred.credentialSubject, credType);
            }
          }
          return cred;

        });
        // Apply cached revocation status immediately so UI stays consistent
        for (const cred of this.credList) {
          if (this.revokedCredentialIds.has(cred.id)) {
            cred.lifeCycleStatus = 'REVOKED';
          }
        }
        // todo avoid this
        this.cdr.detectChanges();
        if(!isScannerOpen){
          this.loader.removeLoadingProcess();
        }
        this.checkCredentialStatuses();
      }),
      catchError((error: ExtendedHttpErrorResponse) => {
        if (error.status === 404) {
          this.credList = [];
          this.cdr.detectChanges();
        } else {
          console.error("Error fetching credentials:", error);
        }
        if(!isScannerOpen){
          this.loader.removeLoadingProcess();
        }
        return of([]);
      })
    )

  }

  private async checkCredentialStatuses(): Promise<void> {
    let changed = false;

    // Check expiration for VALID credentials
    for (const cred of this.credList) {
      if (cred.lifeCycleStatus === 'VALID' && cred.validUntil) {
        const expiry = dayjs(cred.validUntil);
        if (expiry.isValid() && expiry.isBefore(dayjs())) {
          cred.lifeCycleStatus = 'EXPIRED';
          this.walletService.updateCredentialStatus(cred.id, 'EXPIRED').subscribe();
          changed = true;
        }
      }
    }

    // Check revocation via status list for remaining VALID credentials
    const candidates = this.credList.filter(c => c.lifeCycleStatus === 'VALID' && c.credentialStatus?.statusListCredential);
    if (candidates.length > 0) {
      const checks = await Promise.allSettled(
        candidates.map(async (cred) => {
          const revoked = await this.verificationService.isRevoked(cred);
          return { cred, revoked };
        })
      );

      for (const result of checks) {
        if (result.status === 'fulfilled' && result.value.revoked) {
          result.value.cred.lifeCycleStatus = 'REVOKED';
          this.revokedCredentialIds.add(result.value.cred.id);
          this.walletService.updateCredentialStatus(result.value.cred.id, 'REVOKED').subscribe();
          changed = true;
        }
      }
    }

    if (changed) {
      this.cdr.detectChanges();
    }
  }

  private requestPendingSignatures(): void {
    if(this.credList.length === 0){
      return;
    }
    const pendingCredentials = this.credList.filter(
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
          this.reloadCredentials();
        }
      },
      error: (error: HttpErrorResponse) => {
        console.error('Unexpected error in signature requests:', error.message);
        this.toastServiceHandler.showErrorAlert('ErrorUnsigned').subscribe();
      },
    });
  }

  private reloadCredentials(): void {
    this.loadCredentials()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  //todo review this (it is storing camera logs, but is used after API calls)
  private handleContentExecutionError(errorResponse: ExtendedHttpErrorResponse): void{
    const httpErr = errorResponse?.error;
    const message = httpErr?.message || errorResponse?.message || 'No error message';
    const title = httpErr?.title || errorResponse?.title || '(No title)';
    const path = httpErr?.path || errorResponse?.path || '(No path)';

    const error = title + ' . ' + message + ' . ' + path;
    this.cameraLogsService.addCameraLog(new Error(error), 'httpError');

    console.error(errorResponse);
    setTimeout(()=>{
      this.router.navigate(['/tabs/home'])
    }, 1000);
  }

  private isScannerOpen(): boolean{
    return this.showScanner === true && this.showScannerView === true;
  }

}