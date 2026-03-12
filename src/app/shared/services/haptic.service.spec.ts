import { TestBed } from '@angular/core/testing';
import { HapticService } from './haptic.service';

const mockImpact = jest.fn().mockResolvedValue(undefined);
const mockNotification = jest.fn().mockResolvedValue(undefined);

jest.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: (...args: any[]) => mockImpact(...args),
    notification: (...args: any[]) => mockNotification(...args),
  },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

let mockIsNative = false;
jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNative,
  },
}));

describe('HapticService', () => {
  let service: HapticService;

  beforeEach(() => {
    mockImpact.mockClear();
    mockNotification.mockClear();
    TestBed.resetTestingModule();
  });

  describe('on web platform', () => {
    beforeEach(() => {
      mockIsNative = false;
      TestBed.configureTestingModule({ providers: [HapticService] });
      service = TestBed.inject(HapticService);
    });

    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('impact should be a no-op on web', async () => {
      await service.impact();
      expect(mockImpact).not.toHaveBeenCalled();
    });

    it('notification should be a no-op on web', async () => {
      await service.notification();
      expect(mockNotification).not.toHaveBeenCalled();
    });
  });

  describe('on native platform', () => {
    beforeEach(() => {
      mockIsNative = true;
      TestBed.configureTestingModule({ providers: [HapticService] });
      service = TestBed.inject(HapticService);
    });

    it('impact should call Haptics.impact with default Medium style', async () => {
      await service.impact();
      expect(mockImpact).toHaveBeenCalledWith({ style: 'MEDIUM' });
    });

    it('impact should call Haptics.impact with specified style', async () => {
      const { ImpactStyle } = await import('@capacitor/haptics');
      await service.impact(ImpactStyle.Heavy);
      expect(mockImpact).toHaveBeenCalledWith({ style: 'HEAVY' });
    });

    it('notification should call Haptics.notification with default Success type', async () => {
      await service.notification();
      expect(mockNotification).toHaveBeenCalledWith({ type: 'SUCCESS' });
    });

    it('notification should call Haptics.notification with specified type', async () => {
      const { NotificationType } = await import('@capacitor/haptics');
      await service.notification(NotificationType.Error);
      expect(mockNotification).toHaveBeenCalledWith({ type: 'ERROR' });
    });
  });
});
