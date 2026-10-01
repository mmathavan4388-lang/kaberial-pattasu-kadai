import { config } from '../config.js';
import { HttpError } from '../lib/http.js';

// Pluggable SMS transport for mobile OTP. No provider is bundled: wire MSG91/Twilio/etc.
// here. In development the code is printed to the server console. In production an
// unconfigured provider makes OTP unavailable instead of pretending to send.
export async function sendOtp(mobile, code) {
  if (config.sms.provider) {
    throw new HttpError(501, 'sms_provider_not_implemented', `Implement SMS provider '${config.sms.provider}' in services/sms.js`);
  }
  if (config.isProd) throw new HttpError(503, 'sms_not_configured');
  if (!config.isTest) console.log(`[dev] OTP for ${mobile}: ${code}`);
}
