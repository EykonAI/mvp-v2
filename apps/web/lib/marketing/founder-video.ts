/**
 * The founder recording, and the one place its path is declared.
 *
 * Both null until the file lands in /public/start/. While null, every slot
 * that reads this renders its styled fallback — never a broken <video>, never
 * an empty box. Flip these two constants and the surfaces light up together.
 *
 * WHY THIS FILE EXISTS
 * The landing page and /start both want the same recording. Before this, the
 * only declaration was a pair of file-local constants inside
 * app/start/StartScreen.tsx, not exported — so "one upload lights both" was
 * not actually possible, it just looked possible. Verified 2026-09-01:
 * /public/start/ does not exist and there is no video asset anywhere under
 * public/.
 *
 * RESIDUAL, AND IT IS DELIBERATE
 * app/start/StartScreen.tsx still carries its own local VIDEO_SRC and
 * VIDEO_POSTER. Pointing it at this module is a three-line change, but it
 * edits app/start/ — which the LP v2 build prompt forbids in the landing-page
 * PRs, as the mechanical test that this page never absorbs the funnel. So the
 * swap is left for a PR that is allowed to touch that path.
 *
 * Until that lands, TWO places must be flipped, not one. That is a footgun and
 * it is written down here so nobody discovers it by shipping a video that
 * appears on one page only.
 */

/** Self-hosted MP4. No third-party embed: this audience blocks those players. */
export const FOUNDER_VIDEO_SRC: string | null = null;

/** Poster frame. Without it the slot falls back rather than showing a black rectangle. */
export const FOUNDER_VIDEO_POSTER: string | null = null;

/** Stated on the poster, because an unlabelled video is a cost nobody accepts blind. */
export const FOUNDER_VIDEO_RUNTIME = '2 min';
