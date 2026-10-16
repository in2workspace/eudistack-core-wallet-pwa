import { CameraLog } from 'src/app/core/models/camera-log';
import { CameraLogsService } from '../../../shared/services/camera-logs.service';
import { Component, inject, OnInit } from '@angular/core';
import { IonicModule, InfiniteScrollCustomEvent  } from '@ionic/angular';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-view-logs',
    templateUrl: './camera-logs.page.html',
    styleUrls: ['./camera-logs.page.scss'],
    imports: [IonicModule, DatePipe, TranslateModule]
})
export class CameraLogsPage implements OnInit {
  private readonly cameraLogsService = inject(CameraLogsService);

  public cameraLogs: CameraLog[] = [];
  public displayedLogs: CameraLog[] = [];
  private readonly logsBatchSize = 10;
  public scrollThreshold = '20%';
  private currentIndex = 0;


  ngOnInit(): void {
    this.loadInitialLogs()
      .catch(error => console.error('Error loading camera logs:', error));
  }

  private async loadInitialLogs(): Promise<void> {
    this.cameraLogs = await this.cameraLogsService.getCameraLogs();
    await this.loadLogs('INITIAL');
  }

  async loadLogs(event: InfiniteScrollCustomEvent|'INITIAL'): Promise<void> {
    const nextIndex = this.currentIndex + this.logsBatchSize;
    const newLogs = this.cameraLogs.slice(this.currentIndex, nextIndex);
    this.displayedLogs = [...this.displayedLogs, ...newLogs];
    this.currentIndex = nextIndex;

    if(event!=='INITIAL' && event?.target){
      const completed = event.target.complete();

      if (this.displayedLogs.length >= this.cameraLogs.length) {
        event.target.disabled = true;
      }
      await completed;
    }
  }

}
