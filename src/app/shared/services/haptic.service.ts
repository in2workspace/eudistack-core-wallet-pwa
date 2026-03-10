import { Injectable } from '@angular/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

@Injectable({
  providedIn: 'root',
})
export class HapticService {

  private readonly isNative = Capacitor.isNativePlatform();

  async impact(style: ImpactStyle = ImpactStyle.Medium): Promise<void> {
    if (this.isNative) {
      await Haptics.impact({ style });
    } else {
      this.vibrateWeb(50);
    }
  }

  async notification(type: NotificationType = NotificationType.Success): Promise<void> {
    if (this.isNative) {
      await Haptics.notification({ type });
    } else {
      this.vibrateWeb(type === NotificationType.Success ? [50, 30, 50] : 100);
    }
  }

  private vibrateWeb(pattern: number | number[]): void {
    try {
      navigator?.vibrate?.(pattern);
    } catch { /* not supported */ }
  }
}
