import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { LegalContentService } from '../services/legal-content.service';
import { LegalContentFailureReason, LegalDocumentContent, LegalDocumentId } from '../models/legal-document.model';

type LegalDocumentViewState = 'loading' | 'ready' | 'error';

/**
 * AC-03 / AC-04 / AC-11 / EC-01 / ES-01 / ES-04 / ES-05 / ES-06.
 * The docId route param has already been validated by legalDocumentGuard
 * before this component is ever instantiated (ES-02).
 */
@Component({
  selector: 'app-legal-document',
  templateUrl: './legal-document.page.html',
  styleUrls: ['./legal-document.page.scss'],
  imports: [IonicModule, CommonModule, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class LegalDocumentPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly legalContent = inject(LegalContentService);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<LegalDocumentViewState>('loading');
  readonly document = signal<LegalDocumentContent | null>(null);
  readonly errorReason = signal<LegalContentFailureReason | null>(null);

  docId: LegalDocumentId | null = null;
  private loadSubscription?: Subscription;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.docId = params.get('docId') as LegalDocumentId;
      this.load();
    });
  }

  /** ES-01/ES-04 — re-invoked by the "Retry" action; cancels any in-flight load first. */
  retry(): void {
    this.load();
  }

  private load(): void {
    if (!this.docId) return;
    // A new docId (route param change) or a retry click both cancel whatever was in flight
    // — content from a previous document/attempt never lands on screen (ES-05 same principle).
    this.loadSubscription?.unsubscribe();
    this.state.set('loading');
    this.errorReason.set(null);

    this.loadSubscription = this.legalContent
      .load(this.docId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result.status === 'ready') {
          this.document.set(result.content);
          this.state.set('ready');
        } else {
          this.document.set(null);
          this.errorReason.set(result.reason);
          this.state.set('error');
        }
      });
  }
}
