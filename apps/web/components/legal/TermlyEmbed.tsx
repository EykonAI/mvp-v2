'use client';
import { useEffect } from 'react';

const TERMLY_SCRIPT_ID = 'termly-jssdk';
const TERMLY_SCRIPT_SRC = 'https://app.termly.io/embed-policy.min.js';

function loadTermlyScript(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(TERMLY_SCRIPT_ID)) return;
  const script = document.createElement('script');
  script.id = TERMLY_SCRIPT_ID;
  script.src = TERMLY_SCRIPT_SRC;
  script.async = true;
  document.body.appendChild(script);
}

export function TermlyEmbed({
  policyId,
  policyName,
}: {
  policyId: string | undefined;
  policyName: string;
}) {
  useEffect(() => {
    if (policyId) loadTermlyScript();
  }, [policyId]);

  if (!policyId) {
    return (
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px dashed var(--rule-strong)',
          borderRadius: 4,
          padding: '24px 20px',
          color: 'var(--ink-dim)',
          fontFamily: 'var(--f-mono)',
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        <div style={{ color: 'var(--amber)', marginBottom: 8, fontSize: 10.5, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          Policy not yet configured
        </div>
        <p style={{ margin: 0 }}>
          This page will render the <strong>{policyName}</strong> policy generated in Termly
          once its UUID is set in the <code>NEXT_PUBLIC_TERMLY_*</code> environment variables.
          Draft content lives in the Termly dashboard until published.
        </p>
      </div>
    );
  }

  return (
    <div
      // Termly injects the policy into this div. The class name and data
      // attributes are what Termly's script targets — do not rename them.
      className="termly-document-embed"
      data-id={policyId}
      data-type="iframe"
      data-name={policyName}
      style={{ minHeight: 480 }}
    />
  );
}
