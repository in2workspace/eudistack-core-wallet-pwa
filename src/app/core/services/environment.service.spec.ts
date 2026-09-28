import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { EnvironmentService, resolveEnvironmentLabel } from './environment.service';

describe('resolveEnvironmentLabel', () => {
  it('labels DEV hosts', () => {
    expect(resolveEnvironmentLabel('sandbox.dev.eudistack.net')).toBe('DEV');
    expect(resolveEnvironmentLabel('KPMG.DEV.eudistack.net')).toBe('DEV');
  });

  it('labels STG hosts', () => {
    expect(resolveEnvironmentLabel('sandbox.stg.eudistack.net')).toBe('STG');
    expect(resolveEnvironmentLabel('cgcom.STG.eudistack.net')).toBe('STG');
  });

  it('does not label PRO or unrelated hosts', () => {
    expect(resolveEnvironmentLabel('sandbox.eudistack.net')).toBeNull();
    expect(resolveEnvironmentLabel('wallet.dome-marketplace-sbx.org')).toBeNull();
  });

  it('does not label lookalike hosts', () => {
    expect(resolveEnvironmentLabel('dev.eudistack.net')).toBeNull();
    expect(resolveEnvironmentLabel('stg.eudistack.net')).toBeNull();
    expect(resolveEnvironmentLabel('sandbox.dev.eudistack.net.evil.com')).toBeNull();
  });

  it('labels the local stack (temporary preview)', () => {
    expect(resolveEnvironmentLabel('localhost')).toBe('LOCAL');
    expect(resolveEnvironmentLabel('sandbox.127.0.0.1.nip.io')).toBe('LOCAL');
  });
});

describe('EnvironmentService', () => {
  const create = (hostname: string): EnvironmentService => {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { location: { hostname } } }],
    });
    return TestBed.inject(EnvironmentService);
  };

  it('decorates names on DEV', () => {
    const service = create('sandbox.dev.eudistack.net');
    expect(service.label).toBe('DEV');
    expect(service.decorate('EUDIStack Wallet')).toBe('EUDIStack Wallet (DEV)');
    expect(service.decorateShort('EUDIStack')).toBe('EUDIStack DEV');
  });

  it('decorates names on STG', () => {
    const service = create('sandbox.stg.eudistack.net');
    expect(service.label).toBe('STG');
    expect(service.decorate('EUDIStack Wallet')).toBe('EUDIStack Wallet (STG)');
    expect(service.decorateShort('EUDIStack')).toBe('EUDIStack STG');
  });

  it('leaves names untouched on PRO', () => {
    const service = create('sandbox.eudistack.net');
    expect(service.label).toBeNull();
    expect(service.decorate('EUDIStack Wallet')).toBe('EUDIStack Wallet');
    expect(service.decorateShort('EUDIStack')).toBe('EUDIStack');
  });
});
