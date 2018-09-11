const config = require('../config');
const User = require('../model/user/user-schema');
const authUtils = require('./authUtils');

let frontURL = config.frontURL;
/* istanbul ignore if */
if (process.env.NODE_ENV === 'production') frontURL = 'https://web-jam.com';

exports.signup = function signup(req, res) {
  const randomNumba = authUtils.generateCode(99999, 10000);
  const user = new User({
    name: req.body.name,
    verifiedEmail: false,
    email: req.body.email,
    password: req.body.password,
    isPswdReset: false,
    resetCode: randomNumba,
  });
  User.findOne({ email: req.body.email }, (err, existingUser) => {
    if (existingUser && existingUser.verifiedEmail) {
      return res.status(409).send({ message: 'This email address has already been registered.' });
    }
    const validData = user.validateSignup();
    if (validData !== '') {
      return res.status(409).send({ message: validData });
    }
    let userSave = user;
    if (existingUser && !existingUser.verifiedEmail) {
      existingUser.resetCode = randomNumba;
      userSave = existingUser;
    }
    return userSave.save()
      .then((doc) => {
        const mailbody = '<h1>Welcome ' + user.name
      + ' to Web Jam Apps.</h1><p>Click this <a style="color:blue; text-decoration:underline; cursor:pointer; cursor:hand" '
      + 'href="' + frontURL + '/userutil/?email=' + user.email + '">link</a>, then enter the following code to verify your email: <br><br><strong>'
      + randomNumba + '</strong></p>';
        authUtils.sendGridEmail(mailbody, user.email, 'Verify Your Email Address');
        res.status(201).json({ email: user.email, user: doc });
      })
      .catch((err) => { res.status(500).json({ message: 'New user failed to save to mongodb', error: err }); });
  });
};

// exports.validemail = function validemail(req, res) {
//   // console.log('email:' + req.body.email + ' resetCode:' + req.body.resetCode);
//   return User.findOne({ email: req.body.email, resetCode: req.body.resetCode }, (err, user) => {
//     console.log(user);
//     if (!user) {
//       return res.status(401).json({ message: 'incorrect email or code' });
//     }
//     user.resetCode = '';
//     user.isPswdReset = false;
//     user.verifiedEmail = true;
//     return user.save((err) => {
//       res.status(201).json({ success: true });
//     });
//   });
// };

exports.login = function login(req, res) {
  // console.log('req body email' + req.body.email);
  let reqUserEmail = '';
  reqUserEmail = authUtils.setIfExists(req.body.email);
  User.findOne({ email: reqUserEmail }, '+password', (err, user) => {
    if (!user) {
      return res.status(401).json({ message: 'Wrong email address' });
    } if (user.password === '' || user.password === null || user.password === undefined) {
      return res.status(401).json({ message: 'Please reset your password' });
    } if (!user.verifiedEmail) {
      return res.status(401).json({ message: '<a href="/userutil">Verify</a> your email' });
    }
    return user.comparePassword(req.body.password, (err, isMatch) => {
      if (!isMatch) { return res.status(401).json({ message: 'Wrong password' }); }
      return authUtils.saveSendToken(user, req, res);
    });
  });
};

// exports.resetpass = function resetpass(req, res) {
//   console.log('email:' + req.body.email);
//   User.findOne({ email: req.body.email }, (err, user) => {
//     console.log(user);
//     if (!user) {
//       return res.status(401).json({ message: 'incorrect email address' });
//     }
//     if (!user.verifiedEmail) {
//       return res.status(401).json({ message: 'Verify your email address' });
//     }
//     const randomNumba = authUtils.generateCode(99999, 10000);
//     user.resetCode = randomNumba;
//     user.isPswdReset = true;
//     return user.save((err) => {
//       res.status(201).json({ email: user.email });
//       const mailBody = '<h2>A password reset was requested for ' + user.name
//       + '.</h2><p>Click this <a style="color:blue; text-decoration:underline; cursor:pointer; cursor:hand" href="'
//       + frontURL + '/userutil/?email=' + user.email + '&form=reset">'
//       + 'link</a>, then enter the following code to reset your password: <br><br><strong>'
//       + randomNumba + '</strong></p><p><i>If a reset was requested in error, you can ignore this email and login to web-jam.com as usual.</i></p>';
//       authUtils.sendGridEmail(mailBody, user.email, 'Password Reset');
//     });
//   });
// };

exports.passwdreset = function passwdreset(req, res) {
  // console.log('email:' + req.body.email + ' resetCode:' + req.body.resetCode);
  User.findOne({ email: req.body.email, resetCode: req.body.resetCode }, (err, user) => {
    // console.log(user);
    if (!user) {
      return res.status(401).json({ message: 'incorrect email or code' });
    }
    user.resetCode = '';
    user.isPswdReset = false;
    user.password = req.body.password;
    if (user.password.length < 8) {
      return res.status(401).send({ message: 'Password is not min 8 characters' });
    }
    return user.save((err) => {
      res.status(201).json({ success: true });
    });
  });
};

exports.changeemail = function changeemail(req, res) {
  // console.log('request to change the email address');
  authUtils.checkEmailSyntax(req, res);
  User.findOne({ email: req.body.changeemail }, (err, user) => {
    if (user) {
      return res.status(409).json({ message: 'Email address already exists' });
    }
    return User.findOne({ email: req.body.email }, (err, existinguser) => {
      if (!existinguser) {
        return res.status(409).json({ message: 'current user does not exist' });
      }
      existinguser.resetCode = authUtils.generateCode(99999, 10000);
      existinguser.changeemail = req.body.changeemail;
      return existinguser.save((err) => {
        // console.log(existinguser);
        res.status(201).json({ success: true });
        const mailBody = '<h2>An Email Address Change was Requested for ' + existinguser.name
        + '.</h2><p>Click this <a style="color:blue; text-decoration:underline; cursor:pointer; cursor:hand" href="'
        + frontURL + '/userutil/?changeemail=' + existinguser.changeemail + '">'
        + 'link</a>, then enter the following code to validate this new email: <br><br><strong>'
        + existinguser.resetCode + '</strong></p><p><i>If this email change was requested in error, you can ignore it and login as usual.</i></p>';
        authUtils.sendGridEmail(mailBody, existinguser.changeemail, 'Email Change Request');
      });
    });
  });
};

exports.updateemail = function updateemail(req, res) {
  // console.log('validate with pin then change the email address');
  authUtils.checkEmailSyntax(req, res);
  User.findOne({ email: req.body.email }, (err, user) => {
    if (!user) {
      return res.status(409).json({ message: 'User does not exist' });
    }
    if (user.resetCode !== req.body.resetCode) {
      return res.status(409).json({ message: 'Reset code is wrong' });
    }
    if (user.changeemail !== req.body.changeemail) {
      return res.status(409).json({ message: 'Reset email is not valid' });
    }
    user.resetCode = '';
    user.email = req.body.changeemail;
    user.changeemail = '';
    return user.save(() => {
      res.status(201).json({ success: true });
    }).catch((err) => {
      res.status(400).json({ message: 'Failed to save user to mongodb', error: err });
    });
  });
};
