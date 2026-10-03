import type { SmsProvider, SmsSendInput, SmsSendResult } from './provider';
import { noopProvider } from './noop-provider';
import { africasTalkingProvider } from './africas-talking-provider';
import { twilioProvider } from './twilio-provider';
import { normalizePhone } from './text';

let cached: SmsProvider | null = null;

/**
 * Resolve the configured SMS provider from `SMS_PROVIDER` env. Defaults to
 * the no-op so a deploy without credentials does not block the messaging UI.
 * The result is memoised; tests that need to swap providers must call
 * `resetSmsProviderForTest()`.
 */
export function getSmsProvider(): SmsProvider {
  if (cached) return cached;
  const choice = (process.env.SMS_PROVIDER || 'noop').toLowerCase();
  switch (choice) {
    case 'africastalking':
    case 'africas-talking':
      cached = africasTalkingProvider;
      break;
    case 'twilio':
      cached = twilioProvider;
      break;
    default:
      cached = noopProvider;
  }
  return cached;
}

/** Test hook: clear the memoised provider so a new env value takes effect. */
export function resetSmsProviderForTest(): void {
  cached = null;
}

export async function sendSms(input: SmsSendInput): Promise<SmsSendResult> {
  const provider = getSmsProvider();
  const to = normalizePhone(input.to);
  return provider.send({ ...input, to });
}

export type { SmsProvider, SmsSendInput, SmsSendResult, SmsChannel } from './provider';
