#!/bin/bash -x
source /usr/share/nvm/nvm.sh
export NVM_DIR=~/.nvm
nvm use 20
npm run develop
