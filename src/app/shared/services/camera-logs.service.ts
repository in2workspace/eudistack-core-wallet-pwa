import { inject, Injectable } from '@angular/core';
import { CameraLog, CameraLogType, LogsMailContent } from '../../core/models/camera-log';
import { StorageService } from './storage.service';
import { LOGS_EMAIL } from '../../core/constants/email.constants';
import { TranslateService } from '@ngx-translate/core';

export const LOGS_PREFIX = 'CAMERA_LOGS';

@Injectable({
  providedIn: 'root'
})
export class CameraLogsService {
  private readonly storageService = inject(StorageService);
  private readonly translate = inject(TranslateService);

  private cameraLogs: CameraLog[]|undefined = undefined;

  async getCameraLogs(): Promise<CameraLog[]> {
    if (!this.cameraLogs) {
      await this.fetchCameraLogs();
    }
    return this.cameraLogs || [];
  }

  public setCameraLogs(logs: CameraLog[]): void{
    this.cameraLogs = [...logs];
  }

  public async fetchCameraLogs(): Promise<void> {
    try {
      const unparsedStoredLogs = await this.storageService.get(LOGS_PREFIX);
      const storedLogs: CameraLog[] = unparsedStoredLogs ? JSON.parse(unparsedStoredLogs) : [];
      this.cameraLogs = [...storedLogs];

    } catch (error: any) {
      console.error('Error fetching logs:', error);
      this.addCameraLog(error.message || 'Unknown error', 'fetchError');
    }
  }  

  public async addCameraLog(err: Error | undefined, exceptionType: CameraLogType): Promise<void> {
    const log: CameraLog = {
      type: exceptionType,
      message: err?.message ?? 'undefined error',
      date: timestampUntilMinutes()
    };
  
    const storedLogs = await this.getCameraLogs();
    const updatedLogs = [...storedLogs, log];

    if(storedLogs.length >= 50){
      updatedLogs.splice(0, updatedLogs.length - 50);
    }

  
    await this.storageService.set(LOGS_PREFIX, JSON.stringify(updatedLogs));
    this.setCameraLogs(updatedLogs);
  }
  

  public async sendCameraLogs(): Promise<void> {
    const logs = await this.getCameraLogs();
  
    if (logs.length === 0) {
      this.translate.get('camera-logs.no-logs-found').subscribe((msg: string) => {
        alert(msg);
      });
      return;
    }
  
    const maxChars = 1500;
    let emailBody = '';
    
    const reversedLogs = [...logs].reverse();
    reversedLogs.some(log => {
      const logString = JSON.stringify(log);
      if ((emailBody.length + logString.length) > maxChars) {
        return true;
      }
      emailBody = logString + '\n' + emailBody;
      return false;
    });
  
    const msg: LogsMailContent = {
      subject: 'Camera Logs',
      body: emailBody.trim(),
    };
  
    const mailtoLink = `mailto:${LOGS_EMAIL}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.body)}`;
    
    const anchor = document.createElement('a');
    anchor.href = mailtoLink;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  public buildMailtoLink(): string | null {
    if (!this.cameraLogs || this.cameraLogs.length === 0) return null;

    const maxChars = 1500;
    let emailBody = '';
    const reversedLogs = [...this.cameraLogs].reverse();
    reversedLogs.some(log => {
      const logString = JSON.stringify(log);
      if ((emailBody.length + logString.length) > maxChars) return true;
      emailBody = logString + '\n' + emailBody;
      return false;
    });

    const msg: LogsMailContent = {
      subject: 'Camera Logs',
      body: emailBody.trim(),
    };

    return `mailto:${LOGS_EMAIL}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.body)}`;
  }

}

export function timestampUntilMinutes(){
  const timeStamp = new Date();
  return timeStamp.getFullYear() + "-" +
    String(timeStamp.getMonth() + 1).padStart(2, '0') + "-" +
    String(timeStamp.getDate()).padStart(2, '0') + " " +
    String(timeStamp.getHours()).padStart(2, '0') + ":" +
    String(timeStamp.getMinutes()).padStart(2, '0');
}
