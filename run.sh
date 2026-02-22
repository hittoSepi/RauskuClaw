#!/usr/bin/env bash

ROOT_DIR="/opt/openclaw/"
echo $ROOT_DIR

echo "Starting backend..\n"
cd $ROOT_DIR
docker compose up -d --build

echo "Starting SalaHOLVI..\n"
cd $ROOT_DIR"infra/holvi"
docker compose up -d --build

echo "Starting UI...\n"
cd $ROOT_DIR"ui-v2/"
npm run dev





