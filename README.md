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

## Test

**`npm test`** runs the tests and generates a coverage report.

if some tests fail it is probably due to the TEST database instance of MongoDb Atlas needs to be resumed.

## Git

To get the latest version of code, **`git pull origin dev`**, create your own branch, then switch to your own branch. Push code changes to your own branch and then submit a pull request to the **dev** branch on GitHub.
