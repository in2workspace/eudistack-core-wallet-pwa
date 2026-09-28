import { TestBed } from '@angular/core/testing';
import { SupportLinkPipe } from './support-link.pipe';
import { ToastServiceHandler } from '../services/toast.service';

describe('SupportLinkPipe', () => {
  let pipe: SupportLinkPipe;
  let toastServiceHandler: { renderSupportMessage: jest.Mock };

  beforeEach(() => {
    toastServiceHandler = {
      renderSupportMessage: jest.fn().mockImplementation((value: string) => value),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ToastServiceHandler, useValue: toastServiceHandler },
        SupportLinkPipe,
      ],
    });
    pipe = TestBed.inject(SupportLinkPipe);
  });

  it('delegates to ToastServiceHandler.renderSupportMessage() instead of duplicating the sanitize/placeholder logic', () => {
    // Arrange
    toastServiceHandler.renderSupportMessage.mockReturnValue(
      'Something went wrong. Contact <a href="https://issues.example/new" target="_blank" rel="noopener noreferrer">the support team</a>.'
    );

    // Act
    const result = pipe.transform('Something went wrong. Contact {{supportLink}}.');

    // Assert
    expect(toastServiceHandler.renderSupportMessage).toHaveBeenCalledWith(
      'Something went wrong. Contact {{supportLink}}.'
    );
    expect(result).toContain('<a href="https://issues.example/new"');
  });

  it('returns the sanitized message untouched when it has no support-link placeholder', () => {
    // Arrange
    toastServiceHandler.renderSupportMessage.mockReturnValue('Plain message, no link needed.');

    // Act
    const result = pipe.transform('Plain message, no link needed.');

    // Assert
    expect(result).toBe('Plain message, no link needed.');
  });
});
