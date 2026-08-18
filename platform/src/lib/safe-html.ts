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
  const featureList = ['noopener', 'noreferrer', features].filter(Boolean).join(',');
  const printScript = autoPrint
    ? '<script>addEventListener("load",()=>{focus();print()},{once:true})</script>'
    : '';
  const isolatedHtml = printScript
    ? html.replace(/<\/body>/i, `${printScript}</body>`)
    : html;
  const url = URL.createObjectURL(new Blob([isolatedHtml], { type: 'text/html;charset=utf-8' }));
  // Blob documents have an opaque origin; noopener also severs the navigation
  // relationship. Do not depend on the return value: browsers commonly return
  // null precisely because noopener isolation succeeded.
  window.open(url, '_blank', featureList);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
