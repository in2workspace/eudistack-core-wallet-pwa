import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { CameraLogsPage } from './camera-logs.page';
import { InfiniteScrollCustomEvent, IonicModule } from '@ionic/angular';
import { DatePipe } from '@angular/common';
import { CameraLogsService } from 'src/app/shared/services/camera-logs.service';
import { Storage } from '@ionic/storage-angular';
import { TranslateModule } from '@ngx-translate/core';

const flushPromises = () => new Promise(resolve => setTimeout(resolve));

describe('CameraLogsPage', () => {
  let component: CameraLogsPage;
  let fixture: ComponentFixture<CameraLogsPage>;
  let cameraLogsService: CameraLogsService;

  const mockCameraLogsService = {
    getCameraLogs: jest.fn()
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [IonicModule, DatePipe, TranslateModule.forRoot()],
      providers: [
        { provide: CameraLogsService, useValue: mockCameraLogsService },
        Storage
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CameraLogsPage);
    component = fixture.componentInstance;
    cameraLogsService = TestBed.inject(CameraLogsService);
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load camera logs on initialization', async () => {
    const mockLogs = [{ id: 1, log: 'Camera log 1' }];
    mockCameraLogsService.getCameraLogs.mockResolvedValue(mockLogs);

    component.ngOnInit();
    await flushPromises();

    expect(mockCameraLogsService.getCameraLogs).toHaveBeenCalled();
    expect(component.cameraLogs).toEqual(mockLogs);
  });

  it('should load more logs when infinite scroll is triggered', async () => {
    const mockLogs = [
      { id: 1, message: 'Log 1', date: new Date() },
      { id: 2, message: 'Log 2', date: new Date() },
      { id: 3, message: 'Log 3', date: new Date() },
      { id: 4, message: 'Log 4', date: new Date() },
    ];
    (component as any).logsBatchSize = 2;
    
    mockCameraLogsService.getCameraLogs.mockResolvedValue(mockLogs);
    component.ngOnInit();
    await flushPromises();
  
    expect(component.displayedLogs.length).toBe(2);
    expect(component.displayedLogs).toEqual(mockLogs.slice(0, 2));

    const mockInfiniteScrollEvent = {
      target: {
        complete: jest.fn(),
        disabled: false
      }
    } as unknown as InfiniteScrollCustomEvent;
  
    component.loadLogs(mockInfiniteScrollEvent);
  
    expect(component.displayedLogs.length).toBe(4);
    expect(component.displayedLogs).toEqual(mockLogs);
  
    expect(mockInfiniteScrollEvent.target.complete).toHaveBeenCalled();
    expect(mockInfiniteScrollEvent.target.disabled).toBe(true);
  });

  it('should log, not throw, when the stored logs cannot be loaded', async () => {
    const failure = new Error('storage unavailable');
    mockCameraLogsService.getCameraLogs.mockRejectedValue(failure);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    expect(() => component.ngOnInit()).not.toThrow();
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading camera logs:', failure);
    expect(component.displayedLogs).toEqual([]);
    consoleErrorSpy.mockRestore();
  });
  
});
