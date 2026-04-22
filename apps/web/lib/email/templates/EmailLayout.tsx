import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

/**
 * Shared chrome for every eYKON transactional email. Matches the landing
 * visual language at low risk — most email clients strip anything fancy,
 * so we stay near table-safe CSS and hex colors.
 */
export function EmailLayout({
  preview,
  children,
}: {
  preview: string;
  children: React.ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={brand}>
              eYKON<span style={brandDot}>.ai</span>
            </Text>
            <Text style={tagline}>Geopolitical signals for fast decisions.</Text>
          </Section>
          <Section style={content}>{children}</Section>
          <Hr style={divider} />
          <Section style={footer}>
            <Text style={footerText}>
              You received this email because you have an account or waitlist entry at
              eYKON.ai. Questions?{' '}
              <Link href="mailto:support@eykon.ai" style={footerLink}>
                support@eykon.ai
              </Link>
            </Text>
            <Text style={footerLegal}>
              <Link href="https://mvp.eykon.ai/privacy" style={footerLink}>
                Privacy
              </Link>
              {'  ·  '}
              <Link href="https://mvp.eykon.ai/terms" style={footerLink}>
                Terms
              </Link>
              {'  ·  '}
              <Link href="https://mvp.eykon.ai/refund" style={footerLink}>
                Refund
              </Link>
            </Text>
            <Text style={footerTiny}>© 2026 eYKON.ai</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ─── Style tokens (hex values; not CSS variables, for email-client safety) ───

const body: React.CSSProperties = {
  backgroundColor: '#0A1020',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  margin: 0,
  padding: '32px 0',
  color: '#E6EDF7',
};

const container: React.CSSProperties = {
  maxWidth: 560,
  margin: '0 auto',
  background: '#0F1829',
  border: '1px solid #1F2E48',
  borderRadius: 8,
  overflow: 'hidden',
};

const header: React.CSSProperties = {
  padding: '28px 32px 12px',
  borderBottom: '1px solid #1F2E48',
};

const brand: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: '3px',
  textTransform: 'uppercase',
  color: '#E6EDF7',
};

const brandDot: React.CSSProperties = { color: '#19D0B8' };

const tagline: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 12,
  color: '#8BA3B8',
  letterSpacing: '0.5px',
};

const content: React.CSSProperties = {
  padding: '24px 32px 8px',
};

const divider: React.CSSProperties = {
  borderColor: '#1F2E48',
  margin: '24px 0 0',
};

const footer: React.CSSProperties = {
  padding: '20px 32px 28px',
};

const footerText: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: '#8BA3B8',
  margin: 0,
};

const footerLegal: React.CSSProperties = {
  fontSize: 11,
  color: '#566A82',
  margin: '12px 0 0',
  letterSpacing: '0.5px',
};

const footerTiny: React.CSSProperties = {
  fontSize: 11,
  color: '#566A82',
  margin: '8px 0 0',
};

const footerLink: React.CSSProperties = { color: '#19D0B8', textDecoration: 'none' };

// ─── Reusable content-level styles, exported for per-template use ───

export const styles = {
  h1: {
    fontSize: 22,
    fontWeight: 600,
    color: '#E6EDF7',
    margin: '0 0 12px',
    lineHeight: 1.25,
    letterSpacing: '-0.3px',
  } satisfies React.CSSProperties,
  kicker: {
    fontSize: 11,
    letterSpacing: '2px',
    textTransform: 'uppercase',
    color: '#19D0B8',
    margin: '0 0 10px',
  } satisfies React.CSSProperties,
  paragraph: {
    fontSize: 14,
    lineHeight: 1.6,
    color: '#C6D1E0',
    margin: '0 0 14px',
  } satisfies React.CSSProperties,
  meta: {
    fontSize: 13,
    lineHeight: 1.55,
    color: '#8BA3B8',
    margin: '0 0 10px',
  } satisfies React.CSSProperties,
  button: {
    display: 'inline-block',
    padding: '12px 22px',
    background: '#19D0B8',
    color: '#0A1020',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    borderRadius: 4,
    margin: '14px 0 10px',
  } satisfies React.CSSProperties,
  buttonSecondary: {
    display: 'inline-block',
    padding: '11px 22px',
    border: '1px solid #2A3F5F',
    color: '#C6D1E0',
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    borderRadius: 4,
    margin: '14px 0 10px',
  } satisfies React.CSSProperties,
  panel: {
    background: '#152138',
    border: '1px solid #1F2E48',
    borderRadius: 6,
    padding: '16px 18px',
    margin: '14px 0',
    fontSize: 13,
    color: '#C6D1E0',
  } satisfies React.CSSProperties,
  panelLabel: {
    fontSize: 11,
    color: '#19D0B8',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    margin: '0 0 6px',
  } satisfies React.CSSProperties,
  mono: {
    fontFamily:
      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: 12.5,
    color: '#E6EDF7',
  } satisfies React.CSSProperties,
};
