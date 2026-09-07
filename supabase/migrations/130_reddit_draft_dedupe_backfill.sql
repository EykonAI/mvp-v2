-- 130_reddit_draft_dedupe_backfill.sql
--
-- Remove the duplicated paragraph from Reddit drafts already in the queue.
--
-- WHY THESE ROWS ARE WRONG. assembleReddit appended `limitParagraph` and
-- `disclosure` to the body unconditionally, while craft-lints REQUIRED both to
-- be present in the body. A model that also wrote them inline — about half of
-- runs — therefore satisfied the lint, and the append added a second copy. The
-- lint only ever sees the finished text, so it could not tell "model omitted,
-- assembler added" from "model included, assembler added again": it passed the
-- duplicate. The gate enforcing the honesty language is what produced the
-- repetition. Fixed at assembly in #476, which only helps drafts written from
-- then on — these rows were already stored.
--
-- SCOPE, measured 2026-09-07 before writing this:
--   56  Reddit drafts with the postable 2-part shape
--   30  of them carry a duplicated PARAGRAPH  (53.6%) — this migration's target
--   36  paragraphs to remove, 4,182 characters
--    0  on the other three channels, across 479 drafts
--
-- WHAT THIS DOES NOT FIX, stated because it would otherwise look complete.
-- A further 6 drafts repeat a SENTENCE rather than a paragraph, and this
-- migration leaves every one of them untouched:
--   · 5 repeat the disclosure sentence inline, at the end of a paragraph the
--     model had already written, so the two copies live in DIFFERENT
--     paragraphs and no paragraph is an exact repeat.
--   · 1 (7f8547ed) restates the limit paragraph with a different opening
--     clause — "None of this establishes X. <sentence>" beside "This does not
--     establish X. <same sentence>".
-- Deleting a sentence out of running prose would leave an orphan clause, so
-- it is not done here. In code: assembly now suppresses an exact duplicate of
-- either field, which prevents all 5 disclosure cases going forward, and a
-- new 'no-repeated-sentence' craft WARNING surfaces the residue to whoever
-- reviews the draft. These 6 rows are unposted drafts in a queue that
-- regenerates daily — trim the repeat in Reddit's compose window, or let them
-- age out. Total picture: 36 of 56 drafts carry some repetition; 30 are fixed
-- mechanically here, 6 are flagged for a human.
--
-- THE RULE, byte-identical to dedupeParagraphs() in
-- apps/web/lib/copy/channels/reddit/index.ts so the queue and the writer cannot
-- drift: split on a blank line, keep the FIRST occurrence of each paragraph
-- whose trimmed text is >= 40 characters, keep every shorter paragraph
-- untouched, reassemble in the original order. Exact text only — no fuzzy
-- matching, because guessing at semantic equality would silently delete real
-- content. Short lines are exempt because a repeated short line can be
-- legitimate; a repeated paragraph cannot.
--
-- WHAT IT DELIBERATELY WILL NOT TOUCH, encoded in the WHERE rather than
-- asserted here (all three are zero today; the guards are for whenever this is
-- actually run):
--   · status <> 'draft'        — an approved or published row is the RECORD of
--                                what was posted. Rewriting it would make our
--                                stored copy disagree with what is live on
--                                Reddit, which is worse than a duplicate.
--   · edited_body is not null  — text a human wrote. Never rewritten by a
--                                backfill.
--   · published_url is not null
--   · the 11 three-part 'UNASSIGNED' template fallbacks — not postable, and
--     slot 1 there is the title, not the body.
--
-- IDEMPOTENT. The final predicate compares the rebuilt text to what is stored,
-- so a second run matches zero rows.
--
-- `body` is kept as the derived copy it is: every one of the 56 rows satisfies
-- body = posts->>0 || E'\n\n' || posts->>1, and this preserves that. Nothing
-- reads `body` in the review path today (ReviewDraft selects `posts` only), so
-- leaving it stale would plant a duplicate for whoever reads it next.


-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — READ ONLY. Run this block ALONE first and read the numbers.
-- Expect: rows_to_change 30, paragraphs_removed 36, chars_removed 4182.
-- If they differ, stop — new drafts have landed since this was measured
-- and the migration text needs re-checking before it is applied.
-- ─────────────────────────────────────────────────────────────────────
with parts as (
  select d.id, t.ord, t.raw, trim(t.raw) as key
  from newsjack_drafts d,
       unnest(string_to_array(d.posts->>1, E'\n\n')) with ordinality as t(raw, ord)
  where d.channel = 'reddit'
    and d.status = 'draft'
    and d.edited_body is null
    and d.published_url is null
    and jsonb_array_length(d.posts) = 2
),
ranked as (
  select id, ord, raw, key,
         case when length(key) < 40 then 1
              else row_number() over (partition by id, key order by ord)
         end as rn
  from parts
),
rebuilt as (
  select id, string_agg(raw, E'\n\n' order by ord) as self_deduped
  from ranked where rn = 1 group by id
)
select
  count(*) filter (where r.self_deduped <> d.posts->>1)                       as rows_to_change,
  (select count(*) from ranked where rn > 1)                                  as paragraphs_removed,
  (select coalesce(sum(length(raw)), 0) from ranked where rn > 1)             as chars_removed,
  count(*)                                                                    as rows_in_scope
from rebuilt r
join newsjack_drafts d on d.id = r.id;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — THE WRITE. Run only after STEP 1 matches.
-- ─────────────────────────────────────────────────────────────────────
begin;

with parts as (
  select d.id, t.ord, t.raw, trim(t.raw) as key
  from newsjack_drafts d,
       unnest(string_to_array(d.posts->>1, E'\n\n')) with ordinality as t(raw, ord)
  where d.channel = 'reddit'
    and d.status = 'draft'
    and d.edited_body is null
    and d.published_url is null
    and jsonb_array_length(d.posts) = 2
),
ranked as (
  select id, ord, raw, key,
         case when length(key) < 40 then 1
              else row_number() over (partition by id, key order by ord)
         end as rn
  from parts
),
rebuilt as (
  select id, string_agg(raw, E'\n\n' order by ord) as self_deduped
  from ranked where rn = 1 group by id
)
update newsjack_drafts d
set posts      = jsonb_build_array(d.posts->>0, r.self_deduped),
    body       = (d.posts->>0) || E'\n\n' || r.self_deduped,
    updated_at = now()
from rebuilt r
where d.id = r.id
  -- Only rows that actually change. This is what makes the migration
  -- idempotent: on a second run every rebuilt text already equals what is
  -- stored, so nothing matches.
  and r.self_deduped <> d.posts->>1;

-- Expect: UPDATE 30
commit;


-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY. Expect remaining_with_dupes = 0 and body_invariant_ok
-- equal to reddit_2part. Re-running STEP 1 now must report
-- rows_to_change = 0, which proves idempotence.
-- ─────────────────────────────────────────────────────────────────────
with d as (
  select id, body, posts->>0 as title, posts->>1 as self
  from newsjack_drafts
  where channel = 'reddit' and jsonb_array_length(posts) = 2
),
p as (
  select d.id, trim(para) as para
  from d, unnest(string_to_array(d.self, E'\n\n')) as para
  where length(trim(para)) >= 40
),
dup as (
  select id, count(*) - count(distinct para) as dupes from p group by id
)
select
  (select count(*) from d)                                                     as reddit_2part,
  (select count(*) from dup where dupes > 0)                                   as remaining_with_dupes,
  (select count(*) from d where body = title || E'\n\n' || self)               as body_invariant_ok;
