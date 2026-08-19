import { escapeHtml, openIsolatedHtmlWindow } from './safe-html';
import { generateReceiptHTML } from './services/receipt-service';

describe('safe HTML output', () => {
  test('encodes script payloads and quoted attributes', () => {
    expect(escapeHtml(`<script>alert('x')</script> & "quoted"`))
      .toBe('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quoted&quot;');
  });

  test('receipt HTML encodes every stored text field', () => {
    const payload = '<script>window.opener.pwned=true</script>';
    const html = generateReceiptHTML({
      receiptNumber: payload, patientName: payload, patientId: 'pat-1',
      date: payload, time: payload, method: 'cash', methodLabel: payload,
      amount: 10, currency: payload, reference: payload, processedBy: payload,
      facilityName: payload, notes: payload,
    });
    expect(html).not.toContain(payload);
    expect(html).not.toContain('<script>window.opener');
    expect(html).toContain('&lt;script&gt;window.opener.pwned=true&lt;/script&gt;');
  });

  test('opens a non-print blob document with opener isolation without relying on a window handle', () => {
    const url = 'blob:test';
    const createObjectURL = jest.fn(() => url);
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const open = jest.spyOn(window, 'open').mockReturnValue(null);

    openIsolatedHtmlWindow('<html><body>safe</body></html>', 'width=400');

    expect(createObjectURL).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(url, '_blank', expect.stringContaining('noopener'));
    open.mockRestore();
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  test('auto-print uses a script-free isolated frame under strict CSP', () => {
    openIsolatedHtmlWindow('<html><body>invoice</body></html>', '', true);
    const frame = document.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame?.srcdoc).toContain('invoice');
    expect(frame?.srcdoc).not.toContain('<script');
    expect(frame?.getAttribute('sandbox')).toBe('allow-modals allow-same-origin');
    frame?.remove();
  });
});
