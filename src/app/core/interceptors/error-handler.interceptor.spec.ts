import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HTTP_INTERCEPTORS, HttpClient } from '@angular/common/http';
import { ToastServiceHandler } from '../../shared/services/toast.service';
import { HttpErrorInterceptor } from './error-handler.interceptor';
import { AuthService } from '../services/auth.service';
import { SERVER_PATH } from '../constants/api.constants';
import { environment } from 'src/environments/environment';

class MockToastServiceHandler {
  showErrorAlert(message: string) {
  }
}

describe('HttpErrorInterceptor with HttpClient', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;
  let mockToastServiceHandler: MockToastServiceHandler;
  let mockAuthService: { forceLogout: jest.Mock };

  beforeAll(() => {
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost' },
      writable: true,
  });
});

  beforeEach(() => {
    mockToastServiceHandler = new MockToastServiceHandler();
    mockAuthService = { forceLogout: jest.fn() };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: HTTP_INTERCEPTORS,
          useClass: HttpErrorInterceptor,
          multi: true,
        },
        {
          provide: ToastServiceHandler,
          useValue: mockToastServiceHandler
        },
        {
          provide: AuthService,
          useValue: mockAuthService
        }
      ],
    });

    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('CREDENTIALS empty-list → handled silently (TRUE branch)', () => {
  const toastSpy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');
  const logSpy = jest.spyOn(console, 'error');

  const url = `http://localhost/${SERVER_PATH.CREDENTIALS}?page=1`;
  httpClient.get(url).subscribe({
    error: (e) => {
      expect(e).toBeTruthy();
      expect(logSpy).toHaveBeenCalledWith('Handled silently:', 'The credentials list is empty');
      expect(toastSpy).not.toHaveBeenCalled();
    },
  });

  const req = httpMock.expectOne(url);
  req.flush({ message: 'The credentials list is empty' }, { status: 400, statusText: 'Bad Request' });
});

  it('CREDENTIALS empty-list but different path → NOT matched (FALSE branch), shows toast', () => {
    const toastSpy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');
    const url = `http://localhost/api/not-credentials`; // NO acaba amb CREDENTIALS

    httpClient.get(url).subscribe({ error: () => {
      expect(toastSpy).toHaveBeenCalledWith('The credentials list is empty'); // cau a flux genèric
    }});

    const req = httpMock.expectOne(url);
    req.flush({ message: 'The credentials list is empty' }, { status: 500, statusText: 'Internal Server Error' });
  });

  it('NOT VERIFIABLE_PRESENTATION (FALSE branch) → shows toast', () => {
    const toastSpy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');

    const url = `http://localhost/other-endpoint`;
    httpClient.get(url).subscribe({ error: () => {
      expect(toastSpy).toHaveBeenCalledWith('Test error message');
    }});

    const req = httpMock.expectOne(url);
    req.flush({ message: 'Test error message' }, { status: 400, statusText: 'Bad Request' });
  });

  it('CREDENTIALS_SIGNED_BY_ID → handled silently (TRUE branch)', () => {
    const toastSpy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');
    const logSpy = jest.spyOn(console, 'error');

    const url = `http://localhost/${SERVER_PATH.CREDENTIALS_SIGNED_BY_ID}?id=123`;
    httpClient.get(url).subscribe({ error: (e) => {
      expect(e).toBeTruthy();
      expect(logSpy).toHaveBeenCalledWith('Handled silently:', 'Test error message');
      expect(toastSpy).not.toHaveBeenCalled();
    }});

    const req = httpMock.expectOne(url);
    req.flush({ message: 'Test error message' }, { status: 400, statusText: 'Bad Request' });
  });

  it('NOT CREDENTIALS_SIGNED_BY_ID (FALSE branch) → shows toast', () => {
    const toastSpy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');

    const url = `http://localhost/credentials/something-else`;
    httpClient.get(url).subscribe({ error: () => {
      expect(toastSpy).toHaveBeenCalledWith('Oops');
    }});

    const req = httpMock.expectOne(url);
    req.flush({ message: 'Oops' }, { status: 500, statusText: 'Internal Server Error' });
  });

  it('Timeout but NOT REQUEST_CREDENTIAL (FALSE branch) → keeps backend message', () => {
    const toastSpy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');

    const url = `http://localhost/another-endpoint`;
    httpClient.get(url).subscribe({ error: () => {
      expect(toastSpy).toHaveBeenCalledWith('Gateway Timeout');
    }});

    const req = httpMock.expectOne(url);
    req.flush({ message: 'Gateway Timeout' }, { status: 504, statusText: 'Gateway Timeout' });
  });

    it('should log and show a toast on a 404 Not Found response', () => {
      const spy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');

      httpClient.get('/test404').subscribe({
        error: (error) => {
          expect(spy).toHaveBeenCalledWith('Resource not found message from backend');
        }
      });

      const req = httpMock.expectOne('/test404');
      req.flush({message: 'Resource not found message from backend'}, { status: 404, statusText: 'Not Found' });
    });

    it('NOT EXECUTE_CONTENT (FALSE branch) → falls back to generic flow', () => {
    const toastSpy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');

    const url = `http://localhost/not-execute-content`;
    httpClient.get(url).subscribe({ error: () => {
      expect(toastSpy).toHaveBeenCalledWith('Some backend error');
    }});

    const req = httpMock.expectOne(url);
    req.flush({ message: 'Some backend error' }, { status: 400, statusText: 'Bad Request' });
  });

  it('should show error toast on 422 Unprocessable Entity response', () => {
    const expectedMessage = 'Unprocessable Entity';
    const spy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');

    httpClient.get('/test422').subscribe({
      error: (error) => {
        expect(spy).toHaveBeenCalledWith(expectedMessage);
      }
    });

    const req = httpMock.expectOne('/test422');
    req.flush({ message: expectedMessage }, { status: 422, statusText: 'Unprocessable Entity' });
  });

  it('should show error toast on 500 Internal Server Error response', () => {
    const expectedMessage = 'Internal Server Error';
    const spy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');

    httpClient.get('/test500').subscribe({
      error: (error) => {
        expect(spy).toHaveBeenCalledWith(expectedMessage);
      }
    });

    const req = httpMock.expectOne('/test500');
    req.flush({ message: expectedMessage }, { status: 500, statusText: 'Internal Server Error' });
  });

  it('should log and show a toast on a generic HTTP error response', () => {
    const errorMessage = 'An error occurred';
    const spy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');

    httpClient.get('/testError').subscribe({
      error: (error) => {
        expect(spy).toHaveBeenCalledWith(errorMessage);
      }
    });

    const req = httpMock.expectOne('/testError');
    req.flush({message: errorMessage}, { status: 500, statusText: 'Internal Server Error' });
  });

    it('should handle errors silently for request signature URI', () => {
    const testUrl = SERVER_PATH.CREDENTIALS_SIGNED_BY_ID;
    const spy = jest.spyOn(console, 'error');

    httpClient.get(testUrl).subscribe({
      error: (error) => {
        expect(spy).toHaveBeenCalledWith('Handled silently:', 'Test error message');
        expect(error).toBeTruthy();
      },
    });

    const req = httpMock.expectOne(testUrl);
    req.flush(
      { message: 'Test error message' },
      { status: 400, statusText: 'Bad Request' }
    );
  });

  it('should handle errors silently for auth endpoints', () => {
    const testUrl = `${environment.server_url}/api/v1/auth/register`;
    const spy = jest.spyOn(console, 'error');

    httpClient.post(testUrl, {}).subscribe({
      error: (error) => {
        expect(spy).toHaveBeenCalledWith('Handled silently:', 'Test error message');
        expect(error).toBeTruthy();
      },
    });

    const req = httpMock.expectOne(testUrl);
    req.flush(
      { message: 'Test error message' },
      { status: 400, statusText: 'Bad Request' }
    );
  });

  it('should show a toast with "PIN expired" on a 408 Request Timeout response', () => {
    const expectedMessage = 'PIN expired';
    const spy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');

    httpClient.get('/' + SERVER_PATH.REQUEST_CREDENTIAL).subscribe({
      error: (error) => {
        expect(spy).toHaveBeenCalledWith(expectedMessage);
      },
    });

    const req = httpMock.expectOne('/' + SERVER_PATH.REQUEST_CREDENTIAL);
    req.flush({ message: 'Request Timeout' }, { status: 408, statusText: 'Request Timeout' });
  });

  it('should show a toast with "PIN expired" on a 504 Gateway Timeout response', () => {
    const expectedMessage = 'PIN expired';
    const spy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');

    httpClient.get('/' + SERVER_PATH.REQUEST_CREDENTIAL).subscribe({
      error: (error) => {
        expect(spy).toHaveBeenCalledWith(expectedMessage);
      },
    });

    const req = httpMock.expectOne('/' + SERVER_PATH.REQUEST_CREDENTIAL);
    req.flush({ message: 'Gateway Timeout' }, { status: 504, statusText: 'Gateway Timeout' });
  });

  it('should handle silently when CREDENTIALS returns empty list message (no toast)', () => {
  const toastSpy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');
  const logSpy = jest.spyOn(console, 'error');

  const url = '/' + SERVER_PATH.CREDENTIALS + '?page=1&size=10';
  httpClient.get(url).subscribe({
    error: (err) => {
      expect(err).toBeTruthy();
      expect(logSpy).toHaveBeenCalledWith('Handled silently:', 'The credentials list is empty');
      expect(toastSpy).not.toHaveBeenCalled();
    }
  });

  const req = httpMock.expectOne(url);
  req.flush({ message: 'The credentials list is empty' }, { status: 400, statusText: 'Bad Request' });
});

it('should show toast for CREDENTIALS when message is not the empty list one', () => {
  const toastSpy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');
  const url = '/' + SERVER_PATH.CREDENTIALS;

  httpClient.get(url).subscribe({
    error: () => {
      expect(toastSpy).toHaveBeenCalledWith('Something went wrong');
    }
  });

  const req = httpMock.expectOne(url);
  req.flush({ message: 'Something went wrong' }, { status: 500, statusText: 'Internal Server Error' });
});

it('should keep backend message for REQUEST_CREDENTIAL when not a timeout', () => {
  const toastSpy = jest.spyOn(mockToastServiceHandler, 'showErrorAlert');
  const url = '/' + SERVER_PATH.REQUEST_CREDENTIAL;

  httpClient.get(url).subscribe({
    error: () => {
      expect(toastSpy).toHaveBeenCalledWith('Bad pin format');
    }
  });

  const req = httpMock.expectOne(url);
  req.flush({ message: 'Bad pin format' }, { status: 400, statusText: 'Bad Request' });
});


});