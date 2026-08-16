import { normalizeTextKey } from './text-key';
import type { ShoppingItem } from './shopping-items.service';

export type ShoppingItemSort = 'latest' | 'oldest' | 'name-asc' | 'attention';

function compareIds(left: ShoppingItem, right: ShoppingItem): number {
  return left.id.localeCompare(right.id);
}

function compareLatest(left: ShoppingItem, right: ShoppingItem): number {
  return right.createdAt.localeCompare(left.createdAt) || compareIds(left, right);
}

export function sortShoppingItems(
  items: readonly ShoppingItem[],
  mode: ShoppingItemSort,
): ShoppingItem[] {
  if (mode === 'oldest') {
    return [...items].sort((left, right) => {
      const created = left.createdAt.localeCompare(right.createdAt);
      return created || compareIds(left, right);
    });
  }
  if (mode === 'latest') {
    return [...items].sort(compareLatest);
  }
  if (mode === 'name-asc') {
    return [...items].sort((left, right) => {
      const name = normalizeTextKey(left.name).localeCompare(normalizeTextKey(right.name));
      return name || compareIds(left, right);
    });
  }
  if (mode === 'attention') {
    return [...items].sort((left, right) => {
      const attention = Number(left.attentionReasons.length === 0) - Number(right.attentionReasons.length === 0);
      return attention || compareLatest(left, right);
    });
  }
  return [...items];
}
