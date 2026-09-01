import type { NextRequest } from 'next/server';
import { socialRedirect } from '@/lib/social/redirect';

// eykon.ai/discord — the marketing link. See lib/social/links.ts for
// why this is a route we own rather than a Discord vanity URL.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(req: NextRequest) {
  return socialRedirect(req, 'discord');
}
