const rp = require('request-promise');
const debug = require('debug')('web-jam-back:auth/google');

const accessTokenUrl = 'https://accounts.google.com/o/oauth2/token';
const peopleApiUrl = 'https://people.googleapis.com/v1/people/me?personFields=names%2CemailAddresses';

exports.authenticate = async function authenticate(req) {
  let token, profile;
  const params = {
    code: req.body.code,
    client_id: req.body.clientId,
    client_secret: process.env.GoogleClientSecret,
    redirect_uri: req.body.redirectUri,
    grant_type: 'authorization_code',
  };
    // Step 1. Exchange authorization code for access token.
  try {
    token = await rp.post(accessTokenUrl, { json: true, form: params });
    // debug(token);
  } catch (e) { return Promise.reject(e); }
  const accessToken = token.access_token;
  const headers = { Authorization: `Bearer ${accessToken}` };
  // Step 2. Retrieve profile information about the current user.
  const requestConfig = { url: peopleApiUrl, headers, json: true };
  try {
    profile = await rp.get(requestConfig);
  } catch (e) {
    debug(e.message);
    return Promise.reject(e);
  }
  // debug(profile);
  if (profile === null || profile === undefined || profile.emailAddresses === null || profile.emailAddresses === undefined) {
    return Promise.reject(new Error('failed to retrieve user profile from Google'));
  }
  return Promise.resolve(profile);
};
