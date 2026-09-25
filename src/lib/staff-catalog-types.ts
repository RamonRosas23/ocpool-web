export type CatalogStatus = 'ACTIVE' | 'ARCHIVED';

export type Category = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: CatalogStatus;
  sortOrder: number;
  parentId: string | null;
};

export type CatalogItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  status: CatalogStatus;
  category: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type PriceList = {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  status: 'ACTIVE' | 'ARCHIVED';
  validFrom: string;
  validUntil: string | null;
  _count: { items: number };
};

export type PriceListDetail = PriceList & {
  items: Array<{
    id: string;
    catalogItemId: string;
    unitPriceMinor: string;
    validFrom: string;
    validUntil: string | null;
    catalogItem: { code: string; name: string; unit: string; status: string };
  }>;
};

export type CatalogListResponse = { items: CatalogItem[]; page: number; pageSize: number; total: number; totalPages: number };

export type CatalogCapabilities = { catalogRead: boolean; catalogManage: boolean; pricesRead: boolean; pricesManage: boolean };

export type SpecialConceptGroup = {
  normalizedName: string;
  unit: string;
  name: string;
  occurrences: number;
  recentFolios: string[];
  status: 'PENDING' | 'MATCHES_EXISTING' | 'PROMOTED';
  matchingCatalogItem: { id: string; code: string; name: string } | null;
};

export function categoryDescendantIds(categoryId: string, categories: Category[]): Set<string> {
  const result = new Set<string>();
  let frontier = [categoryId];
  while (frontier.length) {
    const next = categories.filter((entry) => entry.parentId && frontier.includes(entry.parentId)).map((entry) => entry.id);
    for (const id of next) result.add(id);
    frontier = next;
  }
  return result;
}

export function buildCategoryTreeOrder(categories: Category[]): Array<{ category: Category; depth: number }> {
  const byParent = new Map<string | null, Category[]>();
  for (const category of categories) {
    const key = category.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(category);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const result: Array<{ category: Category; depth: number }> = [];
  const seen = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const category of byParent.get(parentId) ?? []) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      result.push({ category, depth });
      visit(category.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const category of categories) if (!seen.has(category.id)) result.push({ category, depth: 0 });
  return result;
}
