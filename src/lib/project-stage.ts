// "Siguiente paso" del handoff de un proyecto. Sólo presentación: traduce responsable, checklist y
// estado (ya calculados por el servidor) a una indicación accionable, igual que el constructor y la
// bandeja. El contenido del checklist sigue siendo del equipo (J1-01): aquí no se sugiere ninguna tarea.

export type ProjectNextStepAction = 'owner' | 'checklist' | 'tasks' | 'complete';
export type ProjectNextStep = { title: string; detail: string; tone: 'action' | 'waiting' | 'done'; action?: ProjectNextStepAction };

export type ProjectNextStepInput = {
  status: 'EN_TRANSICION' | 'COMPLETADO';
  hasOwner: boolean;
  checklistTotal: number;
  checklistCompleted: number;
  canManage: boolean;
};

export function projectNextStep(input: ProjectNextStepInput): ProjectNextStep {
  if (input.status === 'COMPLETADO') return { title: 'Handoff completado', detail: 'La transición quedó cerrada. Si algo quedó pendiente, puedes reabrirla.', tone: 'done' };
  if (!input.canManage) return { title: 'En transición', detail: 'El equipo está preparando el arranque de este proyecto.', tone: 'waiting' };
  if (!input.hasOwner) return { title: 'Asigna un responsable', detail: 'Define quién coordina el arranque: será el punto de contacto del cliente y del equipo de obra.', tone: 'action', action: 'owner' };
  if (input.checklistTotal === 0) return { title: 'Arma el checklist de arranque', detail: 'Escribe los pendientes de la transición, uno por línea, para que nada dependa de la memoria.', tone: 'action', action: 'checklist' };
  const pending = Math.max(0, input.checklistTotal - input.checklistCompleted);
  if (pending > 0) return { title: pending === 1 ? 'Queda 1 tarea pendiente' : `Quedan ${pending} tareas pendientes`, detail: 'Marca cada tarea al completarla: queda registrado quién y cuándo.', tone: 'action', action: 'tasks' };
  return { title: 'Marca el handoff completado', detail: 'Todas las tareas están listas. Cierra la transición para dejar constancia.', tone: 'action', action: 'complete' };
}
