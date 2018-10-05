// const config = require('../config');
// const User = require('../model/user/user-schema');
// const authUtils = require('./authUtils');
//
// const frontURL = config.frontURL;
//
// exports.signup = function signup(req, res) {
//   const randomNumba = authUtils.generateCode(99999, 10000);
//   const user = new User({
//     name: req.body.name,
//     verifiedEmail: false,
//     email: req.body.email,
//     password: req.body.password,
//     isPswdReset: false,
//     resetCode: randomNumba,
//   });
//   User.findOne({ email: req.body.email }, (err, existingUser) => {
//     if (existingUser && existingUser.verifiedEmail) {
//       return res.status(409).send({ message: 'This email address has already been registered.' });
//     }
//     const validData = user.validateSignup();
//     if (validData !== '') {
//       return res.status(409).send({ message: validData });
//     }
//     let userSave = user;
//     if (existingUser && !existingUser.verifiedEmail) {
//       existingUser.resetCode = randomNumba;
//       userSave = existingUser;
//     }
//     return userSave.save()
//       .then((doc) => {
//         const mailbody = `<h1>Welcome ${user.name
//         } to Web Jam Apps.</h1><p>Click this <a style="color:blue; text-decoration:underline; cursor:pointer; cursor:hand" `
//       + `href="${frontURL}/userutil/?email=${user.email}">link</a>, then enter the following code to verify your email: <br><br><strong>${
//         randomNumba}</strong></p>`;
//         authUtils.sendGridEmail(mailbody, user.email, 'Verify Your Email Address');
//         res.status(201).json({ email: user.email, user: doc });
//       })
//       .catch((err) => { res.status(500).json({ message: 'New user failed to save to mongodb', error: err }); });
//   });
// };
