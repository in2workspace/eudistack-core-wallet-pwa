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
