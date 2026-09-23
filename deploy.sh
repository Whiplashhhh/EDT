#!/bin/bash

###  A deployment script that updates the local Git repository from the remote,
###  preserving any local changes, and then rebuilds the Docker stack.

### Warning: Don't run this script if you have uncommitted changes that you don't want to risk losing.
### Don't use locally and refer to README.md for running a test deployment.


set -e
cd "$(dirname "$0")"

BRANCH="main"

echo "=== Deploy script started at $(date) ==="

# Check if this is a Git repository
if [ ! -d .git ]; then
  echo "This directory is not a Git repository."
  exit 1
fi

# Detect local changes
if ! git diff-index --quiet HEAD --; then
  echo "Local changes detected."
  echo "They will be preserved; no hard reset will be performed."
  echo "(Run 'git stash' or commit your work if you want to isolate it.)"
  LOCAL_CHANGES=true
else
  LOCAL_CHANGES=false
fi

echo "=== Fetching latest changes ==="
git fetch origin "$BRANCH"

if [ "$LOCAL_CHANGES" = false ]; then
  echo "=== Fast-forward merge with remote ==="
  git merge --ff-only "origin/$BRANCH" || {
    echo "Automatic merge not possible. Deployment aborted."
    exit 1
  }
else
  echo "=== Pulling with rebase (preserving local changes) ==="
  git pull --rebase origin "$BRANCH" || {
    echo "Rebase failed. Deployment aborted."
    exit 1
  }
fi

echo "=== Rebuilding stack ==="
docker compose down
docker compose pull
docker compose build --no-cache
docker compose up -d

echo "Deployment completed at $(date)"