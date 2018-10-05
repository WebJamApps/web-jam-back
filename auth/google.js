const request = require('request');
const UserSchema = require('../model/user/user-schema');
const authUtils = require('./authUtils');

const accessTokenUrl = 'https://accounts.google.com/o/oauth2/token';
const peopleApiUrl = 'https://www.googleapis.com/plus/v1/people/me/openIdConnect';

class Google {
  static authenticate(req, res) {
    let newUser, existingUser;
    const params = {
      code: req.body.code,
      client_id: req.body.clientId,
      client_secret: process.env.GoogleClientSecret,
      redirect_uri: req.body.redirectUri,
      grant_type: 'authorization_code'
    };
    // Step 1. Exchange authorization code for access token.
    request.post(accessTokenUrl, { json: true, form: params }, (err, response, token) => {
      const accessToken = token.access_token;
      const headers = { Authorization: `Bearer ${accessToken}` };
      // Step 2. Retrieve profile information about the current user.
      const requestConfig = { url: peopleApiUrl, headers, json: true };
      request.get(requestConfig, async (err, response, profile) => {
        // Step 3. Create a new user account or return an existing one.
        const update = {};
        update.password = '';
        update.name = profile.name; // force the name of the user to be the name from google account
        update.verifiedEmail = true;
        try {
          existingUser = await UserSchema.findOneAndUpdate({ email: profile.email }, update).exec();
        } catch (e) { return res.status(500).json({ message: e.message }); }
        if (existingUser) return res.status(200).json({ email: existingUser.email, token: authUtils.createJWT(existingUser) });
        const user = {};
        user.name = profile.name;
        user.email = profile.email;
        user.isOhafUser = req.body.isOhafUser;
        user.verifiedEmail = true;
        try {
          newUser = await UserSchema.create(user);
        } catch (e) { return res.status(500).json({ message: e.message }); }
        return res.status(201).json({ email: newUser.email, token: authUtils.createJWT(newUser) });
      });
    });
  }
}

module.exports = Google;
