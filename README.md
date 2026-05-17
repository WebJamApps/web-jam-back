# web-jam-back

[![CircleCI](https://circleci.com/gh/WebJamApps/web-jam-back.svg?style=svg)](https://circleci.com/gh/WebJamApps/web-jam-back)
[![Known Vulnerabilities](https://snyk.io/test/github/webjamapps/web-jam-back/badge.svg)](https://snyk.io/test/github/webjamapps/web-jam-back)

This repository is used for the following apps:

- [Web Jam LLC](https://www.web-jam.com)
- [collegelutheran.org](https://www.collegelutheran.org)
- [joshandmariamusic.com](http://joshandmariamusic.com)

## Install

- clone this repo
- `npm install` (JaMmusic build should fail)
- Request a copy of the .env file, which includes credentials to dev & test mongodbs and to connect to the Google auth service. You will need to put a copy of the .env file into the root of the backend folder and also inside of backendroot/frontend so that you can test the production build from the local backend.

After placing the new .env file into the web-jam-back/frontend folder, you need to rebuild so that these environment variables are used in the output to dist, so just run `npm install` again.

## Run the server

**`npm start`** starts the express server at localhost:7000.

**`npm run start:debug`** also starts the node debugger, which allows you to use Chrome browser to debug. You should also install the NIM add-on to Chrome and set it to automatic mode.

## Authorization

The .env contains a variable that points to the localhost of the front end and other required credentials.

## Email (`/inquiry` route)

The `/inquiry` route sends a booking-inquiry email via Gmail SMTP using `nodemailer`. As of 2026-05-17 this replaces the previous `@sendgrid/mail` integration (see [docs/inquiry-sendgrid-crash.md](docs/inquiry-sendgrid-crash.md) for the post-mortem on the SendGrid failure mode that motivated the swap).

Two env vars must be set on the deployed environment (and in your local `.env` for end-to-end testing):

- `GMAIL_USER` — the Gmail address used to authenticate and as the `From` address. Production value: `joshua.v.sherman@gmail.com`.
- `GMAIL_APP_PASSWORD` — a Gmail App Password (NOT the regular account password). To generate one:
  1. Sign in to the Google account at <https://myaccount.google.com>.
  2. Security → 2-Step Verification (must be ON; App Passwords are unavailable without it).
  3. App passwords → choose "Mail" and a device label like "web-jam-back".
  4. Copy the 16-character password Google shows. Store it as `GMAIL_APP_PASSWORD` in `.env` locally and as a Heroku config var in production.

The destination address (`To`) is hardcoded to `joshua.v.sherman@gmail.com` in `src/model/inquiry/InquiryController.ts`. Change there if you need a different recipient.

In `NODE_ENV=test` the route returns 200 without actually sending email, so unit tests don't require live credentials.

## Test

**`npm test`** runs the tests and generates a coverage report.

if some tests fail it is probably due to the TEST database instance of MongoDb Atlas needs to be resumed.

## Git

To get the latest version of code, **`git pull origin dev`**, create your own branch, then switch to your own branch. Push code changes to your own branch and then submit a pull request to the **dev** branch on GitHub.
