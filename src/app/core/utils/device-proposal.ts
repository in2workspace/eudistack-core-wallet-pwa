/** Type of a device, as the Wallet Unit Service stores it (EUD-15 `DeviceType`). */
export type DeviceType = 'mobile' | 'tablet' | 'desktop';

/** Longest device name, after trimming (EUD-15 FR-04, FR-12). */
export const DEVICE_NAME_MAX_LENGTH = 50;

/** What the Wallet App proposes for a new device: its type, the kind of equipment and the browser. */
export interface DeviceProposal {
  type: DeviceType;
  /** Kind of equipment: iPhone, iPad, Android, Mac, Windows, Linux, ChromeOS. */
  equipment: string;
  /** Browser, or `null` for the installed app (the name then says "App instalada"). */
  browser: string | null;
}

/** The subset of `navigator.userAgentData` the proposal reads (Chromium only). */
interface UserAgentDataLike {
  mobile?: boolean;
  platform?: string;
  brands?: { brand: string; version: string }[];
}

export interface DeviceEnvironment {
  userAgent: string;
  userAgentData?: UserAgentDataLike;
  maxTouchPoints: number;
  standalone: boolean;
}

/** The environment of this browser. */
export function currentDeviceEnvironment(): DeviceEnvironment {
  const nav = navigator as Navigator & { userAgentData?: UserAgentDataLike; standalone?: boolean };
  const standalone = nav.standalone === true
    || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return {
    userAgent: nav.userAgent ?? '',
    userAgentData: nav.userAgentData,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone,
  };
}

/**
 * Proposes the type and name of this device (EUD-15 FR-04, design §2.2): the kind of equipment and the browser
 * (`navigator.userAgentData` when the browser has it, the `userAgent` otherwise), or the installed app when it runs
 * as `display-mode: standalone`. It only helps the user recognise the device: it identifies nothing.
 */
export function proposeDevice(env: DeviceEnvironment = currentDeviceEnvironment()): DeviceProposal {
  const equipment = equipmentOf(env);
  return {
    type: typeOf(env, equipment),
    equipment,
    browser: env.standalone ? null : browserOf(env),
  };
}

/** The proposed name, with the text the Wallet App shows for the installed app (translated by the caller). */
export function deviceName(proposal: DeviceProposal, installedAppLabel: string): string {
  return `${proposal.equipment} · ${proposal.browser ?? installedAppLabel}`.slice(0, DEVICE_NAME_MAX_LENGTH);
}

/** Valid name: not empty after trimming and at most {@link DEVICE_NAME_MAX_LENGTH} characters. */
export function isValidDeviceName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && [...trimmed].length <= DEVICE_NAME_MAX_LENGTH;
}

function equipmentOf(env: DeviceEnvironment): string {
  const ua = env.userAgent;
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  // iPadOS 13+ asks for the desktop site: a "Macintosh" with touch is an iPad.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  const platform = env.userAgentData?.platform ?? '';
  if (/macOS/i.test(platform) || /Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/i.test(platform) || /Windows/.test(ua)) return 'Windows';
  if (/Linux/i.test(platform) || /Linux/.test(ua)) return 'Linux';
  return 'Web';
}

function typeOf(env: DeviceEnvironment, equipment: string): DeviceType {
  if (equipment === 'iPhone') return 'mobile';
  if (equipment === 'iPad') return 'tablet';
  if (equipment === 'Android') {
    const mobile = env.userAgentData?.mobile ?? /Mobile/.test(env.userAgent);
    return mobile ? 'mobile' : 'tablet';
  }
  return env.userAgentData?.mobile ? 'mobile' : 'desktop';
}

function browserOf(env: DeviceEnvironment): string {
  const brands = (env.userAgentData?.brands ?? []).map(b => b.brand);
  if (brands.some(b => /Microsoft Edge/.test(b))) return 'Edge';
  if (brands.some(b => /Opera/.test(b))) return 'Opera';
  const ua = env.userAgent;
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (brands.some(b => /Google Chrome|Chromium/.test(b)) || /Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Web';
}
