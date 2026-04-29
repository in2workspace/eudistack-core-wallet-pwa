import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, ActivatedRoute } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { VcSelectorPage } from './vc-selector.page';
import { VerifiableCredential, CredentialStatus, Issuer, CredentialSubject, Mandate, Mandatee, Mandator, Power, LifeCycleStatus } from 'src/app/core/models/verifiable-credential';
import { Oid4vpEngineService } from 'src/app/core/protocol/oid4vp/oid4vp.engine.service';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { CredentialDecisionService } from 'src/app/core/services/credential-decision.service';
import {ThemeService} from "../../core/services/theme.service";
import {UserPreferencesService} from "../../shared/services/user-preferences.service";

describe('VcSelectorPage', () => {
  let component: VcSelectorPage;
  let fixture: ComponentFixture<VcSelectorPage>;
  let mockRouter: jest.Mocked<Router>;
  let mockActivatedRoute: any;
  let mockTranslateService: jest.Mocked<TranslateService>;
  let mockAlertController: jest.Mocked<AlertController>;
  let mockAlert: any;

  const mockMandatee: Mandatee = {
    id: 'mandatee1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    employeeId: '',
    domain: '',
    ipAddress: ''
  };

  const mockMandator: Mandator = {
    organization: 'Test Organization',
    commonName: 'Test Org',
    serialNumber: 'SN123',
    country: 'ES',
    organizationIdentifier: ''
  };

  const mockPower: Power = {
    id: 'power1',
    action: 'sign',
    domain: 'financial',
    function: 'representative',
    type: 'legal'
  };

  const mockMandate: Mandate = {
    id: 'mandate1',
    mandatee: mockMandatee,
    mandator: mockMandator,
    power: [mockPower]
  };

  const mockCredentialSubject: CredentialSubject = {
    mandate: mockMandate
  };

  const mockIssuer: Issuer = {
    id: 'issuer1'
  };

  const mockExecutionResponse = {
    selectableVcList: [
      {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        id: 'vc1',
        type: ['VerifiableCredential', 'learcredential.employee.w3c.4'],
        issuer: mockIssuer,
        issuanceDate: '2024-01-01T00:00:00Z',
        validFrom: '2024-01-01T00:00:00Z',
        expirationDate: '2025-01-01T00:00:00Z',
        validUntil: '2025-01-01T00:00:00Z',
        credentialSubject: mockCredentialSubject,
        available_formats: ['jwt'],
        lifeCycleStatus: "VALID"
      },
      {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        id: 'vc2',
        type: ['VerifiableCredential', 'learcredential.employee.w3c.4'],
        issuer: mockIssuer,
        validFrom: '2024-02-01T00:00:00Z',
        validUntil: '2025-02-01T00:00:00Z',
        credentialSubject: {
          mandate: {
            id: 'mandate2',
            mandatee: {
              id: 'mandatee2',
              firstName: 'Jane',
              lastName: 'Smith',
              email: 'jane.smith@example.com',
            },
            mandator: mockMandator,
            power: [mockPower]
          }
        },
        lifeCycleStatus: "ISSUED"
      }
    ] as VerifiableCredential[],
    redirectUri: 'http://example.com/callback',
    state: 'test-state',
    nonce: 'test-nonce',
    clientId: 'https://tenant.domain.com',
    dcqlQuery: {
      credentials: [
        { id: 'learcredential.employee.w3c.4' }
      ]
    },
    clientMetadata: {
      client_name: 'Client Name',
      logo_uri: 'https://tenant.com/logo.png',
      policy_uri: 'https://tenant.com/policy',
      tos_uri: 'https://tenant.com/tos'
    }
  };

  const mockQueryParams = {
    executionResponse: JSON.stringify(mockExecutionResponse)
  };

    let mockOid4vpEngineService: jest.Mocked<Oid4vpEngineService>;
  let mockLoader: jest.Mocked<LoaderService>;
  let mockToast: jest.Mocked<ToastServiceHandler>;
  let mockCredentialDecisionService: { showTempMessage: jest.Mock };
  let mockThemeService: any;
  let mockUserPrefs: any;

  beforeEach(async () => {
    // Create mocks with Jest
    mockRouter = {
      navigate: jest.fn()
    } as any;

    mockTranslateService = {
      instant: jest.fn(),
      currentLang: 'es'
    } as any;

    mockAlert = {
      present: jest.fn(),
      onDidDismiss: jest.fn(),
      dismiss: jest.fn()
    };

    mockAlertController = {
      create: jest.fn()
    } as any;

    // Mock ActivatedRoute
    mockActivatedRoute = {
      queryParams: of(mockQueryParams)
    };

      mockOid4vpEngineService = {
      buildVerifiablePresentationWithSelectedVCs: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockLoader = {
      addLoadingProcess: jest.fn(),
      removeLoadingProcess: jest.fn(),
    } as any;

    mockToast = {
      showErrorAlertByTranslateLabel: jest.fn(),
    } as any;

    mockCredentialDecisionService = {
      showTempMessage: jest.fn(),
    };

    // Setup default return values
    mockAlert.onDidDismiss.mockResolvedValue({ role: 'ok' });
    mockAlertController.create.mockResolvedValue(mockAlert);

    mockThemeService = {
      snapshot: {
        branding: {
          name: 'BRAND',
          logoUrl: 'logo.png',
          logoDarkUrl: 'logo-dark.png'
        }
      }
    };

    mockUserPrefs = {
      darkMode: jest.fn().mockReturnValue(false)
    };

    await TestBed.configureTestingModule({
      imports: [VcSelectorPage],
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: AlertController, useValue: mockAlertController },
        { provide: Oid4vpEngineService, useValue: mockOid4vpEngineService },
        { provide: CredentialDecisionService, useValue: mockCredentialDecisionService },
        { provide: LoaderService, useValue: mockLoader },
        { provide: ToastServiceHandler, useValue: mockToast },
        { provide: ThemeService, useValue: mockThemeService },
        { provide: UserPreferencesService, useValue: mockUserPrefs }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(VcSelectorPage);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Constructor and initialization', () => {
    it('should process query params on initialization', () => {
      const getExecutionParamsSpy = jest.spyOn(VcSelectorPage.prototype as any, 'getExecutionParamsFromQueryParams');
      const formatCredListSpy = jest.spyOn(VcSelectorPage.prototype as any, 'formatCredList');
      const resetIsClickListSpy = jest.spyOn(VcSelectorPage.prototype as any, 'resetIsClickList');

      // Ara creem el component (després dels espies)
      fixture = TestBed.createComponent(VcSelectorPage);
      component = fixture.componentInstance;

      expect(getExecutionParamsSpy).toHaveBeenCalledWith(mockQueryParams);
      expect(formatCredListSpy).toHaveBeenCalled();
      expect(resetIsClickListSpy).toHaveBeenCalled();
      expect(component.showConsentScreen).toBe(true);
    });
  });

  describe('getExecutionParamsFromQueryParams', () => {
    it('should parse execution response and set VCReply properties', () => {
      component.getExecutionParamsFromQueryParams(mockQueryParams);

      expect(component.executionResponse).toEqual(mockExecutionResponse);
      expect(component._VCReply.redirectUri).toBe('http://example.com/callback');
      expect(component._VCReply.state).toBe('test-state');
      expect(component._VCReply.nonce).toBe('test-nonce');
      expect(component.requesterDomain).toBe('tenant.domain.com');
      expect(component.clientName).toBe('Client Name');
      expect(component.requestedCredentials).toContain('learcredential.employee.w3c.4');
    });
  });

  describe('Consent Screen funcionality', () => {
    it('should hide consent screen when continuing to selection', () => {
      component.showConsentScreen = true;
      component.continueToSelection();
      expect(component.showConsentScreen).toBe(false);
    });

    it('should resent consent screen and navigate back to credentials goBack', () => {
      component.showConsentScreen = false;
      component.goBack();
      expect(component.showConsentScreen).toBe(true);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/tabs/credentials']);
    });

    it('should correctly map request credentials to display names', () => {
      component.requestedCredentials = ['learcredential.employee.test'];
      expect(component.getDisplayCredentials()).toEqual(['LEARCredentialEmployee']);

      component.requestedCredentials = ['some.machine.credential'];
      expect(component.getDisplayCredentials()).toEqual(['LEARCredentialMachine']);

      component.requestedCredentials = ['employee', 'machine'];
      expect(component.getDisplayCredentials()).toEqual(['LEARCredentialEmployee', 'LEARCredentialMachine']);
    });
  });

  describe('extractConsentData Fallbacks', () => {
    it('should use tenant branding data when clientMetadata is missing', () => {
      const responseNoMetadata = {
        ...mockExecutionResponse,
        clientMetadata: null
      };
      component.getExecutionParamsFromQueryParams({
        executionResponse: JSON.stringify(responseNoMetadata)
      });
      expect(component.clientName).toBe('BRAND');
      expect(component.clientLogo).toBe('logo-dark.png');
      expect(component.policyUri).toBe('');
      expect(component.tosUri).toBe('');
    });

    it('should use localized_claims if available in metadata', () => {
      const responseWithLocales = {
        ...mockExecutionResponse,
        clientMetadata: {
          localized_claims: {
            'client_name#es': 'Nombre en Español',
            'client_name#en': 'English Name'
          }
        }
      };
      mockTranslateService.currentLang = 'es';
      component.getExecutionParamsFromQueryParams({
        executionResponse: JSON.stringify(responseWithLocales)
      });
      expect(component.clientName).toBe('Nombre en Español');
    });
  });

  describe('formatCredList', () => {
    it('should process credentials with proper mandate structure', () => {
      component.executionResponse = mockExecutionResponse;
      component.formatCredList();

      expect(component.credList).toHaveLength(1);
      expect(component.credList[0].id).toBe('vc1');

      // Verify mandate structure is preserved
      const credSubject = component.credList[0].credentialSubject as { mandate: Mandate };
      expect(credSubject.mandate.mandatee.firstName).toBe('John');
      expect(credSubject.mandate.mandator.organization).toBe('Test Organization');
      expect(credSubject.mandate.power[0].action).toBe('sign');
    });

    it('should exclude non-VALID credentials', () => {
      component.executionResponse = mockExecutionResponse;
      component.formatCredList();
      const ids = component.credList.map(c => c.id);
      expect(ids).toEqual(['vc1']);
    });

    it('should handle credentials without credentialSubject', () => {
      const executionResponseWithoutSubject = {
        selectableVcList: [
          {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            id: 'vc1',
            type: ['VerifiableCredential', 'learcredential.employee.w3c.4'],
            issuer: mockIssuer,
            validFrom: '2024-01-01T00:00:00Z',
            validUntil: '2025-01-01T00:00:00Z',
            lifeCycleStatus: "VALID"
          } as VerifiableCredential
        ]
      };
      component.executionResponse = executionResponseWithoutSubject;

      expect(() => component.formatCredList()).not.toThrow();
      expect(component.credList).toHaveLength(1);
    });
  });

  describe('resetIsClickList', () => {
    it('should initialize isClick array with false values', () => {
      component.credList = [
        {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          id: 'vc1',
          issuer: mockIssuer,
          issuanceDate: '2024-01-01T00:00:00Z',
          validFrom: '2024-01-01T00:00:00Z',
          expirationDate: '2025-01-01T00:00:00Z',
          validUntil: '2025-01-01T00:00:00Z',
          credentialSubject: mockCredentialSubject,
          lifeCycleStatus: "VALID",
          credentialStatus: {} as CredentialStatus,
        } as VerifiableCredential,
        {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          id: 'vc2',
          issuer: mockIssuer,
          issuanceDate: '2024-01-01T00:00:00Z',
          validFrom: '2024-01-01T00:00:00Z',
          expirationDate: '2025-01-01T00:00:00Z',
          validUntil: '2025-01-01T00:00:00Z',
          credentialSubject: mockCredentialSubject,
          lifeCycleStatus: "VALID",
          credentialStatus: {} as CredentialStatus,
        } as VerifiableCredential
      ];
      component.resetIsClickList();

      expect(component.isClick).toEqual([false, false]);
    });
  });

  describe('isClicked', () => {
    it('should return the correct click state for given index', () => {
      component.isClick = [true, false, true];

      expect(component.isClicked(0)).toBe(true);
      expect(component.isClicked(1)).toBe(false);
      expect(component.isClicked(2)).toBe(true);
    });
  });

  describe('selectCred', () => {
    it('should add credential to selected list and toggle click state', () => {
      const mockCred = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        id: 'vc1',
        issuer: mockIssuer,
        issuanceDate: '2024-01-01T00:00:00Z',
        validFrom: '2024-01-01T00:00:00Z',
        expirationDate: '2025-01-01T00:00:00Z',
        validUntil: '2025-01-01T00:00:00Z',
        credentialSubject: mockCredentialSubject,
        lifeCycleStatus: "VALID",
        credentialStatus: {} as CredentialStatus,
      } as VerifiableCredential;
      component.isClick = [false, false];

      component.selectCred(mockCred, 0);

      expect(component.selCredList).toContain(mockCred);
      expect(component.isClick[0]).toBe(true);
    });
  });

  describe('sendCred', () => {
    let mockCred: VerifiableCredential;

    beforeEach(() => {
      mockCred = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        id: 'vc1',
        issuer: mockIssuer,
        issuanceDate: '2024-01-01T00:00:00Z',
        validFrom: '2024-01-01T00:00:00Z',
        expirationDate: '2025-01-01T00:00:00Z',
        validUntil: '2025-01-01T00:00:00Z',
        credentialSubject: mockCredentialSubject,
        lifeCycleStatus: "VALID",
        credentialStatus: {} as CredentialStatus,
      } as VerifiableCredential;
    });

    //todo complete tests
    // it('should show confirmation alert', async () => {
    //   await component.sendCred(mockCred);

    //   expect(mockAlertController.create).toHaveBeenCalledWith({
    //     header: 'Translated text',
    //     buttons: [
    //       {
    //         text: 'Translated text',
    //         role: 'cancel',
    //       },
    //       {
    //         text: 'Translated text',
    //         role: 'ok',
    //       },
    //     ],
    //   });
    //   expect(mockAlert.present).toHaveBeenCalled();
    // });

    // it('should handle service error and show error message', async () => {
    //   const errorResponse = { status: 500 };
    //   mockWalletService.executeVC.mockReturnValue(throwError(() => errorResponse));
    //   const errorMessageSpy = jest.spyOn(component, 'errorMessage').mockImplementation();

    //   await component.sendCred(mockCred);

    //   expect(errorMessageSpy).toHaveBeenCalledWith(500);
    //   expect(mockRouter.navigate).toHaveBeenCalledWith(['/tabs/home']);
    //   expect(component.selCredList).toEqual([]);
    // });

    it('should clear selected credentials on completion', async () => {
      await component.sendCred(mockCred);

      expect(component.selCredList).toEqual([]);
    });
  });

  // describe('errorMessage', () => {
  //   it('should show server error message for 5xx status codes', async () => {
  //     await component.errorMessage(500);

  //     expect(mockTranslateService.instant).toHaveBeenCalledWith('vc-selector.server-error-message');
  //     expect(mockAlertController.create).toHaveBeenCalled();
  //   });

  //   it('should show unauthorized message for 401 status code', async () => {
  //     await component.errorMessage(401);

  //     expect(mockTranslateService.instant).toHaveBeenCalledWith('vc-selector.unauthorized-message');
  //   });

  //   it('should show unauthorized message for 403 status code', async () => {
  //     await component.errorMessage(403);

  //     expect(mockTranslateService.instant).toHaveBeenCalledWith('vc-selector.credential-revoke-message');
  //   });

  //   it('should show bad request message for 4xx status codes', async () => {
  //     await component.errorMessage(400);

  //     expect(mockTranslateService.instant).toHaveBeenCalledWith('vc-selector.bad-request-error-message');
  //   });

  //   it('should show generic error message for other status codes', async () => {
  //     await component.errorMessage(0);

  //     expect(mockTranslateService.instant).toHaveBeenCalledWith('vc-selector.generic-error-message');
  //   });


  // });

  describe('Component integration', () => {
    it('should handle full workflow from initialization to credential selection', () => {
      // Component should be initialized with query params
      expect(component._VCReply.redirectUri).toBe('http://example.com/callback');
      expect(component._VCReply.state).toBe('test-state');
      expect(component._VCReply.nonce).toBe('test-nonce');

      // Should have processed credentials
      expect(component.credList).toHaveLength(1);
      expect(component.isClick).toHaveLength(1);

      // Should be able to select credentials
      const credential = component.credList[0];
      component.selectCred(credential, 0);

      expect(component.selCredList).toContain(credential);
      expect(component.isClick[0]).toBe(true);
    });
  });
});
