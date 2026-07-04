import { createServerSupabase } from '@/lib/supabase-server';

// BRIEFS · Today's brief. Reads the persisted daily brief written by the
// generate-daily-brief cron into daily_briefs (migration 071) — one narrated
// plain-language brief per UTC day. Falls back to the most recent stored day
// so a missed cron tick degrades to yesterday's brief, never to an error.
//
// Columns verified against supabase/migrations/071_daily_briefs.sql.

export interface DailyBriefRow {
  briefDate: string;    // YYYY-MM-DD (UTC)
  content: string;
  isQuiet: boolean;
  generatedAt: string;
  isToday: boolean;
}

export async function loadDailyBrief(): Promise<DailyBriefRow | null> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('daily_briefs')
    .select('brief_date, content, is_quiet, generated_at')
    .order('brief_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const todayUtc = new Date().toISOString().slice(0, 10);
  return {
    briefDate: data.brief_date,
    content: data.content,
    isQuiet: data.is_quiet,
    generatedAt: data.generated_at,
    isToday: data.brief_date === todayUtc,
  };
}
