'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import {
  Phone, Banknote, CreditCard, CheckCircle2, Clock,
  AlertTriangle, XCircle, Wallet,
} from '@/components/icons/lucide';

/* ─────────────────────────────────────────────────────────────
   Pay-by-link checkout — PUBLIC page (no staff auth).

   A patient/payer opens the link we handed them. We fetch the link via the
   public /api/checkout helper (which returns only payer-facing fields), show
   the amount + description + accepted payment methods, and let them record a
   PENDING payment. The real confirmation arrives later via the provider
   webhook — this page never claims the payment is completed.
   ───────────────────────────────────────────────────────────── */

type LinkStatus = 'active' | 'expired' | 'used';

interface CheckoutLink {
  linkId: string;
  status: LinkStatus;
  amount: number;
  currency: string;
  description: string;
  expiresAt: string;
}

type UiMethod = 'mpesa' | 'mtn' | 'airtel' | 'card' | 'bank' | 'cash';

const PAYMENT_METHODS: { key: UiMethod; name: string; icon: typeof Phone; desc: string; color: string }[] = [
  { key: 'mpesa', name: 'M-Pesa', icon: Phone, desc: 'Pay via M-Pesa mobile money', color: '#4CAF50' },
  { key: 'mtn', name: 'MTN Mobile Money', icon: Phone, desc: 'Pay via MTN MoMo', color: '#FFC107' },
  { key: 'airtel', name: 'Airtel Money', icon: Phone, desc: 'Pay via Airtel Money', color: '#E53935' },
  { key: 'card', name: 'Card Payment', icon: CreditCard, desc: 'Pay with a debit or credit card', color: 'var(--accent-primary)' },
  { key: 'bank', name: 'Bank Transfer', icon: Banknote, desc: 'Pay via bank transfer', color: '#00897B' },
  { key: 'cash', name: 'Cash at Facility', icon: Wallet, desc: 'Pay in cash at the facility desk', color: 'var(--accent-primary)' },
];

const isMobileMoney = (m: UiMethod | null) => m === 'mpesa' || m === 'mtn' || m === 'airtel';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: 'calc(100vh - 52px)', background: 'var(--bg-primary)', padding: '32px 20px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

export default function CheckoutPage() {
  const { linkId } = useParams<{ linkId: string }>();

  const [link, setLink] = useState<CheckoutLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [method, setMethod] = useState<UiMethod | null>(null);
  const [payerPhone, setPayerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      setLoadError(null);
      try {
        const res = await fetch(`/api/checkout?linkId=${encodeURIComponent(linkId)}`, {
          headers: { Accept: 'application/json' },
        });
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          setLoadError('We could not load this payment link. Please try again.');
          return;
        }
        const data = (await res.json()) as CheckoutLink;
        if (!cancelled) setLink(data);
      } catch {
        if (!cancelled) setLoadError('We could not reach the server. Please check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [linkId]);

  const submit = async () => {
    if (!method || submitting || !link) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkId, method, payerPhone: isMobileMoney(method) ? payerPhone : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Link became unpayable (expired/used) between load and submit.
        setLink(prev => (prev ? { ...prev, status: (data.status as LinkStatus) || prev.status } : prev));
        return;
      }
      if (!res.ok || !data.reference) {
        setSubmitError(data.error || 'We could not record your payment. Please try again.');
        return;
      }
      setReference(data.reference as string);
    } catch {
      setSubmitError('We could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const fmtAmount = (amount: number, currency: string) =>
    `${amount.toLocaleString()} ${currency}`;

  /* ── Loading ── */
  if (loading) {
    return (
      <Shell>
        <div className="card-elevated" style={{ textAlign: 'center', padding: 48 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading payment details…</p>
        </div>
      </Shell>
    );
  }

  /* ── Not found / load error ── */
  if (notFound || loadError) {
    return (
      <Shell>
        <div className="card-elevated" style={{ textAlign: 'center', padding: '40px 28px', borderTop: '4px solid var(--color-danger)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(218,18,48,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <XCircle size={56} style={{ color: 'var(--color-danger)' }} />
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            {notFound ? 'Payment link not found' : 'Something went wrong'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {notFound
              ? 'This payment link is invalid or has expired. Please contact the facility that sent it to you for a new link.'
              : loadError}
          </p>
        </div>
      </Shell>
    );
  }

  if (!link) return null;

  /* ── Confirmation (pending) ── */
  if (reference) {
    return (
      <Shell>
        <div className="card-elevated" style={{ textAlign: 'center', padding: '40px 28px', borderTop: '4px solid var(--accent-primary)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Clock size={56} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Payment submitted</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            We have recorded your payment and it is now being confirmed. {isMobileMoney(method)
              ? 'If prompted on your phone, approve the mobile-money request to complete the transaction.'
              : 'The facility will confirm receipt shortly.'}
          </p>
          <div style={{ padding: 16, borderRadius: 10, background: 'var(--overlay-subtle)', border: '1px solid var(--border-medium)', textAlign: 'left', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Reference</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-platform-mono)' }}>{reference}</p>
              </div>
              <div>
                <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Amount</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{fmtAmount(link.amount, link.currency)}</p>
              </div>
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Keep this reference for your records. You can close this page.
          </p>
        </div>
      </Shell>
    );
  }

  /* ── Already paid / expired ── */
  if (link.status === 'used' || link.status === 'expired') {
    const used = link.status === 'used';
    return (
      <Shell>
        <div className="card-elevated" style={{ textAlign: 'center', padding: '40px 28px', borderTop: `4px solid ${used ? 'var(--color-success)' : 'var(--color-warning)'}` }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: used ? 'rgba(31,157,111,0.1)' : 'rgba(217,119,6,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            {used
              ? <CheckCircle2 size={56} style={{ color: 'var(--color-success)' }} />
              : <AlertTriangle size={56} style={{ color: 'var(--color-warning)' }} />}
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            {used ? 'Already paid' : 'Link expired'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {used
              ? 'This payment link has already been paid. No further action is needed.'
              : 'This payment link has expired. Please contact the facility for a new link.'}
          </p>
        </div>
      </Shell>
    );
  }

  /* ── Active: choose method + confirm ── */
  const selected = PAYMENT_METHODS.find(m => m.key === method);
  return (
    <Shell>
      {/* Amount banner */}
      <div style={{
        background: 'linear-gradient(135deg, #015697 0%, #2191D0 60%, #369FDA 100%)',
        borderRadius: 14, padding: '22px 24px', color: '#fff', marginBottom: 16, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -20, right: -20, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.7, marginBottom: 6 }}>Amount due</p>
        <p style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>
          {link.amount.toLocaleString()} <span style={{ fontSize: 15, opacity: 0.7 }}>{link.currency}</span>
        </p>
        <p style={{ fontSize: 13, opacity: 0.85, marginTop: 8 }}>{link.description}</p>
      </div>

      {/* Method picker */}
      <div className="card-elevated" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Choose a payment method</h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Select how you would like to pay this amount.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {PAYMENT_METHODS.map(m => (
            <button key={m.key} type="button" onClick={() => setMethod(m.key)} style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 16px',
              borderRadius: 10, border: method === m.key ? `2px solid ${m.color}` : '1px solid var(--border-medium)',
              background: method === m.key ? `${m.color}08` : 'var(--bg-card-solid)',
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
            }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${m.color}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <m.icon size={20} style={{ color: m.color }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{m.name}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.desc}</p>
              </div>
              {method === m.key && <CheckCircle2 size={20} style={{ color: m.color }} />}
            </button>
          ))}
        </div>

        {isMobileMoney(method) && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Mobile money number</label>
            <input
              type="tel"
              value={payerPhone}
              onChange={e => setPayerPhone(e.target.value)}
              placeholder="e.g. +211 9XX XXX XXX"
              style={{ width: '100%', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border-medium)', background: 'var(--bg-card-solid)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
            />
          </div>
        )}

        {selected && (
          <div style={{ padding: 10, borderRadius: 8, background: `${selected.color}10`, border: `1px solid ${selected.color}20`, marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: selected.color, fontWeight: 600 }}>
              {isMobileMoney(method)
                ? 'After you confirm, approve the payment prompt on your phone to complete the transaction.'
                : method === 'cash'
                ? 'After you confirm, present this amount at the facility cashier to complete payment.'
                : 'After you confirm, follow the provider instructions to complete the transfer.'}
            </p>
          </div>
        )}

        {submitError && (
          <div role="alert" style={{ padding: 10, borderRadius: 8, background: 'rgba(218,18,48,0.06)', border: '1px solid rgba(218,18,48,0.15)', marginBottom: 14 }}>
            <p style={{ fontSize: 12, color: '#DA1230', fontWeight: 600 }}>{submitError}</p>
          </div>
        )}

        <button
          type="button"
          onClick={() => { void submit(); }}
          disabled={!method || submitting}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 8, border: 'none',
            background: method ? 'var(--accent-primary)' : 'var(--border-medium)',
            color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: method && !submitting ? 'pointer' : 'not-allowed',
            opacity: method ? 1 : 0.5,
          }}
        >
          {submitting ? 'Submitting…' : `I've paid ${fmtAmount(link.amount, link.currency)}`}
        </button>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
          Your payment will be confirmed by the facility once received.
        </p>
      </div>
    </Shell>
  );
}
