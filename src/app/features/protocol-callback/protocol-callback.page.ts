import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, from, of, switchMap, tap, take } from 'rxjs';
import { Oid4vciEngineService } from 'src/app/core/protocol/oid4vci/oid4vci.engine.service';
import { WalletService } from 'src/app/core/services/wallet.service';
import { CredentialPreviewBuilderService } from 'src/app/core/services/credential-preview-builder.service';
import { CredentialDecisionService } from 'src/app/core/services/credential-decision.service';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { IssuerNotificationService, NOTIFICATION_EVENT } from 'src/app/core/services/issuer-notification.service';
import { IssuerMetadataCacheService } from 'src/app/core/services/issuer-metadata-cache.service';
import { ActivityService } from 'src/app/core/services/activity.service';
import { FinalizeIssuancePayload } from 'src/app/core/models/FinalizeIssuancePayload';

@Component({
    selector: 'app-protocol-callback',
    template: `
    <ion-content [fullscreen]="true" class="ion-padding ion-text-center">
      <div style="margin-top: 40vh;">
        <ion-spinner name="crescent"></ion-spinner>
      </div>
    </ion-content>
  `,
    imports: [IonicModule, CommonModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class ProtocolCallbackPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly oid4vciEngineService = inject(Oid4vciEngineService);
  private readonly walletService = inject(WalletService);
  private readonly credentialPreviewBuilder = inject(CredentialPreviewBuilderService);
  private readonly credentialDecisionService = inject(CredentialDecisionService);
  private readonly toastServiceHandler = inject(ToastServiceHandler);
  private readonly issuerNotificationService = inject(IssuerNotificationService);
  private readonly issuerMetadataCache = inject(IssuerMetadataCacheService);
  private readonly activityService = inject(ActivityService);

  ngOnInit(): void {
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const code = params['code'];
        const state = params['state'];

        if (code && state) {
          this.handleAuthCodeCallback(code, state);
          return;
        }

        const credentialOfferUri = params['credential_offer_uri'];
        if (credentialOfferUri) {
          this.router.navigate(['/tabs/credentials'], {
            queryParams: { credentialOfferUri },
          });
          return;
        }

        const authorizationRequest = params['authorization_request'];
        if (authorizationRequest) {
          this.router.navigate(['/tabs/credentials'], {
            queryParams: { authorizationRequest },
          });
          return;
        }

        this.router.navigate(['/tabs/home']);
      });
  }

  private handleAuthCodeCallback(code: string, state: string): void {
    from(this.oid4vciEngineService.resumeAuthCodeFlow(code, state))
      .pipe(
        switchMap((flowResult: FinalizeIssuancePayload) => {
          if (flowResult.credentialResponseWithStatus.statusCode === 202) {
            return this.walletService.finalizeCredentialIssuance(flowResult)
              .pipe(switchMap(() => from(this.router.navigate(['/tabs/credentials']))));
          }

          const configId = flowResult.credentialConfigurationId;
          const config = flowResult.issuerMetadata.credential_configurations_supported?.[configId];
          const credentialMetadata = config?.credential_metadata;

          const preview = this.credentialPreviewBuilder.buildPreview(
            flowResult.credentialResponseWithStatus.credentialResponse,
            credentialMetadata,
            flowResult.format
          );

          return from(this.credentialDecisionService.showDecisionDialog(preview)).pipe(
            switchMap(decision => {
              if (decision === 'ACCEPTED') {
                return this.walletService.finalizeCredentialIssuance(flowResult).pipe(
                  tap(() => this.notifyIssuer(flowResult, NOTIFICATION_EVENT.CREDENTIAL_ACCEPTED, 'Credential accepted by user')),
                  tap(() => this.credentialDecisionService.showTempMessage('home.ok-msg')),
                  tap(() => this.registerIssuerMetadata(flowResult)),
                  tap(() => this.logActivity(flowResult)),
                  switchMap(() => from(this.router.navigate(['/tabs/credentials'])))
                );
              }
              const event = decision === 'REJECTED'
                ? NOTIFICATION_EVENT.CREDENTIAL_DELETED
                : NOTIFICATION_EVENT.CREDENTIAL_FAILURE;
              const description = decision === 'REJECTED'
                ? 'User rejected credential'
                : 'Timeout waiting for user decision';
              this.notifyIssuer(flowResult, event, description);
              this.credentialDecisionService.showTempMessage('home.rejected-msg', 'error');
              return from(this.router.navigate(['/tabs/credentials']));
            })
          );
        }),
        catchError(err => {
          console.error('Auth code callback error:', err);
          setTimeout(() => this.router.navigate(['/tabs/home']), 500);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private notifyIssuer(flowResult: FinalizeIssuancePayload, event: string, description: string): void {
    const notificationId = flowResult.credentialResponseWithStatus.credentialResponse.notification_id;
    const notificationEndpoint = flowResult.issuerMetadata.notification_endpoint;
    const accessToken = flowResult.tokenResponse.access_token;
    if (notificationId && notificationEndpoint && accessToken) {
      this.issuerNotificationService.notifyIssuer(
        notificationEndpoint, accessToken, notificationId, event as any, description
      ).pipe(
        catchError(e => { console.error('Issuer notification failed:', e); return of(null); }),
        take(1)
      ).subscribe();
    }
  }

  private registerIssuerMetadata(flowResult: FinalizeIssuancePayload): void {
    const issuerUrl = flowResult.issuerMetadata.credentialIssuer;
    const configId = flowResult.credentialConfigurationId;
    if (!issuerUrl || !configId) return;
    this.issuerMetadataCache.registerIssuance(
      `pending-${Date.now()}`, issuerUrl, configId, flowResult.issuerMetadata
    ).catch(console.warn);
  }

  private logActivity(flowResult: FinalizeIssuancePayload): void {
    const configId = flowResult.credentialConfigurationId;
    const config = flowResult.issuerMetadata.credential_configurations_supported?.[configId];
    const credName = config?.credential_metadata?.display?.[0]?.name ?? configId ?? 'Unknown';
    const issuer = flowResult.issuerMetadata.credentialIssuer ?? '';
    this.activityService.log('issued', credName, issuer);
  }
}