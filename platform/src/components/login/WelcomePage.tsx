'use client';

/**
 * The welcome page at `/`: which door, before which password.
 *
 * 2026-11-06 (user: "theres no welcome page, use the tamamhealth design but
 * learn from this tebra"). `/` used to redirect straight to the staff sign-in,
 * so a ministry official, a patient and a platform operator all met a form
 * that assumed they were facility staff. Tebra's pattern: a split screen, the
 * left half a short greeting and one card per kind of account, the right half
 * a brand panel. Drawn here in the sign-in language (login-chrome: Barlow,
 * blueprint frames with registration marks, navy ink, Tamam blue), so the
 * welcome page and the sign-in page are one front step.
 *
 * The cards carry the door to the sign-in page (`?portal=`), which only
 * changes the picture beside the form. Sign-in itself takes credentials
 * alone; the account decides the workspace.
 *
 * Signed in already (the installed app opens at `/`, and a forced password
 * change returns here): straight on to the account's own landing page.
 */
import { useEffect, type ComponentType, type SVGProps } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { resolveLandingPage } from '@/lib/user-prefs';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Corners } from '@/components/login/login-chrome';
import {
  ArrowUpRight, BarChart3, FlaskConical, HeartPulse, Pill, ShieldCheck, Stethoscope, Users,
} from '@/components/icons/lucide';
import './welcome.css';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface Door {
  key: string;
  href: string;
  icon: Icon;
  titleKey: string;
  metaKey: string;
}

/** The three doors people use daily. The platform console is a line beneath. */
const DOORS: readonly Door[] = [
  { key: 'staff', href: '/login', icon: Stethoscope, titleKey: 'welcome.staffTitle', metaKey: 'welcome.staffMeta' },
  { key: 'ministry', href: '/login?portal=ministry', icon: BarChart3, titleKey: 'welcome.ministryTitle', metaKey: 'welcome.ministryMeta' },
  { key: 'patient', href: '/patient-portal', icon: HeartPulse, titleKey: 'welcome.patientTitle', metaKey: 'welcome.patientMeta' },
];

/** The record's stations, around the mark: one patient story, five places it is written. */
const RING: readonly { icon: Icon; labelKey: string }[] = [
  { icon: Users, labelKey: 'welcome.ringRegistration' },
  { icon: Stethoscope, labelKey: 'welcome.ringConsultation' },
  { icon: FlaskConical, labelKey: 'welcome.ringLab' },
  { icon: Pill, labelKey: 'welcome.ringPharmacy' },
  { icon: BarChart3, labelKey: 'welcome.ringReports' },
];

const RING_SIZE = 320;
const RING_RADIUS = 128;
/** Degrees of arc left open either side of a station, so the line stops short of it. */
const RING_GAP = 15;

function point(angle: number, radius = RING_RADIUS) {
  const rad = (angle * Math.PI) / 180;
  return { x: RING_SIZE / 2 + radius * Math.cos(rad), y: RING_SIZE / 2 + radius * Math.sin(rad) };
}

/** The arcs between stations: a circle broken at each one. */
function ringArcs(): string[] {
  const step = 360 / RING.length;
  return RING.map((_, i) => {
    const from = point(-90 + i * step + RING_GAP);
    const to = point(-90 + (i + 1) * step - RING_GAP);
    return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${RING_RADIUS} ${RING_RADIUS} 0 0 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
  });
}

export default function WelcomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated, currentUser } = useAuth();

  useEffect(() => {
    if (isAuthenticated && currentUser) router.replace(resolveLandingPage(currentUser.role));
  }, [isAuthenticated, currentUser, router]);

  const year = new Date().getFullYear();
  const step = 360 / RING.length;

  return (
    <div className="lg-root wl-root">
      <div className="wl-split">
        <section className="wl-main" aria-labelledby="wl-title">
          <header className="wl-brand">
            {/* On every front-step page the logo is the way home, and home is
                this page, so here it is not a link. The website is in the
                footer, as on the other front-step pages. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed-height SVG logo */}
            <img src="/assets/tamamhealth-logo-full.svg" alt={t('ui.tamamHealthcareSystem')} className="wl-logo" />
          </header>

          <div className="wl-body">
            <h1 id="wl-title" className="wl-title">{t('welcome.title')}</h1>
            <p className="wl-lede">{t('welcome.lede')}</p>

            <ul className="wl-doors">
              {DOORS.map(door => {
                const DoorIcon = door.icon;
                return (
                  <li key={door.key}>
                    <a className="wl-door blueprint" href={door.href} data-door={door.key}>
                      <Corners />
                      <span className="wl-door-icon" aria-hidden="true"><DoorIcon /></span>
                      <span className="wl-door-title">{t(door.titleKey)}</span>
                      <span className="wl-door-meta">{t(door.metaKey)}</span>
                      <span className="wl-door-go">
                        {t('welcome.signIn')}
                        <span className="wl-door-arrow" aria-hidden="true"><ArrowUpRight /></span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>

            {/* A patient's first visit here is with the activation slip the
                desk printed at registration. That is their way in, so it sits
                beside the doors rather than one click behind the portal's
                sign-in form. */}
            <p className="wl-more">
              {t('welcome.activateLine')}{' '}
              <a href="/patient-portal/activate">{t('welcome.activateLink')}</a>
            </p>
            <p className="wl-more wl-more-quiet">{t('welcome.noAccount')}</p>
            <p className="wl-admin">
              <ShieldCheck aria-hidden="true" />
              {t('welcome.adminLine')}{' '}
              <a href="/login?portal=admin">{t('welcome.adminLink')}</a>
            </p>
          </div>
        </section>

        <aside className="wl-panel" aria-labelledby="wl-panel-title">
          <figure className="wl-ring" aria-label={t('welcome.ringLabel')}>
            <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true" focusable="false">
              {ringArcs().map((d, i) => <path key={i} d={d} className="wl-ring-arc" />)}
            </svg>
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size SVG mark */}
            <img src="/assets/tamamhealth-icon-white.svg" alt="" className="wl-ring-mark" />
            {RING.map((station, i) => {
              const StationIcon = station.icon;
              const at = point(-90 + i * step);
              return (
                <span
                  key={station.labelKey}
                  className="wl-ring-node"
                  style={{ left: `${(at.x / RING_SIZE) * 100}%`, top: `${(at.y / RING_SIZE) * 100}%` }}
                  title={t(station.labelKey)}
                >
                  <StationIcon aria-hidden="true" />
                </span>
              );
            })}
          </figure>

          <h2 id="wl-panel-title" className="wl-panel-title">{t('login.tagline')}</h2>
          <p className="wl-panel-copy">{t('login.promoBody')}</p>
          <a className="wl-panel-link" href="https://tamamhealth.org/products">
            {t('login.seeProducts')}
            <span className="wl-door-arrow" aria-hidden="true"><ArrowUpRight /></span>
          </a>
        </aside>
      </div>

      <footer className="wl-footer">
        <span>{t('welcome.copyright', { year })}</span>
        <nav aria-label={t('welcome.legal')}>
          <a href="/terms">{t('login.termsAndConditions')}</a>
          <a href="/privacy">{t('login.privacyPolicy')}</a>
          <a href="https://tamamhealth.org">{t('login.backToSite')}</a>
        </nav>
      </footer>
    </div>
  );
}
