import { Component, input, output } from '@angular/core';
import type { ClarificationCandidate } from '@duckworth/local-assistance';
import type { SpellingDecision } from '../core/capture-assistance.service';

@Component({
  selector: 'app-spelling-clarification',
  templateUrl: './spelling-clarification.html',
  styleUrl: './spelling-clarification.scss',
})
export class SpellingClarification {
  readonly candidate = input.required<ClarificationCandidate>();
  readonly decision = output<SpellingDecision>();
}
