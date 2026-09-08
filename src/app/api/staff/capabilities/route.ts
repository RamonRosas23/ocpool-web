import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/server/auth/permissions';
import { requireStaffActor } from '@/server/auth/staff';
import { requestId } from '@/server/auth/http';
import { toErrorResponse } from '@/server/http/errors';

export async function GET(request: NextRequest) {
  const id = requestId();
  try {
    const actor = await requireStaffActor(request);
    return NextResponse.json({
      catalogRead: hasPermission(actor, 'catalog.read'),
      catalogManage: hasPermission(actor, 'catalog.manage'),
      pricesRead: hasPermission(actor, 'prices.read'),
      pricesManage: hasPermission(actor, 'prices.manage'),
      quotesRead: hasPermission(actor, 'quotes.read'),
      quotesCreate: hasPermission(actor, 'quotes.create'),
      quotesEditPrices: hasPermission(actor, 'quotes.edit_prices'),
      quotesApplyDiscount: hasPermission(actor, 'quotes.apply_discount'),
      quotesApproveDiscount: hasPermission(actor, 'quotes.approve_discount'),
      quotesSend: hasPermission(actor, 'quotes.send'),
      quotesPdfRead: hasPermission(actor, 'quotes.pdf.read'),
      quotesPdfGenerate: hasPermission(actor, 'quotes.pdf.generate'),
      messagingRead: hasPermission(actor, 'messaging.read'),
      messagingSend: hasPermission(actor, 'messaging.send'),
      messagingInternalNotesRead: hasPermission(actor, 'messaging.internal_notes.read'),
      messagingInternalNotesWrite: hasPermission(actor, 'messaging.internal_notes.write'),
      messagingManage: hasPermission(actor, 'messaging.manage'),
      filesRead: hasPermission(actor, 'files.read'),
      filesUpload: hasPermission(actor, 'files.upload'),
      filesDownload: hasPermission(actor, 'files.download'),
      filesDelete: hasPermission(actor, 'files.delete'),
      filesInternalRead: hasPermission(actor, 'files.internal.read'),
      filesManage: hasPermission(actor, 'files.manage'),
      auditRead: hasPermission(actor, 'audit.read'),
      auditSecurityRead: hasPermission(actor, 'audit.security.read'),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return toErrorResponse(error, id);
  }
}
