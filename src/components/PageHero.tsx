import type * as React from 'react';

interface PageHeroProps {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}

export default function PageHero({
  eyebrow,
  title,
  description,
  children,
}: PageHeroProps): React.JSX.Element {
  return (
    <section className="border-b border-line bg-cream">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 md:py-20 lg:px-8">
        <p className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-1.5 text-[0.7rem] font-extrabold tracking-[0.22em] text-green">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-green" />
          {eyebrow}
        </p>
        <h1 className="mt-6 max-w-4xl font-serif text-4xl leading-[1.02] tracking-tight text-ink sm:text-5xl md:text-6xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted md:text-lg">{description}</p>
        ) : null}
        {children ? <div className="mt-8 flex flex-wrap gap-3">{children}</div> : null}
      </div>
    </section>
  );
}
