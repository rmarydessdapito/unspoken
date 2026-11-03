/**
 * App lock: a passcode (stored only as a salted PBKDF2 hash) plus optional biometric unlock
 * via WebAuthn (Face ID / Touch ID / Windows Hello / Android fingerprint).
 *
 * Honest scope: this keeps someone who picks up your unlocked phone or laptop out of the app.
 * The biometric check is a local "user presence + verification" check performed by your device;
 * no server is involved. Audio at rest is protected by your device's own storage encryption
 * (on by default on modern iOS/Android/macOS with FileVault, Windows with BitLocker).
 */

const enc = new TextEncoder();

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function hashPasscode(passcode: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 210_000, hash: 'SHA-256' }, key, 256);
  return { hash: toB64(bits), salt: toB64(salt) };
}

export async function verifyPasscode(passcode: string, hash: string, salt: string): Promise<boolean> {
  const { hash: h } = await hashPasscode(passcode, salt);
  // constant-time-ish compare
  if (h.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export async function biometricAvailable(): Promise<boolean> {
  try {
    return typeof PublicKeyCredential !== 'undefined' && window.isSecureContext && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

/** Register a device credential. Returns its id to store in settings. */
export async function registerBiometric(): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'unspoken' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'unspoken', displayName: 'unspoken' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('biometric setup was cancelled');
  return toB64(cred.rawId);
}

export async function verifyBiometric(credentialId: string): Promise<boolean> {
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64(credentialId) as BufferSource, transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return !!res;
  } catch {
    return false;
  }
}
