import superagent from 'superagent';
import Debug from 'debug';

const debug = Debug('web-jam-back:auth/google');

const accessTokenUrl = 'https://accounts.google.com/o/oauth2/token';
const peopleApiUrl = 'https://people.googleapis.com/v1/people/me?personFields=names%2CemailAddresses';

interface GoogleAuthenticateResponse {
  emailAddresses: { value: string }[];
  names: { displayName: string }[];
}

async function authenticate(req: { body: { redirectUri: string; code: string; clientId: string; }; }): Promise<GoogleAuthenticateResponse> {
  let reUri = req.body.redirectUri, token, profile;
  if (reUri && reUri.includes('localhost')) {
    reUri = reUri.replace('https', 'http');
  }
  const params = {
    code: req.body.code,
    client_id: req.body.clientId,
    client_secret: process.env.GoogleClientSecret,
    redirect_uri: reUri,
    grant_type: 'authorization_code',
  };
  try { // Step 1. Exchange authorization code for access token.
    token = await superagent.post(accessTokenUrl).type('form').send(params).set('Accept', 'application/json');
    debug(token.body);
  } catch (e) { debug(e); return Promise.reject(e); }
  try { // Step 2. Retrieve profile information about the current user.
    profile = await superagent.get(peopleApiUrl).set({ Authorization: `Bearer ${token.body.access_token}`, Accept: 'application/json' });
  } catch (e) {
    debug(e.message);
    return Promise.reject(e);
  }
  if (profile === null || profile === undefined || profile.body.emailAddresses === null || profile.body.emailAddresses === undefined) {
    return Promise.reject(new Error('failed to retrieve user profile from Google'));
  }
  return Promise.resolve(profile.body);
}

export default { authenticate };
