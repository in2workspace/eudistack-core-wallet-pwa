import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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

  ngOnInit(): void {
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const code = params['code'];
        const state = params['state'];

        // Running inside a hidden iframe or popup (cross-origin CORS fallback):
        // relay the code to the parent/opener and let them handle the flow.
        if (code && state) {
          const isInIframe = window.parent !== window;
          const isInPopup = !!window.opener;

          if (isInIframe || isInPopup) {
            const target = isInPopup ? window.opener : window.parent;
            target.postMessage(
              { type: 'oid4vci-auth-code', code, state },
              window.location.origin
            );
            if (isInPopup) window.close();
            return;
          }
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
}