#!/usr/bin/env bash
# FE/BE coupling gate — see .github/workflows/fe-be-coupling-gate.yml and
# web-jam-back#1002. Conventions (`FE-couples:` / `Coupling-override:`) are
# canonical in web-jam-tools/docs/cross-ai-rules.md — don't redefine here.
set -euo pipefail

DEFAULT_OWNER="WebJamApps"

# PR_BODY is passed via env (not interpolated into the script) to avoid
# shell injection from PR body content.
body="${PR_BODY:-}"

fe_line="$(printf '%s\n' "$body" | grep -m1 -E '^FE-couples:[[:space:]]*\S+' || true)"

if [ -z "$fe_line" ]; then
  echo "no coupling declared — pass"
  exit 0
fi

override_line="$(printf '%s\n' "$body" | grep -m1 -E '^Coupling-override:[[:space:]]*\S' || true)"

if [ -n "$override_line" ]; then
  reason="$(printf '%s\n' "$override_line" | sed -E 's/^Coupling-override:[[:space:]]*//')"
  echo "Coupling-override given: ${reason}"
  echo "override accepted — pass"
  exit 0
fi

fe_ref="$(printf '%s\n' "$fe_line" | sed -E 's/^FE-couples:[[:space:]]*//' | awk '{print $1}')"

# fe_ref is one of: Repo#NNN | owner/repo#NNN
if [[ "$fe_ref" =~ ^([^/#[:space:]]+)/([^/#[:space:]]+)#([0-9]+)$ ]]; then
  owner="${BASH_REMATCH[1]}"
  repo="${BASH_REMATCH[2]}"
  number="${BASH_REMATCH[3]}"
elif [[ "$fe_ref" =~ ^([^/#[:space:]]+)#([0-9]+)$ ]]; then
  owner="$DEFAULT_OWNER"
  repo="${BASH_REMATCH[1]}"
  number="${BASH_REMATCH[2]}"
else
  echo "FE-couples line found but could not parse a <repo>#NNN reference: ${fe_line}" >&2
  echo "add a valid FE-couples: <repo>#NNN line, or a Coupling-override: <reason> line" >&2
  exit 1
fi

echo "coupled FE reference: ${owner}/${repo}#${number}"

pr_url="$(gh api "repos/${owner}/${repo}/issues/${number}" --jq '.pull_request.url // empty' 2>/dev/null || true)"

pass=0

if [ -n "$pr_url" ]; then
  # It's a PR — pass iff merged to that repo's main.
  pr_info="$(gh api "repos/${owner}/${repo}/pulls/${number}" --jq '[.merged, .base.ref] | @tsv' 2>/dev/null || true)"
  merged="$(printf '%s' "$pr_info" | cut -f1)"
  base_ref="$(printf '%s' "$pr_info" | cut -f2)"
  if [ "$merged" = "true" ] && [ "$base_ref" = "main" ]; then
    pass=1
  fi
else
  # It's an issue — check its closing PRs via GraphQL.
  result="$(gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){closedByPullRequestsReferences(first:20,includeClosedPrs:true){nodes{merged baseRefName}}}}}' -F o="$owner" -F r="$repo" -F n="$number" --jq '[.data.repository.issue.closedByPullRequestsReferences.nodes[] | select(.merged==true and .baseRefName=="main")] | length' 2>/dev/null || true)"
  if [ -n "$result" ] && [ "$result" -gt 0 ]; then
    pass=1
  fi
fi

if [ "$pass" -eq 1 ]; then
  echo "coupled FE change (${owner}/${repo}#${number}) is merged to ${repo}'s main — pass"
  exit 0
fi

echo "FE-couples reference ${owner}/${repo}#${number} is not yet merged to ${repo}'s main." >&2
echo "This BE change is coupled to a front-end change that hasn't shipped." >&2
echo "Either wait for ${owner}/${repo}#${number} to merge to main, or add a" >&2
echo "Coupling-override: <reason> line if this is backward-compatible / behind a flag." >&2
exit 1
