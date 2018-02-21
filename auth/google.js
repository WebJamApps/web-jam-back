const User = require('../model/user/user-schema');
const request = require('request');
const authUtils = require('./authUtils');

const accessTokenUrl = 'https://accounts.google.com/o/oauth2/token';
const peopleApiUrl = 'https://www.googleapis.com/plus/v1/people/me/openIdConnect';

class Google {
  static authenticate(req, res) {
    console.log(req.body);
    const params = {
      code: req.body.code,
      client_id: req.body.clientId,
      client_secret: process.env.GoogleClientSecret,
      redirect_uri: req.body.redirectUri,
      grant_type: 'authorization_code'
    };

    // Step 1. Exchange authorization code for access token.
    request.post(accessTokenUrl, { json: true, form: params }, (err, response, token) => {
      // console.log("After initial access");
      // console.log(token);
      const accessToken = token.access_token;
      // console.log(accessToken);
      const headers = { Authorization: 'Bearer ' + accessToken };

      // Step 2. Retrieve profile information about the current user.
      const requestConfig = { url: peopleApiUrl, headers, json: true };
      request.get(requestConfig, (err, response, profile) => {
          // Step 3b. Create a new user account or return an existing one.
          const filter = { email: profile.email };
          User.findOne(filter, (err, existingUser) => {
            // console.log(existingUser);
            if (existingUser) {
              console.log('user exists');
              existingUser.password = '';
              // force the name of the user to be the name from google account
              existingUser.name = profile.name;
              existingUser.save();
              return res.send({ token: authUtils.createJWT(existingUser) });
            }
            const user = new User();
            user.name = profile.name;
            user.email = profile.email;
            user.isOhafUser = req.body.isOhafUser;
            user.save((err) => {
              console.log('token sent');
              res.send({ token: authUtils.createJWT(user) });
            });
          });
      });
    });
  }
}

module.exports = Google;
