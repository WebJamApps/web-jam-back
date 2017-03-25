# web-jam-back
[![CircleCI](https://circleci.com/gh/WebJamApps/web-jam-back.svg?style=svg)](https://circleci.com/gh/WebJamApps/web-jam-back)


<h3>Install</h3>
- npm install -g yarn
- yarn install
- Request a copy of the .env file, which includes credentials to development mLab and to connect to the Google Auth Service. You will need to put a copy of the .env file into the root of the backend folder and also inside of backendroot/frontend so that you can test the production build from the local backend.

<b><i>Note</i></b> There may be times when you need to <b>npm run cleaninstall</b><br>This eliminates any conflicts with existing node modules and new ones being used. If you do this then you will need to put the .env file again into the backendroot/frontend folder because that folder will get deleted and recreated from the github frontend master repo.

<h3>Run the server</h3>
<b>npm start</b> starts the express server at localhost:7000<br>
<br>
<b>npm run debug</b> also starts the node debugger, which allows you to use Chrome browser to debug. You should also install the NIM add-on to Chrome and set it to automatic mode.

<h3>Authorization</h3>
The .env contains a variable that points to the localhost of the front end and other required credentials.<br>

<h3>Test</h3>
<b>npm test</b> runs the tests and generates a coverage report.<br>This report folder should remain outside of the test folder so that Mocca does not confuse the files inside coverage with files that it should be testing.<br><br>
<b>npm run test:debug</b> runs the tests and allows debugging within a Chrome browser.<br>If you install the NIM chrome extension, and set it to automatic mode, then Chrome will open automatically after you run this command.

<h3>Git</h3>
To get the latest version of code, <b>git pull origin dev</b> and then switch to your own branch.

Please do not push your changes directly to the dev branch, rather we would appreciate if you pushed to your own branch and then submit a pull request to the <b>dev</b> branch.
