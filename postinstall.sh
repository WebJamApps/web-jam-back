#!/usr/bin/env bash

set -e

BRANCH=master

if [[ $BUILD_BRANCH != "master" ]];
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
cd ..;
)

if [ -f .env ];
then
  (cp .env frontend/;
  )
fi

(
cd frontend;
yarn install;
)
