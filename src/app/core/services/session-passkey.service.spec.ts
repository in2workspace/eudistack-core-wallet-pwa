import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SessionPasskeyService } from './session-passkey.service';
import { PasskeyApiService } from './passkey-api.service';

describe('SessionPasskeyService', () => {
  let service: SessionPasskeyService;
  let listPasskeys: jest.Mock;

  beforeEach(() => {
    listPasskeys = jest.fn().mockReturnValue(of([
      { id: 'pk-1', credentialId: 'cred-1' },
      { id: 'pk-2', credentialId: 'cred-2' },
    ]));
    TestBed.configureTestingModule({ providers: [{ provide: PasskeyApiService, useValue: { listPasskeys } }] });
    service = TestBed.inject(SessionPasskeyService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('returns the credential ID known from the ceremony without calling the service', async () => {
    service.set('pk-1', 'cred-1');

    await expect(service.resolveCredentialId()).resolves.toBe('cred-1');
    expect(listPasskeys).not.toHaveBeenCalled();
  });

  it('looks the credential ID up by the session passkey after a resume', async () => {
    service.set('pk-2');

    await expect(service.resolveCredentialId()).resolves.toBe('cred-2');
  });

  it('drops the credential ID of a previous passkey', async () => {
    service.set('pk-1', 'cred-1');
    service.set('pk-2');

    await expect(service.resolveCredentialId()).resolves.toBe('cred-2');
  });

  it('fails without a session passkey', async () => {
    await expect(service.resolveCredentialId()).rejects.toMatchObject({ code: 'passkey_not_found' });
  });

  it('fails when the session passkey is no longer in the account', async () => {
    service.set('pk-gone');

    await expect(service.resolveCredentialId()).rejects.toMatchObject({ code: 'passkey_not_found' });
  });
});
