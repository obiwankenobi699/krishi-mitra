import Image from 'next/image';
import Link from 'next/link';
import type * as React from 'react';
import AuthActionLink from '@/components/AuthActionLink';
import Reveal from '@/components/Reveal';

interface Feature { number: string; title: string; description: string; href: string; image: string; className: string; }

const features: Feature[] = [
  { number: '01', title: 'Diagnose a crop', description: 'Photograph a leaf and get a clear, practical health assessment.', href: '/crop-doctor', image: '/images/leaf-macro.jpg', className: 'km-feature-tall' },
  { number: '02', title: 'Read the whole field', description: 'Understand visible stress, crop cover, moisture patterns, and field variation.', href: '/field-analysis', image: '/images/drone-crop-rows.jpg', className: 'km-feature-wide' },
  { number: '03', title: 'Sell the harvest', description: 'Publish produce and connect directly with nearby buyers.', href: '/marketplace', image: '/images/mandi-vegetables.jpg', className: 'km-feature-small' },
  { number: '04', title: 'Plan the next move', description: 'Ask for crop, scheme, cost, and season guidance in plain language.', href: '/advisor', image: '/images/farmer-phone-field.jpg', className: 'km-feature-small' },
];

const agentSteps = [
  { number: '01', title: 'You share the field', text: 'Send a photo, voice note, crop question, or farm record.' },
  { number: '02', title: 'The right agent takes over', text: 'Vision, farm, market, and finance agents work on the relevant parts.' },
  { number: '03', title: 'Knowledge is checked', text: 'Local Ollama models combine your context with trusted farm documents.' },
  { number: '04', title: 'You get an action', text: 'See a simple recommendation, save it to your farm, or continue on Telegram.' },
];

const dailyTools = [
  { icon: '◌', title: 'Mandi watch', text: 'Keep useful nearby price signals together.', href: '/marketplace' },
  { icon: '↗', title: 'Weather-ready notes', text: 'Record field conditions before the next task.', href: '/farms' },
  { icon: '◎', title: 'Crop diary', text: 'Keep diagnoses and seasonal decisions searchable.', href: '/diagnoses' },
  { icon: '◒', title: 'Farmer news', text: 'Read relevant agriculture updates without the noise.', href: '/news' },
  { icon: '⌁', title: 'Telegram field access', text: 'Send a crop photo when you are away from the desk.', href: '/telegram' },
  { icon: '＋', title: 'Direct listings', text: 'Turn ready produce into a buyer-facing listing.', href: '/marketplace' },
];

export default function Home(): React.JSX.Element {
  return (
    <main className="km-home">
      <section className="km-hero" aria-labelledby="home-title">
        <div className="km-hero-visual">
          <Image src="/images/tractor-golden-hour.jpg" alt="A tractor moving through a field at golden hour" fill priority quality={92} sizes="(max-width: 900px) 100vw, 58vw" />
          <div className="km-hero-shade" />
          <p className="km-overline km-overline-light">LOCAL INTELLIGENCE · EVERYDAY FARMING</p>
          <div className="km-hero-title-wrap km-title-enter">
            <p className="km-script">Your farm. Understood.</p>
            <h1 id="home-title">Farming, with a friend who knows.</h1>
            <Link href="/crop-doctor" className="km-circle-link" aria-label="Open crop doctor">↗</Link>
          </div>
        </div>
        <div className="km-hero-story">
          <div className="km-title-enter km-title-enter-late"><p className="km-overline">MEET KRISHI MITRA</p><h2>One calm place for every decision from soil to sale.</h2></div>
          <div className="km-story-image"><Image src="/images/india-terraced-fields.jpg" alt="Green terraced fields in India" fill sizes="(max-width: 900px) 100vw, 32vw" /><span>Built around your land</span></div>
          <p className="km-story-copy">Krishi Mitra brings crop diagnosis, field analysis, trusted advice, local news, and a farmer-first marketplace into one connected workspace.</p>
          <div className="km-hero-actions"><AuthActionLink className="km-button km-button-dark" signedInLabel="Open my farm" signedOutLabel="Start with Google" /><Link href="#services" className="km-text-link">Explore the platform ↓</Link></div>
        </div>
      </section>

      <section className="km-marquee" aria-label="Platform principles"><span>PRIVATE BY DESIGN</span><i /><span>LOCAL OLLAMA AI</span><i /><span>BUILT FOR INDIAN FARMS</span><i /><span>FIELD TO MARKET</span></section>

      <section id="services" className="km-section km-services" aria-labelledby="services-title">
        <Reveal className="km-section-heading"><div><p className="km-overline">THE FARMER&apos;S TOOLKIT</p><h2 id="services-title">One season.<br />One connected view.</h2></div><p>Use only what you need today. Every useful result becomes part of your farm&apos;s memory for tomorrow.</p></Reveal>
        <div className="km-feature-grid">
          {features.map((feature, index) => (
            <Reveal key={feature.title} delayMs={index * 80} className={feature.className}>
              <Link href={feature.href} className="km-feature-card"><Image src={feature.image} alt="" fill sizes="(max-width: 760px) 100vw, 50vw" /><div className="km-card-shade" /><span className="km-card-number">{feature.number}</span><div className="km-card-copy"><h3>{feature.title}</h3><p>{feature.description}</p></div><span className="km-card-arrow">↗</span></Link>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="km-section km-field-story" aria-labelledby="field-title">
        <div className="km-field-image"><Image src="/images/drone-crop-rows.jpg" alt="Aerial view of crop rows showing field variation" fill sizes="(max-width: 900px) 100vw, 54vw" /><div className="km-field-label"><span>FIELD PULSE</span><strong>See variation early.</strong></div></div>
        <Reveal className="km-field-copy"><p className="km-overline">FROM A PHOTO TO A PLAN</p><h2 id="field-title">Look closer.<br />Act sooner.</h2><p>Capture what you see in the field. Krishi Mitra turns images and farm context into a structured analysis you can understand and revisit.</p><dl><div><dt>01</dt><dd>Crop and disease signals</dd></div><div><dt>02</dt><dd>Field condition summary</dd></div><div><dt>03</dt><dd>Practical next actions</dd></div></dl><Link href="/field-analysis" className="km-button km-button-outline">Analyse a field <span>↗</span></Link></Reveal>
      </section>

      <section className="km-agent" aria-labelledby="agent-title">
        <Reveal className="km-agent-intro"><p className="km-overline km-overline-light">HOW THE AI AGENT WORKS</p><h2 id="agent-title">Many specialists.<br />One useful answer.</h2><p>You do not need to choose a model or write a perfect prompt. Krishi Mitra understands the job, calls the right local agents, and returns one clear result.</p><Link href="/advisor" className="km-button km-button-lime">Ask Krishi Mitra <span>↗</span></Link></Reveal>
        <div className="km-agent-flow">
          {agentSteps.map((step, index) => <Reveal key={step.number} delayMs={index * 90} className="km-agent-step"><span>{step.number}</span><div><h3>{step.title}</h3><p>{step.text}</p></div><i aria-hidden="true" /></Reveal>)}
        </div>
      </section>

      <section className="km-section km-daily" aria-labelledby="daily-title">
        <Reveal className="km-section-heading"><div><p className="km-overline">USEFUL, EVEN ON A BUSY DAY</p><h2 id="daily-title">Small tools.<br />Fewer loose ends.</h2></div><p>Designed for quick checks at home, in the field, or from Telegram—without turning farming into software administration.</p></Reveal>
        <div className="km-daily-layout">
          <div className="km-daily-gallery"><div className="km-daily-image"><Image src="/images/farm-rows.jpg" alt="Healthy crop rows across a green field" fill sizes="(max-width: 900px) 100vw, 42vw" /><span>One season of context, kept together</span></div></div>
          <div className="km-tool-list">{dailyTools.map((tool) => <Link href={tool.href} key={tool.title} className="km-tool"><b>{tool.icon}</b><div><h3>{tool.title}</h3><p>{tool.text}</p></div><span>↗</span></Link>)}</div>
        </div>
      </section>

      <section className="km-closing" aria-labelledby="closing-title">
        <Reveal className="km-closing-copy"><p className="km-overline km-overline-light">GROW WITH CLARITY</p><h2 id="closing-title">Every field has a story.<br />Make yours easier to read.</h2><p>Start with one crop photo, one listing, or one question.</p><div><AuthActionLink className="km-button km-button-lime" signedInLabel="Open my farm" signedOutLabel="Create your farm" /><Link href="/marketplace" className="km-button km-button-glass">Visit marketplace</Link></div></Reveal>
      </section>
    </main>
  );
}
