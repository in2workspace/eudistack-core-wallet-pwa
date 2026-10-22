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
  type ReaderPrototype = { getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> };
  const prototype = BrowserCodeReader.prototype as unknown as ReaderPrototype;
  const originalReaderGetUserMedia = prototype.getUserMedia;
  const originalMediaDevices = navigator.mediaDevices;
  const readerGetUserMedia = (constraints: MediaStreamConstraints): Promise<MediaStream> =>
    prototype.getUserMedia!(constraints);

  function mockBrowser(getUserMedia: jest.Mock): void {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    requestHighResolutionScannerStream();
  }

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true });
  });

  afterAll(() => {
    prototype.getUserMedia = originalReaderGetUserMedia;
  });

  it('relies on zxing still exposing getUserMedia on BrowserCodeReader', () => {
    expect(typeof originalReaderGetUserMedia).toBe('function');
  });

  it('does not patch the zxing reader twice', () => {
    mockBrowser(jest.fn());
    const patched = prototype.getUserMedia;

    requestHighResolutionScannerStream();

    expect(prototype.getUserMedia).toBe(patched);
    expect(patched).not.toBe(originalReaderGetUserMedia);
  });

  it('warns and leaves the reader untouched when zxing no longer exposes getUserMedia', () => {
    const current = prototype.getUserMedia;
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    delete prototype.getUserMedia;

    requestHighResolutionScannerStream();

    expect(prototype.getUserMedia).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('BrowserCodeReader.getUserMedia not found'));
    prototype.getUserMedia = current;
    warn.mockRestore();
  });

  it('asks the camera first for the minimum resolution', async () => {
    const getUserMedia = jest.fn().mockResolvedValue(fakeStream);
    mockBrowser(getUserMedia);

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

  it('falls back right away to the ideal resolution on a camera that cannot reach the minimum (e.g. 640x480 only)', async () => {
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

  it('propagates the error when the fallback request also fails', async () => {
    const getUserMedia = jest.fn()
      .mockRejectedValueOnce({ name: 'OverconstrainedError' })
      .mockRejectedValueOnce({ name: 'NotFoundError' });
    mockBrowser(getUserMedia);

    await expect(readerGetUserMedia({ video: { deviceId: 'cam' } })).rejects.toEqual({ name: 'NotFoundError' });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
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
