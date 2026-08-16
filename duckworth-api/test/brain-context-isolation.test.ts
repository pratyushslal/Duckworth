import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('shopping brain context isolation', () => {
  it('authorizes retries per context and isolates simultaneous household scopes', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const registrations = await Promise.all([
        ...['phone-a', 'phone-b', 'speaker-a', 'speaker-b'].map((deviceId) => app.inject({
          method: 'POST',
          url: '/api/v1/households/shared-household/conversation-contexts',
          payload: { deviceId },
        })),
        app.inject({
          method: 'POST',
          url: '/api/v1/households/other-household/conversation-contexts',
          payload: { deviceId: 'other-phone' },
        }),
      ]);
      const contexts = registrations.map((response) => response.json() as {
        context: { id: string };
        accessToken: string;
      });

      const capture = (
        householdId: string,
        index: number,
        text: string,
        token = contexts[index].accessToken,
        inputId = `${householdId}-input-${index}`,
      ) => app.inject({
        method: 'POST',
        url: `/api/v2/households/${householdId}/brain/captures`,
        headers: { 'x-conversation-context-token': token },
        payload: {
          schemaVersion: 2,
          inputId,
          householdId,
          contextId: contexts[index].context.id,
          shoppingListId: `default:${householdId}`,
          source: { kind: 'text', deviceId: `device-${index}` },
          text,
          locale: 'en-IN',
          countryCode: 'IN',
          occurredAt: '2026-08-12T08:00:00.000Z',
          idempotencyKey: inputId,
        },
      });

      const unauthorized = await capture('shared-household', 0, 'milk', 'wrong-token');
      expect(unauthorized.statusCode, unauthorized.body).toBe(403);

      const parallel = await Promise.all([
        capture('shared-household', 0, 'milk'),
        capture('shared-household', 1, 'bread'),
        capture('shared-household', 2, 'eggs'),
        capture('shared-household', 3, 'rice'),
        capture('other-household', 4, 'soap'),
      ]);
      parallel.forEach((response) => expect(response.statusCode, response.body).toBe(201));

      const retryWithoutAuthority = await capture('shared-household', 0, 'milk', 'wrong-token');
      expect(retryWithoutAuthority.statusCode, retryWithoutAuthority.body).toBe(403);
      const retry = await capture('shared-household', 0, 'milk');
      expect(retry.statusCode, retry.body).toBe(200);

      const sharedItems = await app.inject({ method: 'GET', url: '/api/v1/households/shared-household/items' });
      const otherItems = await app.inject({ method: 'GET', url: '/api/v1/households/other-household/items' });
      expect(sharedItems.json().map((item: { name: string }) => item.name).sort()).toEqual(['bread', 'eggs', 'milk', 'rice']);
      expect(otherItems.json().map((item: { name: string }) => item.name)).toEqual(['soap']);

      const crossHousehold = await capture('other-household', 0, 'forbidden', contexts[0].accessToken);
      expect([403, 404]).toContain(crossHousehold.statusCode);

      const drafts = await Promise.all([
        capture('shared-household', 0, '???', contexts[0].accessToken, 'draft-phone-a'),
        capture('shared-household', 1, '###', contexts[1].accessToken, 'draft-phone-b'),
      ]);
      drafts.forEach((response) => {
        expect(response.statusCode, response.body).toBe(201);
        expect(response.json().facts.drafts).toHaveLength(1);
      });
      expect(drafts[0].json().facts.drafts[0].draftId)
        .not.toBe(drafts[1].json().facts.drafts[0].draftId);

      const adjustments = await Promise.all([
        capture('shared-household', 0, 'make milk two packs', contexts[0].accessToken, 'milk-adjust-2'),
        capture('shared-household', 0, 'make milk three packs', contexts[0].accessToken, 'milk-adjust-3'),
        capture('shared-household', 1, 'make bread four packs', contexts[1].accessToken, 'bread-adjust-4'),
      ]);
      adjustments.forEach((response) => expect(response.statusCode, response.body).toBe(201));
      expect(adjustments[0].json().facts.merged[0].item.itemName.value).toBe('milk');
      expect(adjustments[1].json().facts.merged[0].item.itemName.value).toBe('milk');
      expect(adjustments[2].json().facts.merged[0].item.itemName.value).toBe('bread');

      const afterAdjustments = await app.inject({
        method: 'GET',
        url: '/api/v1/households/shared-household/items',
      });
      const adjustedItems = afterAdjustments.json() as Array<{
        id: string;
        name: string;
        quantity: number | null;
        version: number;
      }>;
      const milk = adjustedItems.find((item) => item.name === 'milk')!;
      const bread = adjustedItems.find((item) => item.name === 'bread')!;
      expect(milk.quantity).toBe(5);
      expect(bread.quantity).toBe(4);

      const staleEdits = await Promise.all([
        app.inject({
          method: 'PATCH',
          url: `/api/v1/households/shared-household/items/${milk.id}`,
          payload: { name: 'fresh milk', expectedVersion: milk.version },
        }),
        app.inject({
          method: 'PATCH',
          url: `/api/v1/households/shared-household/items/${milk.id}`,
          payload: { name: 'whole milk', expectedVersion: milk.version },
        }),
      ]);
      expect(staleEdits.map((response) => response.statusCode).sort()).toEqual([200, 409]);
      expect(staleEdits.find((response) => response.statusCode === 409)?.json().error)
        .toBe('item_version_conflict');

      const handoff = await app.inject({
        method: 'POST',
        url: `/api/v1/households/shared-household/conversation-contexts/${contexts[0].context.id}/handoff`,
        payload: {
          accessToken: contexts[0].accessToken,
          targetDeviceId: 'phone-a-replacement',
        },
      });
      expect(handoff.statusCode, handoff.body).toBe(201);
      const claimed = await app.inject({
        method: 'POST',
        url: '/api/v1/households/shared-household/conversation-contexts/claim',
        payload: {
          handoffToken: handoff.json().handoffToken,
          deviceId: 'phone-a-replacement',
        },
      });
      expect(claimed.statusCode, claimed.body).toBe(200);
      const oldToken = await capture(
        'shared-household',
        0,
        'make milk one pack',
        contexts[0].accessToken,
        'old-token-after-handoff',
      );
      expect(oldToken.statusCode).toBe(403);
      const handedOff = await capture(
        'shared-household',
        0,
        'make milk one pack',
        claimed.json().accessToken,
        'new-token-after-handoff',
      );
      expect(handedOff.statusCode, handedOff.body).toBe(201);
      const handedOffRetry = await capture(
        'shared-household',
        0,
        'make milk one pack',
        claimed.json().accessToken,
        'new-token-after-handoff',
      );
      expect(handedOffRetry.statusCode, handedOffRetry.body).toBe(200);
      expect(handedOffRetry.json()).toEqual(handedOff.json());
    } finally {
      await app.close();
    }
  });
});
