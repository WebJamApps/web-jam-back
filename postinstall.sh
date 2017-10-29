#!/usr/bin/env bash

set -e

BRANCH=master

if [[ $NODE_ENV != "production" ]];
then
    BRANCH=dev
fi

if [ ! -d frontend ]; then
    (git clone https://github.com/WebJamApps/combined-front frontend)
fi

(
    cd frontend || exit;
    git stash;
    git checkout $BRANCH;
    git pull;
    npm run installglobals;
    yarn install;
    npm run postinstall:backend
)
