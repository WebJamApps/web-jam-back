# web-jam-back

[![CircleCI](https://circleci.com/gh/WebJamApps/web-jam-back.svg?style=svg)](https://circleci.com/gh/WebJamApps/web-jam-back)
[![Code Climate](https://codeclimate.com/github/WebJamApps/web-jam-back/badges/gpa.svg)](https://codeclimate.com/github/WebJamApps/web-jam-back)
[![Test Coverage](https://codeclimate.com/github/WebJamApps/web-jam-back/badges/coverage.svg)](https://codeclimate.com/github/WebJamApps/web-jam-back/coverage)
[![Issue Count](https://codeclimate.com/github/WebJamApps/web-jam-back/badges/issue_count.svg)](https://codeclimate.com/github/WebJamApps/web-jam-back/issues)
[![Known Vulnerabilities](https://snyk.io/test/github/webjamapps/web-jam-back/badge.svg)](https://snyk.io/test/github/webjamapps/web-jam-back)

<p>This repository is used for the following apps:</p>
<ui>
<li><a href="https://www.web-jam.com">Web Jam LLC</a></li>
<li><a href="http://www.ourhandsandfeet.org">ourhandsandfeet.org</a></li>
  <li><a href="http://joshandmariamusic.com">joshandmariamusic.com</a></li>
<li><a href="https://www.web-jam.com/library">Web Jam Library</a></li>
</ul>

<h3>Install</h3>
<ui>
<li>clone this repo</li>
<li>`yarn install` (frontend build should fail)</li>
<li>Request a copy of the .env file, which includes credentials to development mLab and to connect to the Google Auth Service. You will need to put a copy of the .env file into the root of the backend folder and also inside of backendroot/frontend so that you can test the production build from the local backend.</li>
<p>After placing the new .env file into the web-jam-back/frontend folder, you need to rebuild so that these environment variables are used in the output to dist, so just run `yarn install` again

<h3>Run the server</h3>
<b>npm start</b> starts the express server at localhost:7000<br>
<br>
<b>npm run debug</b> also starts the node debugger, which allows you to use Chrome browser to debug. You should also install the NIM add-on to Chrome and set it to automatic mode.

<h3>Authorization</h3>
The .env contains a variable that points to the localhost of the front end and other required credentials.<br>

<h3>Test</h3>
<b>npm test</b> runs the tests and generates a coverage report.

<h3>Git</h3>
To get the latest version of code, <b>git pull origin dev</b>, create your own branch, then switch to your own branch.
Push code changes to your own branch and then submit a pull request to the <b>dev</b> branch on GitHub.
