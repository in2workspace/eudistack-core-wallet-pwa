import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ViewWillLeave } from '@ionic/angular';
import { StorageService } from 'src/app/services/storage.service';
import { BarcodeScannerComponent } from 'src/app/components/barcode-scanner/barcode-scanner.component';
import { QRCodeModule } from 'angularx-qrcode';
import { WalletService } from 'src/app/services/wallet.service';
import { VcViewComponent } from '../../components/vc-view/vc-view.component';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute, Router } from '@angular/router';
import { WebsocketService } from 'src/app/services/websocket.service';
import { VerifiableCredential } from 'src/app/interfaces/verifiable-credential';
import { VerifiableCredentialSubjectDataNormalizer } from 'src/app/interfaces/verifiable-credential-subject-data-normalizer';
import { CameraLogsService } from 'src/app/services/camera-logs.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { ToastServiceHandler } from 'src/app/services/toast.service';
import { catchError, finalize, forkJoin, from, Observable, of, switchMap, takeUntil, tap } from 'rxjs';
import { ExtendedHttpErrorResponse } from 'src/app/interfaces/errors';
import { LoaderService } from 'src/app/services/loader.service';
import { getExtendedCredentialType, isValidCredentialType } from 'src/app/helpers/get-credential-type.helpers';
import { Oid4vciEngineService } from 'src/app/core/protocol/oid4vci/oid4vci.engine.service';
import { environment } from 'src/environments/environment';
//todo restore tests

// TODO separate scan in another component/ page

@Component({
  selector: 'app-credentials',
  templateUrl: './credentials.page.html',
  styleUrls: ['./credentials.page.scss'],
  standalone: true,
  providers: [StorageService],
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    QRCodeModule,
    VcViewComponent,
    TranslateModule,
    BarcodeScannerComponent
  ]
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class CredentialsPage implements OnInit, ViewWillLeave {
  public credList: Array<VerifiableCredential> = [];
  public showScannerView = false;
  public showScanner = false;
  public isFirstCredentialLoadCompleted = false;
  public credentialOfferUri = '';


  private readonly cameraLogsService = inject(CameraLogsService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly loader = inject(LoaderService);
  private readonly oid4vciEngineService = inject(Oid4vciEngineService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastServiceHandler = inject(ToastServiceHandler);
  private readonly walletService = inject(WalletService);
  private readonly websocket = inject(WebsocketService);

  public constructor(){
    //todo move to ngOnInit to avoid using credentialOfferUri
    this.route.queryParams
      .pipe(takeUntilDestroyed())
      .subscribe((params) => {
        this.showScannerView = params['showScannerView'] === 'true';
        this.showScanner = params['showScanner']     === 'true';
        this.credentialOfferUri = params['credentialOfferUri'];
        this.cdr.detectChanges();
      });
  }

  public ngOnInit(): void {
    this.loadCredentials()
    .pipe(finalize(() => this.isFirstCredentialLoadCompleted = true))
    .subscribe();

    if (this.credentialOfferUri) {
      this.sameDeviceVcActivationFlow(this.credentialOfferUri);
    }
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
      switchMap(() => this.loadCredentials()),
      finalize(() => this.loader.removeLoadingProcess())
    )
    .subscribe(() => {
      this.loader.removeLoadingProcess();
    });
  }

  public qrCodeEmit(qrCode: string): void {
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
    const socketsToConnect: Promise<void>[] = [
      this.websocket.connectNotificationSocket(),
    ];

    from(Promise.all(socketsToConnect))
      .pipe(
        switchMap(() => {
          if(environment.browser_signature_enabled){
            console.log("Browser signature enabled. Starting OID4VCI flow with browser signature.");
            return this.oid4vciEngineService.executeOid4vciFlow(credentialOfferUri)
        }else{
          console.log("Browser signature disabled. Starting OID4VCI flow without browser signature.");
          return this.walletService.requestOpenidCredentialOffer(credentialOfferUri)
        }}),

        switchMap(() => this.handleActivationSuccess()),

        catchError((err: ExtendedHttpErrorResponse) => {
          console.error(err);
          this.websocket.closeNotificationConnection();
          this.handleContentExecutionError(err); //todo review (adding camera log?)
          return of(null);
        })
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  private verifiablePresentationFlow(qrCode: string): void{
    this.loader.addLoadingProcess();

    this.walletService.executeContent(qrCode).pipe(
      switchMap((executionResponse) => {
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
      })
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
        // todo avoid this
        this.cdr.detectChanges();
        if(!isScannerOpen){
          this.loader.removeLoadingProcess();
        }
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
          this.forcePageReload();
        }
      },
      error: (error: HttpErrorResponse) => {
        console.error('Unexpected error in signature requests:', error.message);
        this.toastServiceHandler.showErrorAlert('ErrorUnsigned').subscribe();
      },
    });
  }

  private forcePageReload(): void {
    this.router.navigate(['/tabs/credentials']).then(() => {
      window.location.reload();
    });
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