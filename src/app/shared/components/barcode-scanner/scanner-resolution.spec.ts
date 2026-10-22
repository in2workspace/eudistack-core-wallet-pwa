import { BrowserCodeReader } from '@zxing/browser';
import { requestHighResolutionScannerStream, withScannerResolution } from './scanner-resolution';

const fakeStream = {} as MediaStream;

describe('withScannerResolution', () => {
  it('adds the ideal resolution to any object video request', () => {
    expect(withScannerResolution({ video: { deviceId: { exact: 'cam' } } })).toEqual({
      video: { deviceId: { exact: 'cam' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    expect(withScannerResolution({ video: { facingMode: 'environment' } })).toEqual({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
  });

  it('adds a minimum side on both axes when required', () => {
    expect(withScannerResolution({ video: { deviceId: 'cam' } }, true)).toEqual({
      video: { deviceId: 'cam', width: { min: 720, ideal: 1920 }, height: { min: 720, ideal: 1080 } }
    });
  });

  it('leaves requests with explicit size, boolean video or no constraints untouched', () => {
    const sized = { video: { deviceId: 'cam', width: 640 } };
    const boolean = { video: true };
    expect(withScannerResolution(sized, true)).toBe(sized);
    expect(withScannerResolution(boolean, true)).toBe(boolean);
    expect(withScannerResolution(undefined, true)).toBeUndefined();
  });
});

describe('requestHighResolutionScannerStream', () => {
  const originalMediaDevices = navigator.mediaDevices;
  const readerGetUserMedia = (constraints: MediaStreamConstraints): Promise<MediaStream> =>
    (BrowserCodeReader.prototype as unknown as { getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream> })
      .getUserMedia(constraints);

  function mockBrowser(getUserMedia: jest.Mock): void {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    requestHighResolutionScannerStream();
  }

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true });
  });

  it('patches the zxing reader once and asks first for the minimum resolution', async () => {
    const getUserMedia = jest.fn().mockResolvedValue(fakeStream);
    mockBrowser(getUserMedia);
    const patched = (BrowserCodeReader.prototype as unknown as { getUserMedia: unknown }).getUserMedia;
    requestHighResolutionScannerStream();

    expect((BrowserCodeReader.prototype as unknown as { getUserMedia: unknown }).getUserMedia).toBe(patched);
    await readerGetUserMedia({ video: { deviceId: { exact: 'cam' } } });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { deviceId: { exact: 'cam' }, width: { min: 720, ideal: 1920 }, height: { min: 720, ideal: 1080 } }
    });
  });

  it('keeps working when the browser getUserMedia is replaced afterwards', async () => {
    mockBrowser(jest.fn());
    const replaced = jest.fn().mockResolvedValue(fakeStream);
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: replaced }, configurable: true });

    await readerGetUserMedia({ video: { deviceId: 'cam' } });

    expect(replaced).toHaveBeenCalledWith({
      video: { deviceId: 'cam', width: { min: 720, ideal: 1920 }, height: { min: 720, ideal: 1080 } }
    });
  });

  it('falls back to the ideal resolution right away when the camera cannot reach the minimum', async () => {
    jest.useFakeTimers();
    const getUserMedia = jest.fn()
      .mockRejectedValueOnce({ name: 'OverconstrainedError' })
      .mockResolvedValueOnce(fakeStream);
    mockBrowser(getUserMedia);

    await readerGetUserMedia({ video: { deviceId: 'cam' } });

    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { deviceId: 'cam', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
  });

  it.each(['NotAllowedError', 'NotReadableError', 'AbortError'])(
    'propagates %s without retrying so CameraService keeps handling it',
    async name => {
      const getUserMedia = jest.fn().mockRejectedValue({ name });
      mockBrowser(getUserMedia);

      await expect(readerGetUserMedia({ video: { deviceId: 'cam' } })).rejects.toEqual({ name });
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    }
  );

  it('passes boolean video requests through unchanged', async () => {
    const getUserMedia = jest.fn().mockResolvedValue(fakeStream);
    mockBrowser(getUserMedia);

    await readerGetUserMedia({ video: true });

    expect(getUserMedia).toHaveBeenCalledWith({ video: true });
  });
});
