import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { SwUpdateService } from './sw-update.service';
import { PwaInstallService } from '../../shared/services/pwa-install.service';
import { ToastServiceHandler } from '../../shared/services/toast.service';
import { BUILD_INFO } from '../constants/build-info.constants';

const JUST_UPDATED_KEY = 'wallet_pwa_just_updated';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SwUpdateService', () => {
  let versionUpdates: Subject<VersionEvent>;
  let activateUpdate: jest.Mock<Promise<boolean>, []>;
  let markPreUpdateReload: jest.Mock<void, []>;
  let showInfoToastByTranslateLabel: jest.Mock<void, []>;
  let reload: jest.Mock<void, []>;

  function setup(isEnabled: boolean): SwUpdateService {
    versionUpdates = new Subject<VersionEvent>();
    activateUpdate = jest.fn().mockResolvedValue(true);
    markPreUpdateReload = jest.fn();
    showInfoToastByTranslateLabel = jest.fn();
    // jsdom's real Location.reload() throws "Not implemented: navigation" and
    // its `reload` property is read-only, so swap the whole window.location
    // object for a stub instead of patching the method in place.
    reload = jest.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload },
    });

    TestBed.configureTestingModule({
      providers: [
        {
          provide: SwUpdate,
          useValue: { isEnabled, versionUpdates, activateUpdate, checkForUpdate: jest.fn().mockResolvedValue(false) },
        },
        { provide: PwaInstallService, useValue: { markPreUpdateReload, isStandalone: false } },
        { provide: ToastServiceHandler, useValue: { showInfoToastByTranslateLabel } },
      ],
    });

    return TestBed.inject(SwUpdateService);
  }

  afterEach(() => {
    jest.restoreAllMocks();
    sessionStorage.removeItem(JUST_UPDATED_KEY);
    TestBed.resetTestingModule();
  });

  it('does nothing when the Angular Service Worker is disabled', () => {
    const service = setup(false);

    service.init();
    versionUpdates.next({ type: 'VERSION_READY' } as VersionEvent);

    expect(activateUpdate).not.toHaveBeenCalled();
  });

  it('marks the pre-update grace and reloads after activating a ready version', async () => {
    const service = setup(true);
    service.init();

    versionUpdates.next({ type: 'VERSION_READY' } as VersionEvent);
    await flushPromises();

    expect(activateUpdate).toHaveBeenCalledTimes(1);
    expect(markPreUpdateReload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(JUST_UPDATED_KEY)).toBe('true');
  });

  it('marks the pre-update grace before reloading, not after', async () => {
    const service = setup(true);
    service.init();
    const callOrder: string[] = [];
    markPreUpdateReload.mockImplementation(() => { callOrder.push('mark'); });
    reload.mockImplementation(() => { callOrder.push('reload'); });

    versionUpdates.next({ type: 'VERSION_READY' } as VersionEvent);
    await flushPromises();

    expect(callOrder).toEqual(['mark', 'reload']);
  });

  it('ignores version events other than VERSION_READY', () => {
    const service = setup(true);
    service.init();

    versionUpdates.next({ type: 'VERSION_DETECTED' } as VersionEvent);

    expect(activateUpdate).not.toHaveBeenCalled();
  });

  it('does not reload when activateUpdate rejects', async () => {
    const service = setup(true);
    activateUpdate.mockRejectedValue(new Error('activation failed'));
    service.init();

    versionUpdates.next({ type: 'VERSION_READY' } as VersionEvent);
    await flushPromises();

    expect(markPreUpdateReload).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('stops listening for version updates after being destroyed', () => {
    const service = setup(true);
    service.init();

    service.ngOnDestroy();
    versionUpdates.next({ type: 'VERSION_READY' } as VersionEvent);

    expect(activateUpdate).not.toHaveBeenCalled();
  });

  describe('post-update toast', () => {
    it('shows the update toast with the current version when this boot follows an update reload', () => {
      sessionStorage.setItem(JUST_UPDATED_KEY, 'true');
      const service = setup(true);

      service.init();

      expect(showInfoToastByTranslateLabel).toHaveBeenCalledWith(
        'app-update.toast', 5000, 'info', { version: BUILD_INFO.version }
      );
    });

    it('consumes the marker so a later boot in the same tab does not show the toast again', () => {
      sessionStorage.setItem(JUST_UPDATED_KEY, 'true');
      const service = setup(true);

      service.init();

      expect(sessionStorage.getItem(JUST_UPDATED_KEY)).toBeNull();
    });

    it('does not show the toast on a plain boot with no pending update marker', () => {
      const service = setup(true);

      service.init();

      expect(showInfoToastByTranslateLabel).not.toHaveBeenCalled();
    });
  });
});
