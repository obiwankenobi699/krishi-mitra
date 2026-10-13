'use client';

import * as React from 'react';

interface RevealProps {
  children: React.ReactNode;
  delayMs?: number;
  className?: string;
  as?: keyof React.JSX.IntrinsicElements;
  id?: string;
}

const BASE_CLASSES =
  'reveal-animated transition-all duration-700 ease-out will-change-transform motion-reduce:transition-none motion-reduce:transform-none';
const HIDDEN_CLASSES = 'opacity-0 translate-y-8';
const VISIBLE_CLASSES = 'opacity-100 translate-y-0';

export default function Reveal({
  children,
  delayMs = 0,
  className = '',
  as = 'div',
  id,
}: RevealProps): React.JSX.Element {
  const ref = React.useRef<HTMLElement | null>(null);
  const [visible, setVisible] = React.useState<boolean>(false);

  React.useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return;
    }
    const fallback = window.setTimeout(() => setVisible(true), 1200);
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry !== undefined && entry.isIntersecting) {
          setVisible(true);
          window.clearTimeout(fallback);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(element);
    return () => {
      window.clearTimeout(fallback);
      observer.disconnect();
    };
  }, []);

  const props: React.HTMLAttributes<HTMLElement> & {
    ref: React.RefObject<HTMLElement | null>;
  } = {
    ref,
    id,
    style: delayMs > 0 ? { transitionDelay: `${delayMs}ms` } : undefined,
    className: `${BASE_CLASSES} ${visible ? VISIBLE_CLASSES : HIDDEN_CLASSES}${className === '' ? '' : ` ${className}`}`,
  };

  return React.createElement(as, props, children);
}
