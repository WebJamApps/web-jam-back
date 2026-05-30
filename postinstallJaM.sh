#!/usr/bin/env bash

set -e

BRANCH=main

if [[ $BUILD_BRANCH != "main" ]];
then
    BRANCH=dev
fi

if [ ! -d JaMmusic ]; then
    (git clone https://github.com/WebJamApps/JaMmusic)
fi

(
cd JaMmusic || exit;
git stash;
git checkout $BRANCH;
git pull;
cd ..;
)

if [ -f .env ];
then
  (cp .env JaMmusic/;
  )
fi

(
cd JaMmusic;
npm install;
)
