# FRANKFURT MOVE — download every server function from the OLD project and
# deploy it to the NEW one with the right "needs login / no login" setting.
# Run from the ielts-app folder in PowerShell:
#     .\supabase\frankfurt\deploy-functions.ps1 -NewRef abcdefghijklmnop
# Updated 2026-11-17: 24 functions.
param([Parameter(Mandatory = $true)][string]$NewRef)

$old = "grdfwleehlgoooizyowz"
$fns = "ai-grading","change-password","cleanup-submission-storage","create-staff-account","create-student-account","daily-reminders","define-words","delete-group","delete-staff-account","delete-student","delete-teacher","exam-reminders","mock-content-import","notify-telegram","parent-sms","reset-student-password","rollback-failed-signup","run-scheduled-mock-sessions","send-mock-access-codes","send-push","teacher-needs-attention-digest","telegram-group-post","telegram-webhook","translate-ru"
# These ones check the caller themselves, so the platform must not demand a login (same as Sydney).
$noJwt = "change-password","cleanup-submission-storage","create-student-account","delete-group","delete-student","notify-telegram","parent-sms","reset-student-password","rollback-failed-signup","telegram-group-post","telegram-webhook"

$failed = @()
foreach ($f in $fns) {
  Write-Host "== $f"
  supabase functions download $f --project-ref $old
  if ($LASTEXITCODE -ne 0) { $failed += "$f (download)"; continue }
  if ($noJwt -contains $f) { supabase functions deploy $f --project-ref $NewRef --no-verify-jwt }
  else { supabase functions deploy $f --project-ref $NewRef }
  if ($LASTEXITCODE -ne 0) { $failed += "$f (deploy)" }
}
if ($failed.Count) { Write-Host "`nFAILED:" ($failed -join ", ") -ForegroundColor Red; exit 1 }
Write-Host "`nAll $($fns.Count) functions deployed. Check: supabase functions list --project-ref $NewRef" -ForegroundColor Green
