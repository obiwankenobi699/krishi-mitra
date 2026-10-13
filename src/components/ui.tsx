'use client';

import Image from 'next/image';
import type * as React from 'react';

type ButtonVariant = 'primary' | 'dark' | 'lime' | 'ghost' | 'secondary';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-green text-white hover:opacity-95',
  dark: 'bg-ink text-white hover:opacity-95',
  lime: 'bg-lime text-deep hover:opacity-95',
  ghost: 'border border-white/70 text-white bg-transparent',
  secondary: 'border border-line bg-white text-ink hover:bg-mist',
};

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      disabled={disabled ?? loading}
      aria-busy={loading}
      className={`km-ui-button inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-60 ${buttonVariants[variant]} ${className}`}
    >
      {loading && (
        <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {loading ? <span>Loading…</span> : children}
    </button>
  );
}

interface PanelProps {
  children: React.ReactNode;
  className?: string;
}

export function Panel({ children, className = '' }: PanelProps): React.JSX.Element {
  return (
    <div className={`km-panel rounded-2xl border border-line bg-white p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Card({ children, className = '' }: PanelProps): React.JSX.Element {
  return (
    <article className={`km-card overflow-hidden rounded-2xl border border-line bg-white shadow-sm ${className}`}>
      {children}
    </article>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  error?: string;
  hint?: string;
  className?: string;
}

export function Field({ label, htmlFor, children, error, hint, className = '' }: FieldProps): React.JSX.Element {
  return (
    <label htmlFor={htmlFor} className={`km-field block text-sm font-semibold text-ink ${className}`}>
      <span className="mb-1.5 block">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs font-normal text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1.5 block text-xs font-normal text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

export const controlClassName =
  'km-control w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm font-normal text-ink placeholder:text-muted focus:border-green focus:outline-2 focus:outline-green';

type NoticeTone = 'info' | 'error' | 'success';

const noticeTones: Record<NoticeTone, string> = {
  info: 'border-line bg-mist text-ink',
  error: 'border-amber-200 bg-amber-50 text-ink',
  success: 'border-green/30 bg-green/10 text-green',
};

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: NoticeTone;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${noticeTones[tone]}`}>
      {children}
    </p>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="km-empty-state rounded-2xl border border-dashed border-line bg-white px-6 py-10 text-center">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }): React.JSX.Element {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-mist ${className}`} />;
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-line bg-white px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  );
}

type BadgeTone = 'default' | 'success' | 'warn' | 'danger' | 'info';

const badgeTones: Record<BadgeTone, string> = {
  default: 'bg-mist text-ink',
  success: 'bg-green/10 text-green',
  warn: 'bg-lime/40 text-deep',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-cream text-ink',
};

export function Badge({ tone = 'default', children }: { tone?: BadgeTone; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

export function severityTone(severity: string | null | undefined): BadgeTone {
  const value = (severity ?? '').toLowerCase();
  if (value.includes('high') || value.includes('severe') || value.includes('critical')) return 'danger';
  if (value.includes('moderate') || value.includes('medium')) return 'warn';
  if (value.includes('low') || value.includes('health') || value.includes('mild')) return 'success';
  return 'default';
}

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}): React.JSX.Element {
  return (
    <div className="mb-5">
      {eyebrow && <p className="text-xs font-bold uppercase tracking-widest text-muted">{eyebrow}</p>}
      <h2 className="mt-1 text-xl font-bold text-ink">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </div>
  );
}

const WARM_HINT = 'Our local models are warming up — retry in a moment.';
const WARM_PATTERN = /warming|waking|503|fetch|network|unavailable|timeout|econn|socket|service|gateway/i;

export function friendlyError(message: string): string {
  if (WARM_PATTERN.test(message)) return `${WARM_HINT} (${message})`;
  return message;
}

export function ErrorCard({
  message,
  onRetry,
  retryLabel = 'Try again',
  title = 'This needs another moment',
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  title?: string;
}): React.JSX.Element {
  return (
    <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-deep font-serif text-lg text-lime">
          ✳
        </span>
        <div className="min-w-0">
          <h2 className="font-serif text-lg font-bold text-ink">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink/80">{friendlyError(message)}</p>
          <div className="mt-4">
            <Button variant="dark" onClick={onRetry}>
              {retryLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RouteHeroProps {
  eyebrow: string;
  title: string;
  description?: string;
  imageSrc: string;
  imageAlt: string;
  chip?: string;
  tone?: 'cream' | 'deep';
  flip?: boolean;
  children?: React.ReactNode;
}

export function RouteHero({
  eyebrow,
  title,
  description,
  imageSrc,
  imageAlt,
  chip,
  tone = 'cream',
  flip = false,
  children,
}: RouteHeroProps): React.JSX.Element {
  const deep = tone === 'deep';
  function hideImage(event: React.SyntheticEvent<HTMLImageElement>): void {
    event.currentTarget.style.display = 'none';
  }
  return (
    <section className={`km-route-hero border-b ${deep ? 'km-route-hero-deep border-deep bg-deep text-white' : 'border-line bg-cream text-ink'}`}>
      <div className="km-route-hero-inner mx-auto grid w-full max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
        <div className={flip ? 'lg:order-2' : ''}>
          <p
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[0.7rem] font-extrabold tracking-[0.22em] ${
              deep ? 'border-white/20 bg-white/10 text-lime' : 'border-line bg-paper text-green'
            }`}
          >
            <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${deep ? 'bg-lime' : 'bg-green'}`} />
            {eyebrow}
          </p>
          <h1 className="mt-6 font-serif text-4xl leading-[1.02] tracking-tight sm:text-5xl md:text-6xl">
            {title}
          </h1>
          {description ? (
            <p className={`mt-5 max-w-xl text-base leading-relaxed md:text-lg ${deep ? 'text-white/75' : 'text-muted'}`}>
              {description}
            </p>
          ) : null}
          {children ? <div className="mt-8 flex flex-wrap gap-3">{children}</div> : null}
        </div>
        <div className={flip ? 'lg:order-1' : ''}>
          <div className={`km-route-hero-image relative aspect-[4/3] overflow-hidden rounded-3xl ${deep ? 'ring-1 ring-white/20' : 'shadow-xl shadow-deep/10 ring-1 ring-ink/5'}`}>
            <Image
              src={imageSrc}
              alt={imageAlt}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 46vw"
              onError={hideImage}
              className="bg-mist object-cover"
            />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-deep/45 via-transparent to-transparent" />
            {chip ? (
              <p className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-lime px-4 py-1.5 text-xs font-bold text-deep">
                {chip}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
