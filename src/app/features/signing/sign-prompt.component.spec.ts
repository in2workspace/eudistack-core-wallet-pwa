import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SignPromptComponent } from './sign-prompt.component';

async function setup(errorCode: SignPromptComponent['errorCode'] = null): Promise<{
  fixture: ComponentFixture<SignPromptComponent>;
  component: SignPromptComponent;
}> {
  await TestBed.configureTestingModule({
    imports: [SignPromptComponent, TranslateModule.forRoot()],
  }).compileComponents();

  const fixture = TestBed.createComponent(SignPromptComponent);
  fixture.componentInstance.errorCode = errorCode;
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance };
}

describe('SignPromptComponent', () => {
  it('renders nothing when errorCode is null', async () => {
    const { fixture } = await setup(null);
    expect(fixture.nativeElement.querySelector('.sign-prompt-error-card')).toBeNull();
  });

  it('renders error card when errorCode is wrap_unavailable_on_this_device', async () => {
    const { fixture } = await setup('wrap_unavailable_on_this_device');
    expect(fixture.nativeElement.querySelector('.sign-prompt-error-card')).not.toBeNull();
  });

  it('does not render error card for prepare_sign_failed', async () => {
    const { fixture } = await setup('prepare_sign_failed');
    expect(fixture.nativeElement.querySelector('.sign-prompt-error-card')).toBeNull();
  });

  it('emits dismissed event when dismiss() is called', async () => {
    const { component } = await setup('wrap_unavailable_on_this_device');
    const spy = jest.fn();
    component.dismissed.subscribe(spy);

    component.dismiss();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits dismissed event when dismiss button is clicked', async () => {
    const { fixture, component } = await setup('wrap_unavailable_on_this_device');
    const spy = jest.fn();
    component.dismissed.subscribe(spy);

    (fixture.nativeElement.querySelector('.sign-prompt-dismiss-btn') as HTMLElement).click();
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
