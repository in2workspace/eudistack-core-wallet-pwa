import { CameraLogsService } from './../../services/camera-logs.service';
import { CommonModule } from '@angular/common';
import { v4 as uuidv4 } from 'uuid';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ViewChild,
  WritableSignal,
  NgZone,
  effect,
  inject
} from '@angular/core';
import { BarcodeFormat, Exception } from '@zxing/library';
import { BrowserQRCodeReader } from '@zxing/browser';
import {
  BehaviorSubject,
  Observable,
  Subject,
  debounceTime,
  distinctUntilChanged,
  filter,
  interval,
  map,
  shareReplay,
  switchMap,
  take,
  takeUntil
} from 'rxjs';
import { CameraLogType } from 'src/app/core/models/camera-log';
import { CameraService } from 'src/app/shared/services/camera.service';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { IonicModule } from '@ionic/angular';

// ! Since console.error is intercepted (to capture the error already caught by zxing), be careful to avoid recursion
// ! (i.e., console.error should not be called within the execution flow of another console.error)

// When a scanner component is created, it waits until the "destroying scanner list" is empty.
// A scanner component (its id) is removed from such list not right after being destroyed, but after some delay.
// This delay is needed because the activation process requires some time to be completed, so that if the component is
// destroyed during this process, the camera is not deactivated and the next activation might be blocked

@Component({
  selector: 'app-barcode-scanner',
  templateUrl: './barcode-scanner.component.html',
  styleUrl: './barcode-scanner.component.scss',
  imports: [CommonModule, RouterModule, TranslateModule, IonicModule]
})
export class BarcodeScannerComponent implements OnInit, AfterViewInit, OnDestroy {
  @Output() public qrCode: EventEmitter<string> = new EventEmitter();
  @ViewChild('scanner') public scannerVideoRef!: ElementRef<HTMLVideoElement>;
  public allowedFormats = [BarcodeFormat.QR_CODE];
  public firstActivationCompleted = false;
  public scannerEnabled = false;
  public scannerDevice: MediaDeviceInfo | undefined = undefined;
  private readonly scannerId = uuidv4();
  private readonly ngZone = inject(NgZone);

  private activeStream: MediaStream | null = null;
  private reader: BrowserQRCodeReader | null = null;
  private rafId = 0;
  private readonly canvas: HTMLCanvasElement = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D = this.canvas.getContext('2d')!;
  private scanLoopRunning = false;
  private lastEmittedResult: string | null = null;

  // COUNTDOWN
  public readonly isError$ = this.cameraService.isCameraError$;
  private readonly activationTimeoutInSeconds = 1;
  private readonly _activatedScanner$$ = new Subject<void>();
  readonly activatedScanner$$: Observable<void> = this._activatedScanner$$.pipe(
    takeUntilDestroyed()
  );
  private readonly activationCountdown$ = this.activatedScanner$$.pipe(
    switchMap(() => interval(1000)
      .pipe(
        take(this.activationTimeoutInSeconds + 1),
        takeUntil(this.destroy$),
        map(seconds => this.activationTimeoutInSeconds * 1000 - seconds * 1000),
      )
    ),
    shareReplay(1),
  );
  private readonly activationCountdownValue$ = toSignal(this.activationCountdown$, {initialValue:6000});

  public readonly selectedDevice$: WritableSignal<MediaDeviceInfo|undefined> = this.cameraService.selectedCamera$;
  private readonly updateScannerDeviceEffect = effect(async () => {
    const selectedDevice = this.selectedDevice$();
    if(this.firstActivationCompleted && selectedDevice && this.scannerDevice !== selectedDevice){
      let hasPermission = undefined;
      // if there is already a device, sometimes the askForPemission causes error
      if(!this.scannerDevice){
        console.log('Scanner has no device: ask for permission.');
        try{
          hasPermission = await this.askForPermission();
        }catch(err){
          console.error('Barcode-scanner: error when trying to get permission before settings new device.');
          console.error(err);
          hasPermission = false;
        }
      }
      if(hasPermission !== false){
        setTimeout(() => {
          this.scannerDevice = selectedDevice;
          this.applyDevice(selectedDevice);
          this._activatedScanner$$.next();
        }, 200);
      }else{
        console.error('SCANNER: Permission denied');
      }
    }
  });
  private readonly isActivatingScanner$ = toSignal(this.cameraService.activatingScannersList$);
  private readonly scanFailureSubject = new Subject<Error>();
  private readonly scanFailureDebounceDelay = 3000;
  private originalConsoleError: undefined|((...data: any[]) => void);

  public scanSuccess$ = new BehaviorSubject<string>('');
  public destroy$ = new Subject<void>();


  public constructor(
    private readonly cameraService: CameraService,
    private readonly cameraLogsService: CameraLogsService
  ) {
    
    // Requires debounce since this type of error is emitted constantly
    this.scanFailureSubject.pipe(
      distinctUntilChanged((
        previous, current) =>
        JSON.stringify(previous) === JSON.stringify(current)),
      debounceTime(this.scanFailureDebounceDelay)
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe(err=>{
        this.saveErrorLog(err, 'scanFailure');
      });
 
  }

  public async ngOnInit(): Promise<void> {
    this.modifyConsoleErrorToHandleScannerErrors();
  }

  public async ngAfterViewInit(): Promise<void> {
    this.reader = new BrowserQRCodeReader();
    this.initCameraIfNoActivateScanners();
  }

  public ngOnDestroy(): void {
    this.destroy$.next();
    this.setActivatingTimeout();
    this.restoreOriginalConsoleError();
    this.cameraService.isCameraError$.set(false);
    this.stopScanLoop();
    this.releaseStream();
    this.destroy$.complete();
  }

  public async initCameraIfNoActivateScanners(): Promise<void>{
       //activate scanner once there are no other scanner in deactivation process
    const activatingScannersList = this.isActivatingScanner$();
    if (activatingScannersList?.length === 0) {
      const cameraFlowResult = await this.cameraService.getCameraFlow();
         if(cameraFlowResult === 'NO_CAMERA_AVAILABLE' || cameraFlowResult === 'PERMISSION_DENIED'){
        console.warn('SCANNER: camera flow not completed; scanner will not be activated.');
        return;
      }
      this.activateScannerInitially();
    } else {
         console.warn('SCANNER: there is at least one active scanner, waiting before starting next camera flow.')
      this.cameraService.activatingScannersList$
        .pipe(
          filter(value => value.length === 0),
          takeUntil(this.destroy$),
          take(1),
        )
        .subscribe(async () => {
          const cameraFlowResult = await this.cameraService.getCameraFlow();
             if(cameraFlowResult === 'NO_CAMERA_AVAILABLE' || cameraFlowResult === 'PERMISSION_DENIED'){
            return;
          }
          this.activateScannerInitially();
        });
    }
  }

  public async activateScanner(): Promise<void>{
    this.scannerEnabled = true;
    const hasPermission = await this.askForPermission();
    if(this.scannerDevice?.deviceId !== this.selectedDevice$()?.deviceId && hasPermission){
      this.scannerDevice = this.selectedDevice$();
      await this.applyDevice(this.selectedDevice$());
      this._activatedScanner$$.next();
    }
  }

  public async activateScannerInitially(): Promise<void>{
    await this.activateScanner();
    this.firstActivationCompleted = true;
  }

  public onCodeResult(resultString: string): void {
    if (resultString === this.lastEmittedResult) return;
    this.lastEmittedResult = resultString;
    this.qrCode.emit(resultString);
  }

  public onScanError(error: Error): void{
    this.saveErrorLog(error, 'scanError');
  }

  public onScanFailure(error: Exception|undefined): void{
    const exception: Error = error ?? new Error('Undefined scan failure');
    this.scanFailureSubject.next(exception);
  }

  public saveErrorLog(error: Error|undefined, exceptionType: CameraLogType): void {
    this.cameraLogsService.addCameraLog(error, exceptionType);
  }

  public modifyConsoleErrorToHandleScannerErrors(): void {
    this.originalConsoleError = console.error;
    console.error = (message?: string, ...optionalParams: any[]) => {
      // TODO: for now all error logs are being stored, but this should be reviewed if more control is needed
     
      if (this.originalConsoleError) {
        this.originalConsoleError(message, ...optionalParams);
      }
    
    };
  }

  public restoreOriginalConsoleError(): void{
    if(this.originalConsoleError) {
      console.error = this.originalConsoleError;
    }
  }

  public async askForPermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  private async applyDevice(device: MediaDeviceInfo | undefined): Promise<void> {
    this.stopScanLoop();
    this.releaseStream();

    if (!device || !this.scannerEnabled) return;

    try {
      this.activeStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: device.deviceId } }
      });

      const video = this.scannerVideoRef?.nativeElement;
      if (!video) return;

      video.srcObject = this.activeStream;
      await video.play();
      this.startScanLoop(video);
    } catch (err: any) {
      console.error('@zxing/browser', err?.message ?? 'Stream error', err?.name);
    }
  }

  private startScanLoop(video: HTMLVideoElement): void {
    if (this.scanLoopRunning) return;
    this.scanLoopRunning = true;
    this.ngZone.runOutsideAngular(() => {
      this.scheduleFrame(video);
    });
  }

  private scheduleFrame(video: HTMLVideoElement): void {
    if (!this.scanLoopRunning || !this.scannerEnabled) return;
    this.rafId = requestAnimationFrame(() => this.processFrame(video));
  }

  private async processFrame(video: HTMLVideoElement): Promise<void> {
    if (!this.scanLoopRunning || !this.scannerEnabled) return;
    if (video.readyState < 2) { this.scheduleFrame(video); return; }

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) { this.scheduleFrame(video); return; }

    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(video, 0, 0, w, h);

    try {
      const result = await this.reader!.decodeFromCanvas(this.canvas);
      if (result) {
        this.ngZone.run(() => {
          this.onCodeResult(result.getText());
        });
      }
    } catch (err: any) {
      if (err?.name === 'NotFoundException') {
        this.onScanFailure(err as Exception);
      } else {
        this.ngZone.run(() => {
          this.onScanError(err as Error);
        });
      }
    }

    this.scheduleFrame(video);
  }

  private stopScanLoop(): void {
    this.scanLoopRunning = false;
    cancelAnimationFrame(this.rafId);
  }

  private releaseStream(): void {
    this.activeStream?.getTracks().forEach(t => t.stop());
    this.activeStream = null;
    const video = this.scannerVideoRef?.nativeElement;
    if (video) video.srcObject = null;
  }

  private setActivatingTimeout(): void {
    this.cameraService.addActivatingScanner(this.scannerId);
    const activationCountDownValue = this.activationCountdownValue$();
    console.warn('Scanner activation countdown value: ' + activationCountDownValue + ' ms');
    setTimeout(() => {
      console.warn('Scanner destroyed after ' + activationCountDownValue);
      this.scannerEnabled = false;
      this.stopScanLoop();
      this.releaseStream();
      this.cameraService.removeActivatingScanner(this.scannerId);
    }, activationCountDownValue);
  }
}

export function formatLogMessage(message: any, optionalParams: any[]): string {
  const optionalParam1 = optionalParams.length > 0 ? optionalParams[0] : '';
  const optionalParam2 = optionalParams.length > 1 ? optionalParams[1] : '';
  return `${String(message)}. ${String(optionalParam1)} ${String(optionalParam2)}`;
}