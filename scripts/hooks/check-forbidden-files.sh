#!/bin/sh
# Rejects files that must never be committed, by name (secret scanners miss generic secrets).
# Receives staged file paths from lint-staged.
status=0
for file in "$@"; do
  name=$(basename "$file")
  case "$name" in
    .env.example) ;;
    .env | .env.* | cookies.txt | *.pem | *.key | *.p12 | id_rsa* | *.sqlite)
      echo "✖ Forbidden file staged: $file"
      status=1
      ;;
  esac
done
exit $status
