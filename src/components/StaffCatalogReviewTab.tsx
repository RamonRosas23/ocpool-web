'use client';

import { useEffect, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import { PrivateSelect } from '@/components/private/ui';
import { readApiResponseOrThrow } from '@/lib/api-response-error';
import type { Category, SpecialConceptGroup } from '@/lib/staff-catalog-types';

export type StaffCatalogReviewTabProps = { onPromoted: () => void };

export default function StaffCatalogReviewTab({ onPromoted }: StaffCatalogReviewTabProps) {
  const [groups, setGroups] = useState<SpecialConceptGroup[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [categoryByGroup, setCategoryByGroup] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const [groupsResponse, categoriesResponse] = await Promise.all([
          fetch('/api/staff/catalog/special-concepts', { credentials: 'include', cache: 'no-store' }),
          fetch('/api/staff/catalog/categories?status=ACTIVE', { credentials: 'include', cache: 'no-store' }),
        ]);
        const [groupsData, categoriesData] = await Promise.all([
          readApiResponseOrThrow<SpecialConceptGroup[]>(groupsResponse, 'No fue posible cargar los conceptos por revisar.'),
          readApiResponseOrThrow<Category[]>(categoriesResponse, 'No fue posible cargar las categorías.'),
        ]);
        if (cancelled) return;
        setGroups(groupsData);
        setCategories(categoriesData);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'No fue posible cargar los conceptos por revisar.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const reloadGroups = async () => {
    const response = await fetch('/api/staff/catalog/special-concepts', { credentials: 'include', cache: 'no-store' });
    setGroups(await readApiResponseOrThrow<SpecialConceptGroup[]>(response, 'No fue posible completar la operación.'));
  };

  const promoteGroup = async (group: SpecialConceptGroup) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const key = `${group.normalizedName}::${group.unit}`;
      const categoryId = categoryByGroup[key];
      const response = await fetch('/api/staff/catalog/special-concepts/promote', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: group.name, unit: group.unit, categoryId: categoryId || undefined }) });
      const result = await readApiResponseOrThrow<{ catalogItem: { id: string; code: string; name: string }; alreadyPromoted: boolean }>(response, 'No fue posible completar la operación.');
      setNotice(`Concepto ${result.catalogItem.code} · ${result.catalogItem.name} vinculado.`);
      await reloadGroups();
      onPromoted();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No fue posible promover el concepto.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="catalog-review">
      <p className="catalog-tab-intro">Texto libre usado en propuestas que todavía no es un concepto real del catálogo.</p>
      {notice && <p className="staff-notice" role="status">{notice}</p>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      {loading && <div className="catalog-detail-loading"><span /><span /></div>}
      {!loading && groups && groups.length === 0 && <div className="staff-empty staff-empty--compact catalog-review__empty"><span className="staff-empty__mark" aria-hidden="true"><CheckCheck size={20} /></span><h2>Todo al día.</h2><p>No hay conceptos especiales pendientes de revisión. Cuando una propuesta use un concepto fuera de catálogo, aparecerá aquí para promoverlo o vincularlo.</p></div>}
      {!loading && groups && groups.length > 0 && (
        <div className="catalog-review-list">
          {groups.map((group) => {
            const key = `${group.normalizedName}::${group.unit}`;
            return (
              <div className="catalog-review-row" key={key}>
                <span>
                  <strong>{group.name}</strong>
                  <small>{group.unit} · {group.occurrences} {group.occurrences === 1 ? 'cotización' : 'cotizaciones'} · {group.recentFolios.join(', ')}</small>
                </span>
                {group.status === 'PROMOTED' && <small className="catalog-special-status catalog-special-status--done">Promovido a {group.matchingCatalogItem!.code} · {group.matchingCatalogItem!.name}</small>}
                {group.status === 'MATCHES_EXISTING' && (
                  <div className="catalog-review-row__actions">
                    <small className="catalog-special-status">Ya existe {group.matchingCatalogItem!.code} · {group.matchingCatalogItem!.name}</small>
                    <button className="staff-button" type="button" disabled={saving} onClick={() => void promoteGroup(group)}>Vincular</button>
                  </div>
                )}
                {group.status === 'PENDING' && (
                  <div className="catalog-review-row__actions">
                    <PrivateSelect id={`special-concept-category-${key}`} label={`Categoría para ${group.name}`} hideLabel value={categoryByGroup[key] ?? ''} onValueChange={(value) => setCategoryByGroup({ ...categoryByGroup, [key]: value })} options={categories.map((category) => ({ value: category.id, label: category.name }))} placeholder="Sin categoría" disabled={saving} />
                    <button className="staff-button staff-button--copper" type="button" disabled={saving} onClick={() => void promoteGroup(group)}>Promover a catálogo</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
