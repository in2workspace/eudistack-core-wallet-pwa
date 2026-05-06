import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule } from '@ionic/angular';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { VcViewComponent } from '../../shared/components/vc-view/vc-view.component';
import { VCReply } from 'src/app/core/models/verifiable-credential-reply';
import { VerifiableCredential } from 'src/app/core/models/verifiable-credential';
import { VerifiableCredentialSubjectDataNormalizer } from 'src/app/core/models/verifiable-credential-subject-data-normalizer';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { getExtendedCredentialType, isValidCredentialType } from 'src/app/shared/helpers/get-credential-type.helpers';
import { Oid4vpEngineService } from 'src/app/core/protocol/oid4vp/oid4vp.engine.service';
import { CredentialDecisionService } from 'src/app/core/services/credential-decision.service';
import {UserPreferencesService} from "../../shared/services/user-preferences.service";

// todo: show only VCs with powers to login
// todo: if user has only one VC, use this directly
@Component({
    selector: 'app-vc-selector',
    templateUrl: './vc-selector.page.html',
    styleUrls: ['./vc-selector.page.scss'],
    imports: [
        IonicModule,
        CommonModule,
        FormsModule,
        TranslateModule,
        VcViewComponent,
    ]
})
export class VcSelectorPage {
  public isClick: boolean[] = [];
  public selCredList: VerifiableCredential[] = [];
  public credList: VerifiableCredential[] = [];
  public credDataList: VerifiableCredential[] = [];
  public size = 300;
  public executionResponse: any;
  public requesterDomain = '';
  public userName = '';
  public isAlertOpen = false;
  public errorAlertOpen = false;
  public sendCredentialAlert = false;
  public clientName = '';
  public clientLogo = '';
  public policyUri = '';
  public tosUri = '';
  public clientUri = '';

  public _VCReply: VCReply = {
    selectedVcList: [],
    state: '',
    nonce: '',
    redirectUri: '',
  };

  private readonly alertController = inject(AlertController);
  private readonly loader = inject(LoaderService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastServiceHandler);
  private readonly translate = inject(TranslateService);
  private readonly oid4vpEngineService = inject(Oid4vpEngineService);
  private readonly credentialDecisionService = inject(CredentialDecisionService);
  private readonly userPrefs = inject(UserPreferencesService);

  public constructor() {
      this.route.queryParams.pipe(takeUntilDestroyed()).subscribe((params) => {
        this.getExecutionParamsFromQueryParams(params);
        this.formatCredList();
        this.resetIsClickList();
    });
  }

  public getExecutionParamsFromQueryParams(params: Params){
      console.log('updating params in vc-selector');
      this.executionResponse = JSON.parse(params['executionResponse']);
      this._VCReply.redirectUri = this.executionResponse['redirectUri'];
      this._VCReply.state = this.executionResponse['state'];
      this._VCReply.nonce = this.executionResponse['nonce'];
      this._VCReply.clientId = this.executionResponse['clientId'];
      this._VCReply.dcqlQuery = this.executionResponse['dcqlQuery'];
      this.requesterDomain = this.extractDomain(this.executionResponse['clientId'] || this.executionResponse['redirectUri'] || '');
      this.extractConsentData();
  }

  private extractConsentData(): void {
    const metadata = this.executionResponse['clientMetadata'];
    const currentLocale = this.translate.currentLang || navigator.language || 'es';

    if (!metadata) {
      console.warn('ClientMetadata not found');
    }
    this.clientName = this.getMetadataValue(metadata, 'client_name', currentLocale, this.requesterDomain);
    this.clientUri = this.getMetadataValue(metadata, 'client_uri', currentLocale, this.requesterDomain);
    this.policyUri = this.getMetadataValue(metadata, 'policy_uri', currentLocale, '');
    this.tosUri = this.getMetadataValue(metadata, 'tos_uri', currentLocale, '');
    this.clientLogo = this.getLogoByTheme(metadata, currentLocale);
  }

  private getLogoByTheme(metadata: any, locale: string) {
    const lightLogo = this.getMetadataValue(metadata, 'logo_uri', locale, '');
    const darkLogo = this.getMetadataValue(metadata, 'logo_dark_uri', locale, '');

    const isDarkMode = this.userPrefs.darkMode();
    return (!isDarkMode && darkLogo !== '') ? darkLogo : lightLogo;
  }

  public getMetadataValue(metadata: any, field: string, locale: string, fallback: string): string {
    if (!metadata) return fallback;
    const language = locale.split('-')[0];

    return (metadata.localizedClaims && metadata.localizedClaims[`${field}#${locale}`]) ||
      (metadata.localizedClaims && metadata.localizedClaims[`${field}#${language}`]) ||
      metadata[`${field}#${locale}`] ||
      metadata[`${field}#${language}`] ||
      metadata[field] ||
      fallback;
  }

  public goBack(): void {
    this.router.navigate(['/tabs/credentials']);
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  // Normalize each credential, updating its credentialSubject property
  public formatCredList(){
    this.loader.addLoadingProcess();

    console.log('[VC-selector: Formatting credentials list...');
    const unNormalizedCredList: VerifiableCredential[] = this.executionResponse['selectableVcList'];
    const normalizer = new VerifiableCredentialSubjectDataNormalizer();
    try{
      this.credList = [...unNormalizedCredList]
        .reverse()
        .filter(cred => cred.lifeCycleStatus === 'VALID')
        .map(cred => {
          if (cred.credentialSubject) {
            const credType = getExtendedCredentialType(cred);
            if(isValidCredentialType(credType)){
              cred.credentialSubject = normalizer.normalizeLearCredentialSubject(cred.credentialSubject, credType);
            }
          }
          return cred;
        });
    }catch(err){
      console.error('Error normalizing credential list.');
      console.error(err);
      this.toastService.showErrorAlertByTranslateLabel("errors.loading-VCs");
    }finally{
      this.loader.removeLoadingProcess();
    }
  }

  public resetIsClickList(){
    this.isClick = this.credList.map(() => false);
  }

  public isClicked(index: number) {
    return this.isClick[index];
  }

  public selectCred(cred: VerifiableCredential, index: number) {
    this.selCredList.push(cred);
    this.isClick[index] = !this.isClick[index];
  }

  public async sendCred(cred: VerifiableCredential) {

    const alert = await this.alertController.create({
      header: this.translate.instant('confirmation.header'),
      buttons: [
        {
          text: this.translate.instant('confirmation.cancel'),
          role: 'cancel',
        },
        {
          text: this.translate.instant('confirmation.ok'),
          role: 'ok',
        },
      ],
    });

    await alert.present();
    const result = await alert.onDidDismiss();
    console.log(result);

    if (result.role === 'ok') {
      this.selCredList.push(cred);
      this._VCReply.selectedVcList = this.selCredList;
      this.loader.addLoadingProcess();
      try {
        await this.oid4vpEngineService.buildVerifiablePresentationWithSelectedVCs(this._VCReply);

        this.router.navigate(['/tabs/home']);
        this.showSuccessToast();
      } catch (err) {
        this.handleError(err);
      } finally {
        this.loader.removeLoadingProcess();
        this.selCredList = [];
      }
    }
  }

  private async handleError(err: any) {
    console.error(err);
    this.router.navigate(['/tabs/home']);
    this.selCredList = [];
  }

  private showSuccessToast(): void {
    this.credentialDecisionService.showTempMessage('vc-selector.ok-header', 'success');
  }

}
