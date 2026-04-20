import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { CameraService } from './camera.service';
import { StorageService } from './storage.service';
import { ToastServiceHandler } from './toast.service';
import { signal } from '@angular/core';
import { EMPTY, of } from 'rxjs';

window.MediaStream = class {
  getTracks() {
    return [];
  }
} as any;

Object.defineProperty(window, 'MediaRecorder', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
      start: jest.fn(),
      ondataavailable: jest.fn(),
      onerror: jest.fn(),
      state: '',
      stop: jest.fn()
  }))
});

Object.defineProperty(MediaRecorder, 'isTypeSupported', {
  writable: true,
  value: () => true
});

const mockGetUserMedia = jest.fn(async () => {
  return new Promise<void>(resolve => {
      resolve()
  })
})

  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: {
      getUserMedia: jest.fn(),
      enumerateDevices: jest.fn(),
    },
    writable: true
  });

class MockStorageService {
  private storage = new Map<string, any>();

  async set(key: string, value: any): Promise<void> {
    this.storage.set(key, value);
  }

  async get(key: string): Promise<any> {
    return this.storage.get(key);
  }

  async remove(key: string): Promise<void> {
    this.storage.delete(key);
  }
}

describe('CameraService', () => {
  let cameraService: CameraService;
  let mockStorageService: MockStorageService;
  let mockToastService: {
    showErrorAlertByTranslateLabel: jest.Mock
  }

  beforeEach(() => {
    mockToastService = {
      showErrorAlertByTranslateLabel: jest.fn().mockReturnValue(EMPTY)
    }
    TestBed.configureTestingModule({
      providers: [
        CameraService,
        { provide: StorageService, useClass: MockStorageService },
        { provide: ToastServiceHandler, useValue: mockToastService }
      ],
    });

    cameraService = TestBed.inject(CameraService);
    mockStorageService = TestBed.inject(StorageService) as unknown as MockStorageService;
  });


  it('should keep multiple Scanner a activatingScannersListSubj', () => {
    const scanner1 = '123ABC';
    const scanner2 = 'XYZ789';

    cameraService.addActivatingScanner(scanner1);
    cameraService.addActivatingScanner(scanner2);

    const currentList = cameraService.activatingScannersListSubj.getValue();
    
    expect(currentList).toContain(scanner1);
    expect(currentList).toContain(scanner2);
  });

  it('should correctly emit scanners list with activatingScannerList$', (done) => {
    const scanner = 'TEST-SCANNER';

    cameraService.activatingScannersList$.subscribe((list) => {
      if (list.length > 0) {
        expect(list).toContain(scanner);
        done();
      }
    });

    cameraService.addActivatingScanner(scanner);
  });

  describe('CameraService - removeActivatingScanner', () => {
  
    it('should remove an existing scanner from activatingScannerListSubj', () => {
      const scanner1 = '123ABC';
      const scanner2 = 'XYZ789';
  
      cameraService.addActivatingScanner(scanner1);
      cameraService.addActivatingScanner(scanner2);
  
      expect(cameraService.activatingScannersListSubj.getValue()).toEqual([scanner1, scanner2]);
  
      cameraService.removeActivatingScanner(scanner1);
  
      expect(cameraService.activatingScannersListSubj.getValue()).toEqual([scanner2]);
    });
  
    it('should not change the list if the scanner does not exist', () => {
      const scanner1 = '123ABC';

      cameraService.addActivatingScanner(scanner1);

      // Try to remove a Scanner that does not exist
      cameraService.removeActivatingScanner('NO-EXISTEIX');

      // Verify that the list remains unchanged
      expect(cameraService.activatingScannersListSubj.getValue()).toEqual([scanner1]);
    });
  
    it('should leave the list empty when all scanners are removed', () => {
      const scanner1 = '123ABC';
      const scanner2 = 'XYZ789';

      cameraService.addActivatingScanner(scanner1);
      cameraService.addActivatingScanner(scanner2);

      // Remove both Scanners
      cameraService.removeActivatingScanner(scanner1);
      cameraService.removeActivatingScanner(scanner2);

      // Verify that the list is empty
      expect(cameraService.activatingScannersListSubj.getValue()).toEqual([]);
    });
  
    it('should correctly emit the updated values to activatingScannersList$', (done) => {
      const scanner1 = '123ABC';
      const scanner2 = 'XYZ789';
  
      cameraService.addActivatingScanner(scanner1);
      cameraService.addActivatingScanner(scanner2);
  
      cameraService.activatingScannersList$.subscribe((list) => {
        if (list.length === 1 && list[0] === scanner2) {
          expect(list).toEqual([scanner2]);
          done();
        }
      });
  
      cameraService.removeActivatingScanner(scanner1);
    });
  });
  
  describe('CameraService - setCamera', () => {
  
    it('should change the selected camera and save it to StorageService', async () => {
      const mockCamera: MediaDeviceInfo = {
        deviceId: '123',
        label: 'Mock Camera',
        kind: 'videoinput',
        groupId: 'group1',
        toJSON: jest.fn(),
      };
  
      cameraService.setCamera(mockCamera);
  
      // Verify that the selected camera has been updated
      expect(cameraService.selectedCamera$()).toEqual(mockCamera);

      // Verify that the camera has been stored correctly
      const storedCamera = await mockStorageService.get('camera');
      expect(storedCamera).toEqual({
        deviceId: '123',
        label: 'Mock Camera',
        kind: 'videoinput',
      });
    });
  });

  describe('CameraService - getAvailableCameraById', () => {
  
    it('should return an available camera by its ID', () => {
      const mockDevices: MediaDeviceInfo[] = [
        { deviceId: '123', label: 'Camera 1', kind: 'videoinput', groupId: 'group1', toJSON: jest.fn() },
        { deviceId: '456', label: 'Camera 2', kind: 'videoinput', groupId: 'group2', toJSON: jest.fn() },
      ];
  
      cameraService.availableDevices$.set(mockDevices);
  
      const foundCamera = cameraService.getAvailableCameraById('456');
  
      expect(foundCamera).toEqual(mockDevices[1]);
    });
  
    it('should return undefined if the ID does not exist', () => {
      const mockDevices: MediaDeviceInfo[] = [
        { deviceId: '123', label: 'Camera 1', kind: 'videoinput', groupId: 'group1', toJSON: jest.fn() },
      ];
  
      cameraService.availableDevices$.set(mockDevices);
  
      const foundCamera = cameraService.getAvailableCameraById('999'); // Non-existent ID
  
      expect(foundCamera).toBeUndefined();
    });
  });

  it('should grant camera permission and stop tracks when getUserMedia succeeds', async () => {
    const mockStream = new MediaStream();
    jest.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(mockStream);
    jest.spyOn(cameraService, 'stopMediaTracks').mockImplementation();

    const result = await cameraService.getCameraPermissionAndStopTracks();

    expect(result).toBe(true);
    expect(cameraService.stopMediaTracks).toHaveBeenCalledWith(mockStream);
  });

  it('should throw an error when getUserMedia fails', async () => {
    const error = new Error('Permission denied');
    jest.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(error);

    await expect(cameraService.getCameraPermissionAndStopTracks()).rejects.toThrow(error);
  });

  describe('updateAvailableDevices', ()=>{
    it('should update availableDevices$ with devices of type videoinput', async () => {
      const mockDevices: MediaDeviceInfo[] = [
        { deviceId: '123', label: 'Camera 1', kind: 'videoinput', groupId: 'group1', toJSON: jest.fn() },
        { deviceId: '456', label: 'Microphone', kind: 'audioinput', groupId: 'group2', toJSON: jest.fn() },
        { deviceId: '789', label: 'Camera 2', kind: 'videoinput', groupId: 'group3', toJSON: jest.fn() }
      ];
  
      jest.spyOn(navigator.mediaDevices, 'enumerateDevices').mockResolvedValue(mockDevices);
  
      const result = await cameraService.updateAvailableCameras();
  
      expect(result).toEqual([
        { deviceId: '123', label: 'Camera 1', kind: 'videoinput', groupId: 'group1', toJSON: expect.any(Function) },
        { deviceId: '789', label: 'Camera 2', kind: 'videoinput', groupId: 'group3', toJSON: expect.any(Function) }
      ]);
  
      expect(cameraService.availableDevices$()).toEqual(result);
    });
  
    it('should return an empty list if no cameras are available', async () => {
      jest.spyOn(navigator.mediaDevices, 'enumerateDevices').mockResolvedValue([
        { deviceId: '456', label: 'Microphone', kind: 'audioinput', groupId: 'group2', toJSON: jest.fn() }
      ]);
  
      const result = await cameraService.updateAvailableCameras();
  
      expect(result).toEqual([]);
      expect(cameraService.availableDevices$()).toEqual([]);
    });
  });

  describe('getCameraFromStorage', ()=>{
    it('should return the selected camera if it is available', async () => {
      const mockCamera: MediaDeviceInfo = {
        deviceId: '123',
        label: 'Camera 1',
        kind: 'videoinput',
        groupId: 'group1',
        toJSON: jest.fn(),
      };
  
      jest.spyOn(cameraService, 'isCameraAvailableById').mockReturnValue(true);
      cameraService.selectedCamera$.set(mockCamera);
  
      const result = await cameraService.getCameraFromAvailables();
  
      expect(result).toBe(mockCamera);
    });
  
    it('should return the stored camera if it is available', async () => {
      const mockCameraFromStorage: MediaDeviceInfo = {
        deviceId: '456',
        label: 'Stored Camera',
        kind: 'videoinput',
        groupId: 'group2',
        toJSON: jest.fn(),
      };
  
      jest.spyOn(cameraService, 'isCameraAvailableById').mockReturnValue(true);
      jest.spyOn(cameraService, 'getCameraFromStorage').mockResolvedValue(mockCameraFromStorage);
  
      const result = await cameraService.getCameraFromAvailables();
  
      expect(result).toBe(mockCameraFromStorage);
      expect(cameraService.selectedCamera$()).toBe(mockCameraFromStorage);
    });
  
    it('should return the default camera if no other is available', async () => {
      const mockDefaultCamera: MediaDeviceInfo = {
        deviceId: '789',
        label: 'Default Camera',
        kind: 'videoinput',
        groupId: 'group3',
        toJSON: jest.fn(),
      };
      cameraService.selectedCamera$ = signal(undefined);
  
      jest.spyOn(cameraService, 'isCameraAvailableById').mockReturnValueOnce(true);
      jest.spyOn(cameraService, 'getCameraFromStorage').mockResolvedValue(undefined);
      jest.spyOn(cameraService, 'getDefaultAvailableCamera').mockResolvedValue(mockDefaultCamera);
      jest.spyOn(cameraService, 'setCamera');
  
      const result = await cameraService.getCameraFromAvailables();
  
      expect(result).toBe(mockDefaultCamera);
      expect(cameraService.setCamera).toHaveBeenCalledWith(mockDefaultCamera);
    });
  
    it('should return NO_CAMERA_AVAILABLE if no camera is available', async () => {
      jest.spyOn(cameraService, 'isCameraAvailableById').mockReturnValue(false);
      jest.spyOn(cameraService, 'getCameraFromStorage').mockResolvedValue(undefined);
      jest.spyOn(cameraService, 'getDefaultAvailableCamera').mockResolvedValue({} as MediaDeviceInfo);
  
      const result = await cameraService.getCameraFromAvailables();
  
      expect(result).toBe('NO_CAMERA_AVAILABLE');
    });
  
  });

  describe('getCameraFromStorage', ()=>{
    it('should return the stored camera if it is valid', async () => {
      const mockCamera: MediaDeviceInfo = {
        deviceId: '123',
        label: 'Stored Camera',
        kind: 'videoinput',
        groupId: 'group1',
        toJSON: jest.fn(),
      };
  
      jest.spyOn(mockStorageService, 'get').mockResolvedValue(mockCamera);
      jest.spyOn(cameraService, 'isValidMediaDeviceInfo').mockReturnValue(true);
  
      const result = await cameraService.getCameraFromStorage();
  
      expect(result).toEqual(mockCamera);
    });
  
    it('should return undefined if the stored camera is null', async () => {
      jest.spyOn(mockStorageService, 'get').mockResolvedValue(null);
  
      const result = await cameraService.getCameraFromStorage();
  
      expect(result).toBeUndefined();
    });
  
    it('should return undefined if the stored camera is not valid', async () => {
      const invalidCamera = { someProperty: 'invalidData' }; // Object that is not a MediaDeviceInfo
  
      jest.spyOn(mockStorageService, 'get').mockResolvedValue(invalidCamera);
      jest.spyOn(cameraService, 'isValidMediaDeviceInfo').mockReturnValue(false);
  
      const result = await cameraService.getCameraFromStorage();
  
      expect(result).toBeUndefined();
    });
  
  });

  describe('get default available camera', ()=>{
    it('should return the rear camera if available by label', async () => {
      const mockDevices: MediaDeviceInfo[] = [
        { deviceId: '123', label: 'Front Camera', kind: 'videoinput', groupId: 'group1', toJSON: jest.fn() },
        { deviceId: '456', label: 'Rear Camera', kind: 'videoinput', groupId: 'group2', toJSON: jest.fn() },
      ];

      cameraService.availableDevices$.set(mockDevices);

      const result = await cameraService.getDefaultAvailableCamera();

      expect(result).toEqual(mockDevices[1]); // The camera with "Rear Camera"
    });

    it('should return the camera by facingMode when getUserMedia detects an environment camera', async () => {
      const mockDevices: MediaDeviceInfo[] = [
        { deviceId: '123', label: 'Front Camera', kind: 'videoinput', groupId: 'group1', toJSON: jest.fn() },
        { deviceId: '456', label: 'Wide Camera', kind: 'videoinput', groupId: 'group2', toJSON: jest.fn() },
      ];
      cameraService.availableDevices$.set(mockDevices);

      const mockTrack = {
        getSettings: jest.fn().mockReturnValue({ deviceId: '456', facingMode: 'environment' }),
        stop: jest.fn(),
      };
      const mockStream = {
        getVideoTracks: jest.fn().mockReturnValue([mockTrack]),
        getTracks: jest.fn().mockReturnValue([mockTrack]),
      } as unknown as MediaStream;

      jest.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(mockStream);
      jest.spyOn(cameraService, 'stopMediaTracks').mockImplementation();

      const result = await cameraService.getDefaultAvailableCamera();

      expect(result).toEqual(mockDevices[1]);
      expect(cameraService.stopMediaTracks).toHaveBeenCalledWith(mockStream);
    });

    it('should return the first available camera if there is no rear camera by label or by facingMode', async () => {
      const mockDevices: MediaDeviceInfo[] = [
        { deviceId: '123', label: 'Front Camera', kind: 'videoinput', groupId: 'group1', toJSON: jest.fn() },
        { deviceId: '456', label: 'Secondary Camera', kind: 'videoinput', groupId: 'group2', toJSON: jest.fn() },
      ];

      cameraService.availableDevices$.set(mockDevices);
      jest.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(new Error('NotAllowedError'));

      const result = await cameraService.getDefaultAvailableCamera();

      expect(result).toEqual(mockDevices[0]);
    });

    it('should return the first camera when getUserMedia succeeds but facingMode is not environment', async () => {
      const mockDevices: MediaDeviceInfo[] = [
        { deviceId: '123', label: 'Front Camera', kind: 'videoinput', groupId: 'group1', toJSON: jest.fn() },
        { deviceId: '456', label: 'Secondary Camera', kind: 'videoinput', groupId: 'group2', toJSON: jest.fn() },
      ];
      cameraService.availableDevices$.set(mockDevices);

      const mockTrack = {
        getSettings: jest.fn().mockReturnValue({ deviceId: '123', facingMode: 'user' }),
        stop: jest.fn(),
      };
      const mockStream = {
        getVideoTracks: jest.fn().mockReturnValue([mockTrack]),
        getTracks: jest.fn().mockReturnValue([mockTrack]),
      } as unknown as MediaStream;

      jest.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(mockStream);
      jest.spyOn(cameraService, 'stopMediaTracks').mockImplementation();

      const result = await cameraService.getDefaultAvailableCamera();

      expect(result).toEqual(mockDevices[0]);
    });

    it('should return undefined if no cameras are available', async () => {
      cameraService.availableDevices$.set([]);
      jest.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(new Error('NotAllowedError'));

      const result = await cameraService.getDefaultAvailableCamera();

      expect(result).toBeUndefined();
    });

  })

  describe('isCameraAvailableById', ()=>{
    it('should return the rear camera if it is available', async () => {
      const mockDevices: MediaDeviceInfo[] = [
        { deviceId: '123', label: 'Front Camera', kind: 'videoinput', groupId: 'group1', toJSON: jest.fn() },
        { deviceId: '456', label: 'Rear Camera', kind: 'videoinput', groupId: 'group2', toJSON: jest.fn() },
      ];

      cameraService.availableDevices$.set(mockDevices);

      const result = await cameraService.getDefaultAvailableCamera();

      expect(result).toEqual(mockDevices[1]); // The camera with "Rear Camera"
    });

    it('should return the first available camera if there is no rear camera', async () => {
      const mockDevices: MediaDeviceInfo[] = [
        { deviceId: '123', label: 'Front Camera', kind: 'videoinput', groupId: 'group1', toJSON: jest.fn() },
        { deviceId: '456', label: 'Secondary Camera', kind: 'videoinput', groupId: 'group2', toJSON: jest.fn() },
      ];
  
      cameraService.availableDevices$.set(mockDevices);
  
      const result = await cameraService.getDefaultAvailableCamera();
  
      expect(result).toEqual(mockDevices[0]); // Must return the first available camera
    });

    it('should return undefined if no cameras are available', async () => {
      cameraService.availableDevices$.set([]);

      const result = await cameraService.getDefaultAvailableCamera();
  
      expect(result).toBeUndefined();
    });
  
  });

  describe('isValidMediaInfo', ()=>{
    it('should return true for a valid MediaDeviceInfo object', () => {
      const validCamera: MediaDeviceInfo = {
        deviceId: '123',
        label: 'Valid Camera',
        kind: 'videoinput',
        groupId: 'group1',
        toJSON: jest.fn(),
      };
  
      expect(cameraService.isValidMediaDeviceInfo(validCamera)).toBe(true);
    });
  
    it('should return false if the deviceId property is missing', () => {
      const invalidCamera = {
        label: 'Invalid Camera',
        kind: 'videoinput',
        groupId: 'group1',
      };
  
      expect(cameraService.isValidMediaDeviceInfo(invalidCamera)).toBe(false);
    });
  
    it('should return false if kind is not "videoinput"', () => {
      const invalidCamera: any = {
        deviceId: '123',
        label: 'Not a camera',
        kind: 'audioinput',
        groupId: 'group1',
      };
  
      expect(cameraService.isValidMediaDeviceInfo(invalidCamera)).toBe(false);
    });
  
    it('should return false if the object is null or undefined', () => {
      expect(cameraService.isValidMediaDeviceInfo(null)).toBe(false);
      expect(cameraService.isValidMediaDeviceInfo(undefined)).toBe(false);
    });
  
    it('should return false if the object does not have the correct structure', () => {
      const randomObject = { someKey: 'someValue' };
      expect(cameraService.isValidMediaDeviceInfo(randomObject)).toBe(false);
    });
  
  });

  it('should stop all tracks of the MediaStream', () => {
    const mockTrack1 = { stop: jest.fn() };
    const mockTrack2 = { stop: jest.fn() };
    const mockStream = { getTracks: jest.fn(() => [mockTrack1, mockTrack2]) } as unknown as MediaStream;
  
    cameraService.stopMediaTracks(mockStream);
  
    expect(mockStream.getTracks).toHaveBeenCalled();
    expect(mockTrack1.stop).toHaveBeenCalled();
    expect(mockTrack2.stop).toHaveBeenCalled();
  });
  
  it('should not throw errors if the MediaStream has no tracks', () => {
    const mockStream = { getTracks: jest.fn(() => []) } as unknown as MediaStream;
  
    expect(() => cameraService.stopMediaTracks(mockStream)).not.toThrow();
    expect(mockStream.getTracks).toHaveBeenCalled();
  });
  
  describe('handle camera errors', ()=>{
    it('should set isCameraError$ to true and log an error with CameraLogsService', async () => {
      const mockError = new Error('Camera permission denied');
      jest.spyOn(cameraService, 'alertCameraErrorsByErrorName');
      const mockAddCameraLog = jest.spyOn(cameraService['cameraLogsService'], 'addCameraLog');
    
      cameraService.handleCameraErrors(mockError, 'fetchError');
    
      expect(cameraService.isCameraError$()).toBe(true);
      expect(cameraService.alertCameraErrorsByErrorName).toHaveBeenCalledWith(mockError.name);
      expect(mockAddCameraLog).toHaveBeenCalledWith(mockError, 'fetchError');
    });
    
    it('should handle errors passed as objects with a name field', async () => {
      const mockError = { name: 'NotAllowedError' };
      jest.spyOn(cameraService, 'alertCameraErrorsByErrorName');
      const mockAddCameraLog = jest.spyOn(cameraService['cameraLogsService'], 'addCameraLog');
    
      cameraService.handleCameraErrors(mockError, 'fetchError');
    
      expect(cameraService.isCameraError$()).toBe(true);
      expect(cameraService.alertCameraErrorsByErrorName).toHaveBeenCalledWith(mockError.name);
      expect(mockAddCameraLog).toHaveBeenCalledWith(expect.any(Error), 'fetchError');
    });
    
    it('should use "undefinedError" if no log type is provided', async () => {
      const mockError = new Error('Unknown error');
      const mockAddCameraLog = jest.spyOn(cameraService['cameraLogsService'], 'addCameraLog');
    
      cameraService.handleCameraErrors(mockError);
    
      expect(mockAddCameraLog).toHaveBeenCalledWith(mockError, 'undefinedError');
    });
    
  });

  describe('check device and navigator version', ()=>{
    it('should return true if the iOS version is lower than the provided value', () => {
      jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 12_3 like Mac OS X)');
    
      expect(cameraService.isIOSVersionLowerThan(13)).toBe(true);
    });
    
    it('should return false if the iOS version is equal to or greater than the provided value', () => {
      jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)');
    
      expect(cameraService.isIOSVersionLowerThan(13)).toBe(false);
    });
    
    it('should return false if no iOS version is identified', () => {
      jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    
      expect(cameraService.isIOSVersionLowerThan(13)).toBe(false);
    });
    
  });

  describe('should show error by label', ()=>{
    it('should display "errors.camera.not-readable" if the error is NotReadableError', () => {
      cameraService.alertCameraErrorsByErrorName('NotReadableError: Could not start video source');
  
      expect(mockToastService.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.camera.not-readable');
    });
  
    it('should display "errors.camera.not-allowed" if the error is NotAllowedError', () => {
      cameraService.alertCameraErrorsByErrorName('NotAllowedError: Permission denied');
  
      expect(mockToastService.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.camera.not-allowed');
    });
  
    it('should display "errors.camera.not-found" if the error is NotFoundError', () => {
      cameraService.alertCameraErrorsByErrorName('NotFoundError: No camera found');
  
      expect(mockToastService.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.camera.not-found');
    });
  
    it('should display "errors.camera.not-found" if the error is CustomNoAvailable', () => {
      cameraService.alertCameraErrorsByErrorName('CustomNoAvailable: No camera found');
  
      expect(mockToastService.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.camera.not-found');
    });
  
    it('should display "errors.camera.overconstrained" if the error is OverconstrainedError', () => {
      cameraService.alertCameraErrorsByErrorName('OverconstrainedError: Camera constraints too strict');
  
      expect(mockToastService.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.camera.overconstrained');
    });
  
    it('should display "errors.camera.security" if the error is SecurityError', () => {
      cameraService.alertCameraErrorsByErrorName('SecurityError: Blocked by browser');
  
      expect(mockToastService.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.camera.security');
    });
  
    it('should display "errors.camera.abort" if the error is AbortError', () => {
      cameraService.alertCameraErrorsByErrorName('AbortError: The operation was aborted');
  
      expect(mockToastService.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.camera.abort');
    });
  
    it('should display "errors.camera.type" if the error is TypeError', () => {
      cameraService.alertCameraErrorsByErrorName('TypeError: Invalid constraints');
  
      expect(mockToastService.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.camera.type');
    });
  
    it('should display "errors.camera.not-supported" if the error is NotSupportedError', () => {
      cameraService.alertCameraErrorsByErrorName('NotSupportedError: The feature is not supported');
  
      expect(mockToastService.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.camera.not-supported');
    });
  
    it('should display "errors.camera.default" if the error does not match any known case', () => {
      cameraService.alertCameraErrorsByErrorName('RandomError: Something unexpected happened');
  
      expect(mockToastService.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.camera.default');
    });
  });

  describe('CameraService - getCameraFlow', () => {
    beforeEach(() => {
      jest.spyOn(cameraService, 'getCameraPermissionAndStopTracks').mockResolvedValue(true);
      jest.spyOn(cameraService, 'updateAvailableCameras').mockResolvedValue([]);
      jest.spyOn(cameraService, 'getCameraFromAvailables').mockResolvedValue('NO_CAMERA_AVAILABLE');
      jest.spyOn(cameraService, 'handleCameraErrors').mockImplementation();
    });
  
    it('should return PERMISSION_DENIED if getCameraPermissionAndStopTracks throws an error', async () => {
      jest.spyOn(cameraService, 'getCameraPermissionAndStopTracks').mockRejectedValue(new Error('Permission Denied'));
  
      const result = await cameraService.getCameraFlow();
  
      expect(result).toBe('PERMISSION_DENIED');
      expect(cameraService.handleCameraErrors).toHaveBeenCalledWith(expect.any(Error), 'fetchError');
    });
  
    it('should return PERMISSION_DENIED if getCameraPermissionAndStopTracks returns false', async () => {
      jest.spyOn(cameraService, 'getCameraPermissionAndStopTracks').mockRejectedValue(new Error(''))
  
      const result = await cameraService.getCameraFlow();
  
      expect(result).toBe('PERMISSION_DENIED');
      expect(cameraService.handleCameraErrors).toHaveBeenCalledWith(expect.any(Error), 'fetchError');
    });
  
    it('should return NO_CAMERA_AVAILABLE if no cameras are available', async () => {
      jest.spyOn(cameraService, 'updateAvailableCameras').mockResolvedValue([]);
  
      const result = await cameraService.getCameraFlow();
  
      expect(result).toBe('NO_CAMERA_AVAILABLE');
      expect(cameraService.handleCameraErrors).toHaveBeenCalledWith({ name: 'CustomNoAvailable' }, 'fetchError');
    });
  
    it('should return NO_CAMERA_AVAILABLE if getCameraFromAvailables returns NO_CAMERA_AVAILABLE', async () => {
      jest.spyOn(cameraService, 'updateAvailableCameras').mockResolvedValue([{ deviceId: '123', label: 'Mock Camera', kind: 'videoinput', groupId: 'group1', toJSON: jest.fn() }]);
      jest.spyOn(cameraService, 'getCameraFromAvailables').mockResolvedValue('NO_CAMERA_AVAILABLE');
  
      const result = await cameraService.getCameraFlow();
  
      expect(result).toBe('NO_CAMERA_AVAILABLE');
      expect(cameraService.handleCameraErrors).toHaveBeenCalledWith({ name: 'CustomNoAvailable' }, 'fetchError');
    });
  
    it('should return a camera if it is available', async () => {
      const mockCamera: MediaDeviceInfo = { deviceId: '123', label: 'Mock Camera', kind: 'videoinput', groupId: 'group1', toJSON: jest.fn() };
  
      jest.spyOn(cameraService, 'updateAvailableCameras').mockResolvedValue([mockCamera]);
      jest.spyOn(cameraService, 'getCameraFromAvailables').mockResolvedValue(mockCamera);
  
      const result = await cameraService.getCameraFlow();
  
      expect(result).toBe(mockCamera);
      expect(cameraService.handleCameraErrors).not.toHaveBeenCalled();
    });
  });


  });


