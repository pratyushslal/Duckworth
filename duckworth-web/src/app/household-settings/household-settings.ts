import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HouseholdSettingsService, type HouseholdCaptureSettings } from '../core/household-settings.service';

@Component({
  selector: 'app-household-settings',
  imports: [FormsModule],
  templateUrl: './household-settings.html',
  styleUrl: './household-settings.scss',
})
export class HouseholdSettings {
  readonly householdId = input.required<string>();
  private readonly service = inject(HouseholdSettingsService);
  protected readonly settings = signal<HouseholdCaptureSettings | null>(null);
  protected readonly loading = signal(false);
  protected readonly saved = signal(false);

  protected load(): void {
    if (this.loading() || this.settings()) return;
    this.loading.set(true);
    this.service.get(this.householdId()).subscribe({
      next: (settings) => { this.settings.set(settings); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  protected save(): void {
    const settings = this.settings();
    if (!settings || this.loading()) return;
    this.loading.set(true);
    this.service.update(this.householdId(), settings).subscribe({
      next: (saved) => { this.settings.set(saved); this.saved.set(true); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
