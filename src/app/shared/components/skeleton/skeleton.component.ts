import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Credential card skeleton -->
    <ng-container *ngIf="variant === 'card'">
      <div class="skeleton-card" *ngFor="let i of items">
        <div class="skeleton-card-icon skeleton-pulse"></div>
        <div class="skeleton-card-lines">
          <div class="skeleton-line skeleton-line-title skeleton-pulse"></div>
          <div class="skeleton-line skeleton-line-subtitle skeleton-pulse"></div>
          <div class="skeleton-line skeleton-line-short skeleton-pulse"></div>
        </div>
      </div>
    </ng-container>

    <!-- List item skeleton -->
    <ng-container *ngIf="variant === 'list-item'">
      <div class="skeleton-list-item" *ngFor="let i of items">
        <div class="skeleton-list-icon skeleton-pulse"></div>
        <div class="skeleton-list-lines">
          <div class="skeleton-line skeleton-line-title skeleton-pulse"></div>
          <div class="skeleton-line skeleton-line-short skeleton-pulse"></div>
        </div>
      </div>
    </ng-container>

    <!-- Text block skeleton -->
    <ng-container *ngIf="variant === 'text-block'">
      <div class="skeleton-text-block">
        <div class="skeleton-line skeleton-line-full skeleton-pulse" *ngFor="let i of items"></div>
      </div>
    </ng-container>
  `,
  styles: [`
    :host {
      display: block;
    }

    /* Pulse animation */
    .skeleton-pulse {
      background: linear-gradient(
        90deg,
        var(--surface-muted, #E8ECF1) 25%,
        var(--surface-card, #FFFFFF) 37%,
        var(--surface-muted, #E8ECF1) 63%
      );
      background-size: 400% 100%;
      animation: skeletonPulse 1.4s ease infinite;
      border-radius: var(--radius-sm, 4px);
    }

    @keyframes skeletonPulse {
      0% { background-position: 100% 50%; }
      100% { background-position: 0 50%; }
    }

    /* Credential card variant */
    .skeleton-card {
      width: 300px;
      height: 200px;
      border-radius: 20px;
      border: 1px solid var(--border-default, #D1D5DB);
      background: var(--surface-card, #FFFFFF);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 8px auto;
    }

    .skeleton-card-icon {
      width: 50px;
      height: 50px;
      border-radius: var(--radius-md, 8px);
    }

    .skeleton-card-lines {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
    }

    /* List item variant */
    .skeleton-list-item {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
      background: var(--surface-card, #FFFFFF);
      border-bottom: 1px solid var(--border-default, #D1D5DB);
    }

    .skeleton-list-icon {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .skeleton-list-lines {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
    }

    /* Text block variant */
    .skeleton-text-block {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 16px;
    }

    /* Shared line styles */
    .skeleton-line {
      height: 12px;
    }

    .skeleton-line-title {
      width: 60%;
      height: 14px;
    }

    .skeleton-line-subtitle {
      width: 80%;
    }

    .skeleton-line-short {
      width: 40%;
    }

    .skeleton-line-full {
      width: 100%;
    }
  `],
})
export class SkeletonComponent {
  @Input() variant: 'card' | 'list-item' | 'text-block' = 'card';
  @Input() count = 3;

  get items(): number[] {
    return Array.from({ length: this.count }, (_, i) => i);
  }
}
