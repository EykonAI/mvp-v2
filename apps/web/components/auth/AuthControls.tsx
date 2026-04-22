'use client';
import { forwardRef, type InputHTMLAttributes, type ButtonHTMLAttributes } from 'react';

type AuthInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(
  function AuthInput({ label, id, ...props }, ref) {
    return (
      <div style={{ marginBottom: 14 }}>
        {label && (
          <label
            htmlFor={id}
            style={{
              display: 'block',
              fontFamily: 'var(--f-mono)',
              fontSize: 10.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-dim)',
              marginBottom: 6,
              fontWeight: 500,
            }}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          style={{
            width: '100%',
            background: 'var(--bg-void)',
            border: '1px solid var(--rule-strong)',
            borderRadius: 4,
            padding: '10px 12px',
            color: 'var(--ink)',
            fontSize: 13.5,
            fontFamily: 'var(--f-body)',
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => {
            e.target.style.borderColor = 'var(--teal)';
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            e.target.style.borderColor = 'var(--rule-strong)';
            props.onBlur?.(e);
          }}
          {...props}
        />
      </div>
    );
  },
);

type AuthButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  fullWidth?: boolean;
};

export function AuthButton({
  variant = 'primary',
  fullWidth = true,
  children,
  disabled,
  style,
  ...props
}: AuthButtonProps) {
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: fullWidth ? '100%' : undefined,
    padding: '11px 14px',
    borderRadius: 4,
    fontFamily: 'var(--f-mono)',
    fontSize: 11.5,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'background 0.15s, border-color 0.15s',
    border: '1px solid transparent',
  };

  const variantStyle: React.CSSProperties =
    variant === 'primary'
      ? {
          background: 'var(--teal)',
          color: 'var(--bg-void)',
          borderColor: 'var(--teal)',
        }
      : variant === 'secondary'
      ? {
          background: 'transparent',
          color: 'var(--ink)',
          borderColor: 'var(--rule-strong)',
        }
      : {
          background: 'transparent',
          color: 'var(--ink-dim)',
          borderColor: 'transparent',
        };

  return (
    <button
      disabled={disabled}
      style={{ ...baseStyle, ...variantStyle, ...style }}
      {...props}
    >
      {children}
    </button>
  );
}

export function Divider({ label }: { label?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        margin: '18px 0',
      }}
    >
      <div style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
      {label && (
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
          }}
        >
          {label}
        </span>
      )}
      <div style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
    </div>
  );
}
