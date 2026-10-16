import { TestBed } from '@angular/core/testing';
import { RegistrationTicketService } from './registration-ticket.service';

describe('RegistrationTicketService', () => {
  afterEach(() => jest.useRealTimers());

  it('keeps the ticket in memory while it is valid', () => {
    const service = TestBed.inject(RegistrationTicketService);
    service.set('rt_1', 300);

    expect(service.get()).toBe('rt_1');
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('forgets it once expired', () => {
    jest.useFakeTimers();
    const service = TestBed.inject(RegistrationTicketService);
    service.set('rt_1', 300);

    jest.advanceTimersByTime(300_000);

    expect(service.get()).toBeNull();
  });
});
