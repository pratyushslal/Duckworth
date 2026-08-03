import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ApiHealthService } from './core/api-health.service';

type ApiStatus = 'checking' | 'ready' | 'offline';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly apiHealth = inject(ApiHealthService);
  protected readonly apiStatus = signal<ApiStatus>('checking');

  constructor() {
    this.apiHealth.check().subscribe({
      next: () => this.apiStatus.set('ready'),
      error: () => this.apiStatus.set('offline'),
    });
  }
}
