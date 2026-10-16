import { TestBed } from '@angular/core/testing';
import { UserActivityService } from './user-activity.service';

describe('UserActivityService', () => {
  let service: UserActivityService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = TestBed.inject(UserActivityService);
  });

  afterEach(() => jest.useRealTimers());

  it.each(['pointerdown', 'keydown', 'wheel', 'touchstart'])('reports a %s as activity', type => {
    const seen = jest.fn();
    const subscription = service.activity$.subscribe(seen);

    document.dispatchEvent(new Event(type));

    expect(seen).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });

  it('reports at most one activity per second', () => {
    const seen = jest.fn();
    const subscription = service.activity$.subscribe(seen);

    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('keydown'));
    jest.advanceTimersByTime(500);
    document.dispatchEvent(new Event('wheel'));
    expect(seen).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(600);
    document.dispatchEvent(new Event('pointerdown'));
    expect(seen).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it('ignores events that are not user interaction', () => {
    const seen = jest.fn();
    const subscription = service.activity$.subscribe(seen);

    document.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(seen).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });
});
