import { Injectable } from '@angular/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

@Injectable({
  providedIn: 'root',
})
export class HapticService {

  private readonly isNative = Capacitor.isNativePlatform();

  async impact(style: ImpactStyle = ImpactStyle.Medium): Promise<void> {
    if (!this.isNative) {
      return;
    }
    await Haptics.impact({ style });
  }

  async notification(type: NotificationType = NotificationType.Success): Promise<void> {
    if (!this.isNative) {
      return;
    }
    await Haptics.notification({ type });
  }
}
