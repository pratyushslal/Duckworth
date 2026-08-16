describe('conversation lifecycle intelligence', () => {
  const active = {
    status: 'active' as const,
    pendingActionId: null,
    pendingOrigin: null,
    pendingPreviousStatus: null,
  };
  const now = '2026-08-11T12:00:00.000Z';

  it('requests confirmation for an explicit session-level close intent', async () => {
    const { decideConversationLifecycle } = await import('./index.js');

    expect(decideConversationLifecycle({
      text: 'I am done adding items',
      occurredAt: now,
    }, active)).toMatchObject({
      kind: 'request_close',
      origin: 'explicit_intent',
      state: {
        status: 'close_pending',
        pendingOrigin: 'explicit_intent',
        pendingPreviousStatus: 'active',
      },
    });
  });

  it('does not close for negated, item-scoped, or ambiguous completion language', async () => {
    const { decideConversationLifecycle } = await import('./index.js');

    for (const text of [
      'I am not done',
      'That is enough milk',
      'I am close to finishing',
      'Finish adding the butter details',
      'I will think of more things later',
    ]) {
      expect(decideConversationLifecycle({ text, occurredAt: now }, active)).toMatchObject({
        kind: 'no_action',
        state: active,
      });
    }
  });

  it('cannot confirm or expire a close action when none is pending', async () => {
    const { decideConversationLifecycle } = await import('./index.js');

    expect(decideConversationLifecycle({ text: 'yes', occurredAt: now }, active)).toMatchObject({
      kind: 'no_action',
      state: active,
    });
  });

  it('confirms only an unexpired pending close action', async () => {
    const { decideConversationLifecycle } = await import('./index.js');
    const pending = {
      ...active,
      status: 'close_pending' as const,
      pendingActionId: 'pending-1',
      pendingOrigin: 'explicit_intent' as const,
      pendingPreviousStatus: 'active' as const,
    };

    expect(decideConversationLifecycle({ text: 'yes', occurredAt: now }, pending)).toMatchObject({
      kind: 'confirm_close',
      state: { status: 'closed', pendingActionId: null },
    });
    expect(decideConversationLifecycle({ text: 'yes', occurredAt: now, pendingExpired: true }, pending)).toMatchObject({
      kind: 'cancel_close',
      state: { status: 'active', pendingActionId: null },
    });
  });

  it('cancels a pending close when the user submits another shopping action', async () => {
    const { decideConversationLifecycle } = await import('./index.js');
    const pending = {
      ...active,
      status: 'close_pending' as const,
      pendingActionId: 'pending-1',
      pendingOrigin: 'explicit_intent' as const,
      pendingPreviousStatus: 'active' as const,
    };

    expect(decideConversationLifecycle({ text: 'add milk', occurredAt: now }, pending)).toMatchObject({
      kind: 'cancel_close',
      state: { status: 'active', pendingActionId: null },
    });
  });
});
