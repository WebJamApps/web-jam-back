#!/usr/bin/env bash

set -e

BRANCH=master

if [[ $NODE_ENV != "production" ]]; 
then
    BRANCH=dev
fi

if [ ! -d frontend ]; then
    (git clone https://github.com/WebJamApps/web-jam-front frontend)
fi

(
    cd frontend || exit;
    git checkout $BRANCH;
    git pull;
    npm install;
)
