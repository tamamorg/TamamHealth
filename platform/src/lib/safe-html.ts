/**
 * Encode an arbitrary value for an HTML text node.
 *
 * Printable documents are assembled as strings rather than rendered by React,
 * so React's normal output encoding does not protect them. Keep this helper
 * deliberately small and context-specific: it is for text nodes and quoted
 * attribute values, never for CSS or JavaScript contexts.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Open a generated printable document after severing its opener reference.
 * All dynamic values in `html` must still be passed through `escapeHtml`.
 */
export function openIsolatedHtmlWindow(html: string, features = '', autoPrint = false): void {
  if (autoPrint) {
    // Print from a script-free iframe. Strict CSP blocks scripts embedded in
    // generated blob documents, and blob-policy inheritance differs between
    // browsers. The trusted application document invokes print instead.
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.inset = '0';
    frame.onload = () => {
      const printable = frame.contentWindow;
      if (!printable) return;
      printable.focus();
      printable.print();
      printable.addEventListener('afterprint', () => frame.remove(), { once: true });
      setTimeout(() => frame.remove(), 60_000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
    return;
  }
  const featureList = ['noopener', 'noreferrer', features].filter(Boolean).join(',');
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  // Blob documents have an opaque origin; noopener also severs the navigation
  // relationship. Do not depend on the return value: browsers commonly return
  // null precisely because noopener isolation succeeded.
  window.open(url, '_blank', featureList);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
