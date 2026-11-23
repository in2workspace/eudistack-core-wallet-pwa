import { DeviceType } from 'src/app/core/utils/device-proposal';

/** Ionicon of each type of device (EUD-15 wireframes: mobile, tablet or desktop). */
export function deviceTypeIcon(type: DeviceType): string {
  switch (type) {
    case 'mobile':
      return 'phone-portrait-outline';
    case 'tablet':
      return 'tablet-portrait-outline';
    default:
      return 'desktop-outline';
  }
}
