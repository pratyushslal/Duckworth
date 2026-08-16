export type ConversationSessionStatus = 'active' | 'idle' | 'close_pending' | 'closed';

export type CloseActionOrigin = 'explicit_intent' | 'configured_idle_policy';

export interface ConversationLifecycleState {
  status: ConversationSessionStatus;
  pendingActionId: string | null;
  pendingOrigin: CloseActionOrigin | null;
  pendingPreviousStatus: 'active' | 'idle' | null;
}

export interface ConversationLifecycleInput {
  text: string;
  occurredAt: string;
  pendingExpired?: boolean;
  automaticCloseGraceElapsed?: boolean;
}

export type LifecycleDecision =
  | { kind: 'no_action'; state: ConversationLifecycleState }
  | { kind: 'start_or_resume'; state: ConversationLifecycleState }
  | { kind: 'request_close'; state: ConversationLifecycleState; origin: CloseActionOrigin }
  | { kind: 'cancel_close'; state: ConversationLifecycleState }
  | { kind: 'confirm_close'; state: ConversationLifecycleState };

const EXPLICIT_CLOSE_PATTERNS = [
  /^(?:i\s+am|i'm)\s+(?:done|finished|through)\s+(?:adding\s+items?|with\s+(?:the\s+)?shopping\s+(?:list|session|conversation))$/iu,
  /^(?:close|finish|end)\s+(?:this\s+)?(?:shopping\s+)?(?:conversation|session|list)$/iu,
  /^that(?:'s|\s+is)\s+(?:everything|all)\s+for\s+(?:this\s+)?(?:shopping\s+)?list$/iu,
];

const CONFIRMATION_PATTERN = /^(?:yes|y|confirm|go\s+ahead|close\s+it)$/iu;
const CANCELLATION_PATTERN = /^(?:no|n|cancel|keep\s+adding|not\s+yet)$/iu;

export function decideConversationLifecycle(
  input: ConversationLifecycleInput,
  state: ConversationLifecycleState,
): LifecycleDecision {
  const text = input.text.trim().replace(/\s+/gu, ' ');
  if (!text) return { kind: 'no_action', state };

  if (state.status === 'close_pending') {
    if (input.automaticCloseGraceElapsed && state.pendingOrigin === 'configured_idle_policy') {
      return { kind: 'confirm_close', state: closedState() };
    }
    if (input.pendingExpired || CANCELLATION_PATTERN.test(text)) {
      return { kind: 'cancel_close', state: restoredState(state) };
    }
    if (CONFIRMATION_PATTERN.test(text)) {
      return { kind: 'confirm_close', state: closedState() };
    }
    return { kind: 'cancel_close', state: activeState() };
  }

  if (state.status === 'closed') {
    return { kind: 'start_or_resume', state: activeState() };
  }

  if (isExplicitCloseIntent(text)) {
    return {
      kind: 'request_close',
      origin: 'explicit_intent',
      state: {
        status: 'close_pending',
        pendingActionId: null,
        pendingOrigin: 'explicit_intent',
        pendingPreviousStatus: state.status === 'idle' ? 'idle' : 'active',
      },
    };
  }

  return { kind: 'no_action', state };
}

function isExplicitCloseIntent(text: string): boolean {
  if (/\b(?:not|don't|do not|never|close to)\b/iu.test(text)) return false;
  return EXPLICIT_CLOSE_PATTERNS.some((pattern) => pattern.test(text));
}

function activeState(): ConversationLifecycleState {
  return {
    status: 'active',
    pendingActionId: null,
    pendingOrigin: null,
    pendingPreviousStatus: null,
  };
}

function closedState(): ConversationLifecycleState {
  return {
    status: 'closed',
    pendingActionId: null,
    pendingOrigin: null,
    pendingPreviousStatus: null,
  };
}

function restoredState(state: ConversationLifecycleState): ConversationLifecycleState {
  return {
    status: state.pendingPreviousStatus ?? 'active',
    pendingActionId: null,
    pendingOrigin: null,
    pendingPreviousStatus: null,
  };
}
