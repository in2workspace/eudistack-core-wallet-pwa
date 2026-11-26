import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateFakeLoader, TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { SupportChannelService } from 'src/app/core/services/support-channel.service';
import { ISSUE_TRACKER_URL, SUPPORT_EMAIL, SUPPORT_URL } from 'src/app/core/constants/support.constants';
import { SupportMessageComponent } from './support-message.component';

describe('SupportMessageComponent', () => {
  let fixture: ComponentFixture<SupportMessageComponent>;
  let supportChannel: { channels: jest.Mock };

  const render = (message: string | null | undefined): HTMLElement => {
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    supportChannel = {
      channels: jest.fn().mockReturnValue({
        email: SUPPORT_EMAIL,
        helpCenterUrl: null,
        issueTrackerUrl: ISSUE_TRACKER_URL,
        supportUrl: SUPPORT_URL,
      }),
    };

    TestBed.configureTestingModule({
      imports: [
        SupportMessageComponent,
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
      ],
      providers: [{ provide: SupportChannelService, useValue: supportChannel }],
    });
    fixture = TestBed.createComponent(SupportMessageComponent);
  });

  it('replaces {{supportLink}} with a link to the default support URL', () => {
    const el = render('Something went wrong. Contact {{supportLink}}.');

    const link = el.querySelector('a');
    expect(link?.getAttribute('href')).toBe(SUPPORT_URL);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.textContent).toBe('errors.support-team-label');
    expect(el.textContent).toBe('Something went wrong. Contact errors.support-team-label.');
  });

  it('points the link at the tenant-resolved support URL', () => {
    supportChannel.channels.mockReturnValue({
      email: SUPPORT_EMAIL,
      helpCenterUrl: null,
      issueTrackerUrl: ISSUE_TRACKER_URL,
      supportUrl: 'https://ticketing.customer.example/',
    });

    const el = render('Contact {{supportLink}}.');

    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://ticketing.customer.example/');
  });

  it('shows markup in the message as text, never as HTML', () => {
    const el = render('<img src=x onerror=alert(1)> Contact {{supportLink}}.');

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelectorAll('a').length).toBe(1);
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('adds no link to a message without the placeholder', () => {
    const el = render('Plain message, no link needed.');

    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toBe('Plain message, no link needed.');
  });

  it('renders nothing for a missing message', () => {
    const el = render(undefined);

    expect(el.textContent).toBe('');
  });
});
