#!/usr/bin/env bash

set -e

BRANCH=master

if [[ $NODE_ENV != "production" ]];
then
    BRANCH=dev
fi

if [ ! -d WebJamShop ]; then
    (git clone https://github.com/WebJamApps/WebJamShop)
fi

(
cd WebJamShop || exit;
git stash;
git checkout $BRANCH;
git pull;
cd ..;
)

if [ -f .env ];
then
  (cp .env WebJamShop/;
  )
fi

(
cd WebJamShop;
yarn install;
)
