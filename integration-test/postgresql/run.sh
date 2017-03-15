#!/bin/sh -e

trap teardown EXIT

setup() {
	  psql -h "${POSTGRES_HOST:-/var/run/postgresql}" -U "${POSTGRES_USER}" -f setup.sql
}

teardown() {
	  psql -h "${POSTGRES_HOST:-/var/run/postgresql}" -U "${POSTGRES_USER}" -f teardown.sql
}

npm install

setup
$(npm bin)/jest ./no-auth.test.ts
teardown

setup
$(npm bin)/jest ./auth.test.ts
