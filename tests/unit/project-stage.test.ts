import { describe, expect, it } from 'vitest';
import { projectNextStep, type ProjectNextStepInput } from '@/lib/project-stage';

const base: ProjectNextStepInput = { status: 'EN_TRANSICION', hasOwner: true, checklistTotal: 3, checklistCompleted: 1, canManage: true };

describe('projectNextStep', () => {
  it('walks the handoff from owner to checklist to tasks to completion', () => {
    expect(projectNextStep({ ...base, hasOwner: false })).toMatchObject({ title: 'Asigna un responsable', action: 'owner' });
    expect(projectNextStep({ ...base, checklistTotal: 0, checklistCompleted: 0 })).toMatchObject({ title: 'Arma el checklist de arranque', action: 'checklist' });
    expect(projectNextStep(base)).toMatchObject({ title: 'Quedan 2 tareas pendientes', action: 'tasks' });
    expect(projectNextStep({ ...base, checklistCompleted: 2 }).title).toBe('Queda 1 tarea pendiente');
    expect(projectNextStep({ ...base, checklistCompleted: 3 })).toMatchObject({ title: 'Marca el handoff completado', action: 'complete' });
  });

  it('never offers actions to read-only profiles and closes on completion', () => {
    expect(projectNextStep({ ...base, canManage: false })).toMatchObject({ tone: 'waiting' });
    expect(projectNextStep({ ...base, canManage: false }).action).toBeUndefined();
    expect(projectNextStep({ ...base, status: 'COMPLETADO' })).toMatchObject({ title: 'Handoff completado', tone: 'done' });
  });
});
