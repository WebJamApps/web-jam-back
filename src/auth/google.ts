import Debug from 'debug';

const debug = Debug('web-jam-back:auth/google');

const accessTokenUrl = 'https://accounts.google.com/o/oauth2/token';
const peopleApiUrl = 'https://people.googleapis.com/v1/people/me?personFields=names%2CemailAddresses';

export interface GoogleAuthenticateResponse {
  emailAddresses: { value: string }[];
  names: { displayName: string }[];
}

async function authenticate(req: { body: { redirectUri: string; code: string; clientId: string; }; }): Promise<GoogleAuthenticateResponse> {
  let reUri = req.body.redirectUri;
  let tokenBody;
  let profileBody;
  if (reUri && reUri.includes('localhost')) {
    reUri = reUri.replace('https', 'http');
  }
  const params = new URLSearchParams({
    code: req.body.code,
    client_id: req.body.clientId,
    client_secret: process.env.GoogleClientSecret || '',
    redirect_uri: reUri,
    grant_type: 'authorization_code',
  });
  try { // Step 1. Exchange authorization code for access token.
    const tokenRes = await fetch(accessTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: params,
    });
    if (!tokenRes.ok) throw new Error(`${tokenRes.status} ${tokenRes.statusText}`);
    tokenBody = await tokenRes.json();
    debug(tokenBody);
  } catch (e) { debug(e); return Promise.reject(e); }
  try { // Step 2. Retrieve profile information about the current user.
    const profileRes = await fetch(peopleApiUrl, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, Accept: 'application/json' },
    });
    if (!profileRes.ok) throw new Error(`${profileRes.status} ${profileRes.statusText}`);
    profileBody = await profileRes.json();
  } catch (e) {
    const eMessage = (e as Error).message;
    debug(eMessage);
    throw new Error(`Failed to receive google profile information, ${eMessage}`);
  }
  if (!profileBody || !profileBody.emailAddresses) {
    throw new Error('Failed to retrieve a proper user profile from Google');
  }
  return profileBody;
}

export default { authenticate };
