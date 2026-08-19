#!/usr/bin/env bash
# Redeploys payment-webhook with the atomic pending-booking claim
# (migration 20260827120000). The DB function is already applied on the cloud
# project; this ships the code that calls it.
#
# Until this runs, the duplicate-callback race is still live: a retried gateway
# callback can create a second appointment AND auto-refund a booking that
# actually succeeded.
#
# SUPABASE_ACCESS_TOKEN is required so the CLI never prompts the macOS keychain.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?export SUPABASE_ACCESS_TOKEN=... first}"
cd "$(dirname "$0")/.."
supabase functions deploy payment-webhook --project-ref dnmecnpugjxkjonqsfxx
