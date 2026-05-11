import { Button, Link, Text } from '@react-email/components';
import { EmailLayout, styles } from './EmailLayout';
import { APP_URL } from '@/lib/url';

export type ObserverWelcomeProps = {
  // Best-effort first name from user_profiles.full_name (first whitespace-
  // delimited token). Empty string is fine — the greeting drops to
  // "Hello,".
  firstName: string;

  // Persona-aware phrase inserted under the platform pitch. Mapped from
  // user_profiles.persona at enqueue time. Empty string when the user
  // didn't pick a persona — the surrounding copy reads naturally without
  // any awkward gap.
  personaPhrase: string;
};

// Persona phrases — kept here next to the template for review locality.
// Mirrors the table in 2026-05-11_observer-welcome-email_draft.md.
export const PERSONA_PHRASES: Record<string, string> = {
  analyst:
    'We have built it for analysts like you — every claim is sourced, every prediction is calibrated, and the AI cites where it found things.',
  journalist:
    'We have built it with journalists in mind — every fact links to its source, and the AI flags what is still unverified.',
  'day-trader':
    'We have built it with market-moving timelines in mind — every signal carries a confidence band and a horizon.',
  commodities:
    'We have built it for commodities desks — chokepoints, refineries, and shipping flows are all live.',
  ngo:
    'We have built it for humanitarian-access work — displacement, border crossings, and infrastructure status are the load-bearing layers.',
  corporate:
    'We have built it for corporate risk — asset exposure, supply chain, and workforce safety surface first.',
  citizen:
    'We have built it to be understandable in plain English — every brief is jargon-free and flags what is still unclear.',
};

export function ObserverWelcome({
  firstName,
  personaPhrase,
}: ObserverWelcomeProps) {
  const greeting = firstName ? `Hello ${firstName},` : 'Hello,';

  return (
    <EmailLayout
      preview="The free tier, what it gives you today, and what unlocks if you go further."
    >
      <Text style={styles.h1}>{greeting}</Text>

      <Text style={styles.paragraph}>
        eYKON is real-time geopolitical intelligence on one live map, with a
        calibrated AI analyst that cites its sources. Vessels, aircraft,
        conflicts, energy infrastructure, satellite signals, weather — all
        on one globe, all queryable in plain English.
      </Text>

      <Text style={styles.paragraph}>
        You just signed up for Observer, our free tier.
        {personaPhrase ? ` ${personaPhrase}` : ''} Here is what you can do
        today, and what unlocks if you decide to go further.
      </Text>

      <div style={styles.panel}>
        <Text style={styles.panelLabel}>
          ·· What you have today as Observer ·· free, no time limit ··
        </Text>
        <Text style={{ ...styles.paragraph, margin: 0 }}>
          • The live 3D globe with all map layers — vessels, aircraft,
          conflicts, infrastructure, weather
          <br />• A daily personalised briefing on the home screen, refreshed
          every morning
          <br />• A weekly briefing email every Tuesday at 09:00 UTC
          <br />• 1 watchlist — pin the assets, regions, or counterparties
          you want to track
          <br />• 1 live notification rule, delivered by email, picked from
          our suggestion library
          <br />• 5 AI Analyst queries per calendar month
          <br />• A read-only preview of the Calibration Ledger — see how we
          mark our own predictions and source them
          <br />• The other 8 Intelligence Center workspaces visible as
          preview tiles
        </Text>
      </div>

      <div style={styles.panel}>
        <Text style={styles.panelLabel}>
          ·· What Pro unlocks, when you are ready ··
        </Text>
        <Text style={{ ...styles.paragraph, margin: 0 }}>
          • All 9 Intelligence Center workspaces with live data — Calibration,
          Shadow Fleet, Cascade, Chokepoint, Commodities, Critical Minerals,
          Precursor Analogs, Regime Shifts, Sanctions
          <br />• 500 AI Analyst queries per month, with the full tool
          surface including cross-feed convergence analysis
          <br />• Up to 10 active notification rules across email, SMS, and
          WhatsApp
          <br />• Full historical export of any data on the platform
          <br />• A daily structured briefing — the long-form version of the
          weekly one you already receive
          <br />• API access at Desk and above
        </Text>
      </div>

      <Text style={styles.paragraph}>
        <strong style={{ color: '#E6EDF7' }}>Earn while you learn.</strong>{' '}
        Every Observer user has access to our referral program. Share your
        referral link with analysts you respect — when one of them subscribes,
        you earn a reward.{' '}
        <Link href={`${APP_URL}/grow`} style={{ color: '#19D0B8' }}>
          Find your link at eykon.ai/grow
        </Link>
        .
      </Text>

      <Button href={`${APP_URL}/app`} style={styles.button}>
        Open the globe →
      </Button>

      <Text style={styles.meta}>
        Questions? Reply to this email — it goes to a real human.
      </Text>

      <Text style={styles.meta}>— The eYKON team</Text>
    </EmailLayout>
  );
}
