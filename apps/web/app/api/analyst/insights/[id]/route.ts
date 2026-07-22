import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/analyst/access';
import { getInsightOwned, deleteInsight } from '@/lib/analyst/store';

// DELETE /api/analyst/insights/[id] — remove a saved insight from the
// reading room. Pro+; ownership enforced.

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const caller = await requireSessionAccess('pro');
  if (caller instanceof NextResponse) return caller;
  try {
    const insight = await getInsightOwned(params.id, caller.userId);
    if (!insight) return NextResponse.json({ error: 'not found' }, { status: 404 });
    await deleteInsight(insight.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[analyst/insights/:id] DELETE failed:', err?.message);
    return NextResponse.json({ error: 'failed to delete insight' }, { status: 500 });
  }
}
