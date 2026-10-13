#!/bin/sh
# Blocks commits directly on protected branches. Usage: check-branch.sh main develop
# Detached HEAD (rebase, bisect) is allowed.
branch=$(git symbolic-ref -q --short HEAD) || exit 0
for protected in "$@"; do
  if [ "$branch" = "$protected" ]; then
    echo "✖ Commits on '$branch' are not allowed — create a branch: git switch -c feature/<name>"
    exit 1
  fi
done
