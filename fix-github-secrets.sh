#!/usr/bin/env bash
# ============================================================
# fix-github-secrets.sh
# Run this ONCE inside your local cloned git repo directory.
# It will:
#   1. Remove any committed .env file from git tracking
#   2. Scrub real values from .env.example if present
#   3. Remove secrets from ALL git history using git-filter-repo
#   4. Force-push the clean history to GitHub
# ============================================================
set -euo pipefail

echo ""
echo "=== MOEgov: GitHub secrets cleanup ==="
echo ""

# ---- Sanity check: must be inside a git repo ----
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "ERROR: This script must be run inside your cloned git repository."
  echo "       cd into your repo folder first, then run this script."
  exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

echo "Repo root: $REPO_ROOT"
echo ""

# ---- Step 1: Remove .env from git tracking if it's tracked ----
if git ls-files --error-unmatch .env &>/dev/null 2>&1; then
  echo "[1/5] Removing .env from git tracking..."
  git rm --cached .env
  echo "      Done. (.env kept locally, removed from git)"
else
  echo "[1/5] .env is not tracked in git — nothing to untrack."
fi

# ---- Step 2: Ensure .gitignore covers .env files ----
if ! grep -q "^\.env$" .gitignore 2>/dev/null; then
  echo "[2/5] Adding .env to .gitignore..."
  cat >> .gitignore << 'GITIGNORE'

# Environment / secrets — never commit real values
.env
.env.local
.env.*.local
GITIGNORE
else
  echo "[2/5] .gitignore already covers .env — no change needed."
fi

# ---- Step 3: Replace real values in .env.example with placeholders ----
echo "[3/5] Sanitising .env.example..."
sed -i.bak \
  -e 's|FOUNDRY_PROJECT_ENDPOINT=https://[^[:space:]]*|FOUNDRY_PROJECT_ENDPOINT=https://YOUR-RESOURCE.services.ai.azure.com/api/projects/YOUR-PROJECT|g' \
  -e 's|FOUNDRY_AGENT_NAME=[^[:space:]]*|FOUNDRY_AGENT_NAME=YOUR-AGENT-NAME|g' \
  .env.example
rm -f .env.example.bak
echo "      Done."

# ---- Step 4: Commit any changes ----
git add .gitignore .env.example
if ! git diff --cached --quiet; then
  echo "[4/5] Committing cleaned files..."
  git commit -m "Remove secrets from tracked files and sanitise .env.example"
else
  echo "[4/5] No file changes to commit."
fi

# ---- Step 5: Scrub secrets from ALL git history ----
echo ""
echo "[5/5] Purging real values from entire git history..."
echo "      This rewrites history — a force-push will follow."
echo ""

# Check if git-filter-repo is available
if command -v git-filter-repo &>/dev/null; then
  FILTER_TOOL="git-filter-repo"
elif python3 -m pip show git-filter-repo &>/dev/null 2>&1; then
  FILTER_TOOL="python3 -m git_filter_repo"
else
  echo "      git-filter-repo not found. Installing via pip..."
  pip3 install git-filter-repo --quiet
  FILTER_TOOL="git-filter-repo"
fi

# Create a replacements file for known secret patterns
REPLACEMENTS_FILE=$(mktemp)
cat > "$REPLACEMENTS_FILE" << 'REPLACEMENTS'
regex:FOUNDRY_PROJECT_ENDPOINT=https://[^\s"']+==>"FOUNDRY_PROJECT_ENDPOINT=https://YOUR-RESOURCE.services.ai.azure.com/api/projects/YOUR-PROJECT"
regex:FOUNDRY_AGENT_NAME=[^\s"']+==>"FOUNDRY_AGENT_NAME=YOUR-AGENT-NAME"
REPLACEMENTS

$FILTER_TOOL \
  --replace-text "$REPLACEMENTS_FILE" \
  --path .env --invert-paths \
  --force 2>&1 | tail -5

rm -f "$REPLACEMENTS_FILE"
echo "      History rewritten."

# ---- Force push all branches ----
echo ""
echo "Pushing cleaned history to GitHub (force push)..."
git push origin --force --all
git push origin --force --tags

echo ""
echo "============================================"
echo " Done! Your GitHub repo is now clean."
echo ""
echo " IMPORTANT — Do these two things now:"
echo " 1. Rotate your Azure Foundry API keys / regenerate them"
echo "    because they were previously public."
echo " 2. Set the new values ONLY in:"
echo "    Azure Portal > App Service > Configuration > Application settings"
echo "    (FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_AGENT_NAME)"
echo " 3. Tell any collaborators to re-clone the repo,"
echo "    as the git history has been rewritten."
echo "============================================"
echo ""
