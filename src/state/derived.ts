/** Memoised derived views of the active project — everything downstream of the model. */
import { useMemo } from 'react';
import { useStore } from './store';
import { activeBuilding, activeOption, levelsSorted } from '../core/model/query';
import { resolveRules } from '../core/rules/rulesets';
import { deriveLevel } from '../core/derive/level';
import { validate } from '../core/derive/validation';
import { estimateCost } from '../core/derive/cost';
import { analyzeSite } from '../core/derive/site';
import type { BuildingModel, ProjectDoc } from '../core/model/types';

export function useDoc(): ProjectDoc {
  return useStore((s) => s.doc!) as ProjectDoc;
}

export function useBuilding(): BuildingModel {
  const doc = useDoc();
  return activeBuilding(doc);
}

export function useOption() {
  return activeOption(useDoc());
}

export function useRules() {
  const doc = useDoc();
  return useMemo(() => resolveRules(doc.meta.ruleSetId, doc.ruleOverrides), [doc.meta.ruleSetId, doc.ruleOverrides]);
}

export function useLevels() {
  const b = useBuilding();
  return useMemo(() => levelsSorted(b), [b.levels]);
}

export function useDerivedLevel(levelId: string | null) {
  const b = useBuilding();
  return useMemo(() => (levelId && b.levels[levelId] ? deriveLevel(b, levelId) : null), [b, levelId]);
}

export function useHealth() {
  const doc = useDoc();
  const b = useBuilding();
  const rules = useRules();
  return useMemo(() => validate(doc, b, rules), [b, doc.site, doc.meta.units, doc.meta.location, rules]);
}

export function useCost() {
  const doc = useDoc();
  const b = useBuilding();
  const rules = useRules();
  return useMemo(() => estimateCost(doc, b, rules), [b, doc.site, doc.cost, rules]);
}

export function useSite() {
  const doc = useDoc();
  const b = useBuilding();
  const rules = useRules();
  return useMemo(() => analyzeSite(doc, b, rules), [b, doc.site, rules]);
}

export function useUnits() {
  return useStore((s) => s.doc?.meta.units ?? 'imperial');
}
