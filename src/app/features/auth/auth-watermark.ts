/**
 * Decorative watermark of the auth screens (`.auth-watermark` in login.page.scss):
 * the artwork of the current step, drawn as a CSS mask over the tenant tint.
 * Shared by LoginPage (browser mode) and AccessPage (server mode).
 */
export type WatermarkShape = 'access' | 'email' | 'verify' | 'passkey';

const WATERMARK_ASSETS: Record<WatermarkShape, string> = {
  access: 'assets/svg/download-solid.svg',
  email: 'assets/svg/user-solid.svg',
  verify: 'assets/svg/envelope-circle-check-solid.svg',
  passkey: 'assets/svg/door-open-solid.svg',
};

const WATERMARK_VIEWBOX_WIDTH = 672;

const WATERMARK_CROP_TOP = 200;

export function watermarkStyle(shape: WatermarkShape | null): Record<string, string> {
  if (!shape) return { display: 'none' };

  const image = `url('${new URL(WATERMARK_ASSETS[shape], document.baseURI).href}')`;
  const position = `left calc(var(--wm-width) * ${WATERMARK_CROP_TOP} / -${WATERMARK_VIEWBOX_WIDTH})`;

  return {
    'mask-image': image,
    'mask-repeat': 'no-repeat',
    'mask-size': 'contain',
    'mask-position': position,
  };
}
