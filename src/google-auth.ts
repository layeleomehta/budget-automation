type ServiceAccount = { client_email: string; private_key: string };

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let cached: { expiresAt: number; token: string } | undefined;

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const encodeJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

const importPrivateKey = (pem: string) => {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' }, false, ['sign']);
};

export const createGoogleTokenProvider = (serviceAccountJson: string) => {
  const serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;

  return async (): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt - 60 > now) {
      return cached.token;
    }

    const unsigned = `${encodeJson({ alg: 'RS256', typ: 'JWT' })}.${encodeJson({
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
      iss: serviceAccount.client_email,
      scope: SCOPE,
    })}`;
    const key = await importPrivateKey(serviceAccount.private_key);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));

    const response = await fetch(TOKEN_URL, {
      body: new URLSearchParams({
        assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}`,
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      }),
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Google token exchange failed with ${response.status}: ${await response.text()}`);
    }
    const { access_token: token, expires_in: expiresIn } = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    cached = { expiresAt: now + expiresIn, token };
    return token;
  };
};
