import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Oid4vciFlowStateService } from 'src/app/core/protocol/oid4vci/oid4vci-flow-state.service';

/**
 * Handles the OAuth2 authorization callback from the issuer's /authorize endpoint.
 * Reads the authorization code and state from query params, validates state,
 * and redirects to the credentials page which will resume the flow.
 */
@Component({
    selector: 'app-oid4vci-callback',
    template: `
    <ion-content [fullscreen]="true" class="ion-padding ion-text-center">
      <div style="margin-top: 40vh;">
        <ion-spinner name="crescent"></ion-spinner>
        <p *ngIf="error" style="color: var(--ion-color-danger); margin-top: 16px;">{{ error }}</p>
      </div>
    </ion-content>
  `,
    imports: [IonicModule, CommonModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class Oid4vciCallbackPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly flowStateService = inject(Oid4vciFlowStateService);

  error: string | null = null;

  ngOnInit(): void {
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const code = params['code'];
        const state = params['state'];
        const errorParam = params['error'];

        if (errorParam) {
          this.error = `Authorization failed: ${errorParam}`;
          setTimeout(() => this.router.navigate(['/tabs/home']), 3000);
          return;
        }

        if (!code) {
          this.error = 'Missing authorization code';
          setTimeout(() => this.router.navigate(['/tabs/home']), 3000);
          return;
        }

        // Validate state matches
        const flowState = this.flowStateService.restore();
        if (!flowState) {
          this.error = 'No pending authorization flow found';
          setTimeout(() => this.router.navigate(['/tabs/home']), 3000);
          return;
        }

        if (flowState.state !== state) {
          this.error = 'State mismatch — possible CSRF attack';
          setTimeout(() => this.router.navigate(['/tabs/home']), 3000);
          return;
        }

        // Re-save state with the auth code so the credentials page can resume
        this.flowStateService.save(flowState);

        // Navigate to credentials page with authCode param to resume the flow
        this.router.navigate(['/tabs/credentials'], {
          queryParams: { authCode: code },
        });
      });
  }
}
