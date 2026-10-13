#!/bin/sh
# Prisma migrations are append-only once merged: blocks editing/deleting a migration that
# exists on origin/develop or origin/main, and adding files to such a migration directory.
# Migrations existing only on the current branch can still be changed.
bases=$(for ref in origin/develop origin/main; do
  git rev-parse -q --verify "$ref" >/dev/null && echo "$ref"
done)
[ -z "$bases" ] && exit 0

git diff --cached --name-status --no-renames -- prisma/migrations | while read -r status file; do
  [ "$file" = "prisma/migrations/migration_lock.toml" ] && continue
  for base in $bases; do
    if [ "$status" = "A" ]; then
      if git cat-file -e "$base:$(dirname "$file")" 2>/dev/null; then
        echo "✖ Adding a file to merged migration ($base): $file — create a new migration instead"
        exit 1
      fi
    elif git cat-file -e "$base:$file" 2>/dev/null; then
      echo "✖ Editing/deleting merged migration ($base): $file — create a new migration instead"
      exit 1
    fi
  done
done
