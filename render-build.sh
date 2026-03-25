#!/usr/bin/env bash
# exit on error
set -o errexit

npm install
# Download de chrome binary die puppeteer nodig heeft
npx puppeteer browsers install chrome
