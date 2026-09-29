import { BadgeCheck, CircleCheck, CircleHelp, CircleX, FilePen, FileText, HardHat, Inbox, MailWarning, MessageSquare, RotateCcw, StickyNote, Tag, Undo2, UserRoundCheck, UserRoundMinus, Users, type LucideIcon } from 'lucide-react';

export type InboxTone = 'accent' | 'success' | 'copper' | 'danger' | 'muted';

const VISUALS: Record<string, { icon: LucideIcon; tone: InboxTone }> = {
  'request.new_unassigned': { icon: Inbox, tone: 'copper' },
  'customer.activity': { icon: MessageSquare, tone: 'accent' },
  'team.activity': { icon: MessageSquare, tone: 'accent' },
  'quote.changes_requested': { icon: FilePen, tone: 'copper' },
  'quote.accepted': { icon: CircleCheck, tone: 'success' },
  'request.assigned_to_you': { icon: UserRoundCheck, tone: 'accent' },
  'request.unassigned_from_you': { icon: UserRoundMinus, tone: 'muted' },
  'approval.requested': { icon: BadgeCheck, tone: 'copper' },
  'approval.resolved': { icon: BadgeCheck, tone: 'accent' },
  'quote.returned': { icon: Undo2, tone: 'copper' },
  'price.pending': { icon: Tag, tone: 'copper' },
  'price.assigned': { icon: Tag, tone: 'success' },
  'note.internal': { icon: StickyNote, tone: 'muted' },
  'project.assigned': { icon: HardHat, tone: 'accent' },
  'project.created': { icon: HardHat, tone: 'muted' },
  'team.work_reassigned': { icon: Users, tone: 'accent' },
  'email.delivery_failed': { icon: MailWarning, tone: 'danger' },
  'request.closed': { icon: CircleX, tone: 'muted' },
  'request.reopened': { icon: RotateCcw, tone: 'accent' },
  'request.information_needed': { icon: CircleHelp, tone: 'copper' },
  'quote.ready': { icon: FileText, tone: 'success' },
  'project.started': { icon: HardHat, tone: 'success' },
  'request.received': { icon: Inbox, tone: 'muted' },
};

export function inboxKindVisual(kind: string): { icon: LucideIcon; tone: InboxTone } {
  return VISUALS[kind] ?? { icon: Inbox, tone: 'muted' };
}
