import { BrowserCodeReader } from '@zxing/browser';

export const SCANNER_IDEAL_RESOLUTION = { width: 1920, height: 1080 };
export const SCANNER_MIN_SIDE = 720;
export const SCANNER_MIN_RETRIES = 2;
export const SCANNER_RETRY_DELAY_MS = 300;

const highResolutionMarker = Symbol('highResolutionScannerStream');

type GetUserMedia = ((constraints: MediaStreamConstraints) => Promise<MediaStream>) & { [highResolutionMarker]?: true };
type PatchableReader = { getUserMedia: GetUserMedia };

export function requestHighResolutionScannerStream(): void {
  const prototype = BrowserCodeReader.prototype as unknown as PatchableReader;
  const original = prototype.getUserMedia;
  if (!original || original[highResolutionMarker]) {
    return;
  }
  const patched = async function (this: unknown, constraints: MediaStreamConstraints): Promise<MediaStream> {
    const required = withScannerResolution(constraints, true) as MediaStreamConstraints;
    if (required === constraints) {
      return original.call(this, constraints);
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return await original.call(this, required);
      } catch (error) {
        if (!isOverconstrained(error)) {
          throw error;
        }
        if (attempt >= SCANNER_MIN_RETRIES) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, SCANNER_RETRY_DELAY_MS * (attempt + 1)));
      }
    }
    const fallback = withScannerResolution(constraints, false) as MediaStreamConstraints;
    return original.call(this, fallback);
  };
  Object.defineProperty(patched, highResolutionMarker, { value: true });
  prototype.getUserMedia = patched;
}

export function withScannerResolution(
  constraints?: MediaStreamConstraints,
  requireMinimum = false
): MediaStreamConstraints | undefined {
  const video = constraints?.video;
  if (!video || typeof video !== 'object' || video.width || video.height) {
    return constraints;
  }
  const min = requireMinimum ? { min: SCANNER_MIN_SIDE } : {};
  return {
    ...constraints,
    video: {
      ...video,
      width: { ...min, ideal: SCANNER_IDEAL_RESOLUTION.width },
      height: { ...min, ideal: SCANNER_IDEAL_RESOLUTION.height },
    },
  };
}

function isOverconstrained(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError';
}
