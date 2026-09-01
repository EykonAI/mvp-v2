import type { NextRequest } from 'next/server';
import { socialRedirect } from '@/lib/social/redirect';

// eykon.ai/x — the marketing link to @eykon_ai.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(req: NextRequest) {
  return socialRedirect(req, 'x');
}
