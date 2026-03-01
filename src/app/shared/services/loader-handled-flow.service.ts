import { Injectable } from '@angular/core';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { AppError } from 'src/app/core/models/error/AppError';

@Injectable({ providedIn: 'root' })
export class LoaderHandledFlowService {
  constructor(
    private readonly loader: LoaderService,
    private readonly toastServiceHandler: ToastServiceHandler
  ) {}

  async run<T>(params: {
    fn: () => Promise<T>;
    logPrefix: string;
    errorToTranslationKey: (e: unknown) => string | null;
  }): Promise<T> {
    this.loader.addLoadingProcess();

    try {
      return await params.fn();
    } catch (e: unknown) {
      if (e instanceof AppError) {
        console.error(`${params.logPrefix} Flow failed:`, {
          message: e.message,
          code: e.code,
          cause: e.cause,
        });
      } else {
        console.error(`${params.logPrefix} Flow failed:`, e);
      }

      const msg = params.errorToTranslationKey(e);
      if (msg) {
        this.toastServiceHandler.showErrorAlertByTranslateLabel(msg).subscribe();
      }

      throw e;
    } finally {
      this.loader.removeLoadingProcess();
    }
  }
}