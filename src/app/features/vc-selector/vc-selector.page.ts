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
import {ThemeService} from "../../core/services/theme.service";
import { UserPreferencesService } from 'src/app/shared/services/user-preferences.service';

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
  public showConsentScreen = true;
  public clientName = '';
  public clientLogo = '';
  public policyUri = '';
  public tosUri = '';
  public requestedCredentials: string[] = []

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
  private readonly themeService = inject(ThemeService);
  private readonly userPrefs = inject(UserPreferencesService);

  public constructor() {
      this.route.queryParams.pipe(takeUntilDestroyed()).subscribe((params) => {
        this.getExecutionParamsFromQueryParams(params);
        this.formatCredList();
        this.resetIsClickList();
        this.showConsentScreen = true;

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
    const metadata = this.executionResponse?.['clientMEtadata'];
    if (!metadata) {
      console.warn('ClientMetadata not found')
    }
    console.log('Metadata recibida:', metadata);
    const currentLocale = this.translate.currentLang || navigator.language || 'es';
    const branding = this.themeService.snapshot?.branding;

    const isDarkMode = this.userPrefs.darkMode();
    const fallbackLogo = isDarkMode ? branding?.logoUrl : branding?.logoDarkUrl;

    this.clientName = this.getMetadataValue(metadata, 'client_name', currentLocale, branding?.name || '');
    this.clientLogo = this.getMetadataValue(metadata, 'logo_uri', currentLocale, fallbackLogo || '');
    this.policyUri = this.getMetadataValue(metadata, 'policy_uri', currentLocale,  '');
    this.tosUri = this.getMetadataValue(metadata, 'tos_uri', currentLocale, '');
    console.log("clientName:" + this.clientName + ", policyUri: " + this.clientLogo + ", clientLogo: " + this.policyUri + ", tosUri: {}" + this.tosUri);
    console.log("branding.name: " + branding?.name);

    if (this._VCReply.dcqlQuery?.credentials) {
      this.requestedCredentials = this._VCReply.dcqlQuery.credentials.map(c => c.id || c.format);
    }
  }

  private getMetadataValue(metadata: any, field: string, locale: string, fallback: string): string {
    if (!metadata) return fallback;
    const language = locale.split('-')[0];

    return (metadata.localized_claims && metadata.localized_claims[`${field}#${locale}`]) ||
      (metadata.localized_claims && metadata.localized_claims[`${field}#${language}`]) ||
      metadata[`${field}#${locale}`] ||
      metadata[`${field}#${language}`] ||
      metadata[field] ||
      fallback;
  }

  public getDisplayCredentials(): string[] {
    const result: string[] = [];

    const hasEmployee = this.requestedCredentials.some(cred => cred.includes('employee'));
    if (hasEmployee) result.push('LEARCredentialEmployee');

    const hasMachine = this.requestedCredentials.some(cred => cred.toLowerCase().includes('machine'));
    if (hasMachine) result.push('LEARCredentialMachine');

    if (!hasEmployee && !hasMachine) result.push('Credential');

    return result;
  }

  public continueToSelection(): void {
    this.showConsentScreen = false;
  }

  public goBack(): void {
    this.showConsentScreen = true;
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
