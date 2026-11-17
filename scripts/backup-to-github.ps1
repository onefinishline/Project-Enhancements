# On-demand backup of ALL current work (committed or not) to the GitHub branch backup/daily.
# Run it when the user asks ("back up").
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-to-github.ps1 
#
# Snapshots the working folder into a commit on backup/daily without touching your files,
# your staged changes, or the branch you are on. Every local branch is linked in, so commits on
# branches that aren't checked out are backed up too. Files in .gitignore are never included,
# and the app database and local settings files with passwords (data/, *.db*, .env, .env.*) are always left out,
# even on branches whose .gitignore predates those rules.
# Skips the push when nothing changed. Log: logs\backup.log.
# -NoPush builds the snapshot on a local test branch (backup/daily-test) and pushes nothing.

param([switch]$NoPush, [string]$Repo = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$repo = $Repo
$branch = if ($NoPush) { 'backup/daily-test' } else { 'backup/daily' }
$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'backup.log'
function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Out-File -Append -Encoding utf8 $log }

# Runs git.exe, throws on a non-zero exit, returns stdout as an array of lines.
function Invoke-Git {
  $ErrorActionPreference = 'Continue'   # git writes warnings (e.g. CRLF) to stderr; only the exit code matters
  $out = & git.exe -C $repo @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed: $out" }
  return @($out | Where-Object { $_ -is [string] } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$tmpIndex = Join-Path $repo (Invoke-Git rev-parse --git-path backup-index | Select-Object -First 1)
try {
  # Build the snapshot in a private index so the real index is untouched.
  $env:GIT_INDEX_FILE = $tmpIndex
  Invoke-Git read-tree HEAD | Out-Null
  Invoke-Git add -A | Out-Null
  Invoke-Git rm -r -q --cached --ignore-unmatch -- data '*.db' '*.db-wal' '*.db-shm' .env '.env.*' ':!.env.example' | Out-Null
  $tree = Invoke-Git write-tree
  Remove-Item Env:\GIT_INDEX_FILE
  Remove-Item -Force $tmpIndex -ErrorAction SilentlyContinue

  # GitHub rejects files over 100 MB; refuse rather than fail mid-push.
  $big = Invoke-Git ls-tree -r -l $tree | Where-Object {
    $size = ($_ -split '\s+')[3]; $size -match '^\d+$' -and [long]$size -gt 95MB }
  if ($big) { throw "Files over 95 MB would be backed up; add them to .gitignore: $($big -join '; ')" }

  # Parents: the previous backup, then each local branch tip it doesn't already contain.
  $parent = Invoke-Git for-each-ref --format='%(objectname)' "refs/heads/$branch" | Select-Object -First 1
  $tips = @(Invoke-Git for-each-ref --format='%(objectname) %(refname)' refs/heads/ |
    Where-Object { $_ -notmatch ' refs/heads/backup/' } | ForEach-Object { ($_ -split ' ')[0] } |
    Select-Object -Unique)
  if ($parent) {
    $tips = @($tips | Where-Object { & git.exe -C $repo merge-base --is-ancestor $_ $parent; $LASTEXITCODE -ne 0 })
    if (-not $tips.Count -and ((Invoke-Git rev-parse "$parent^{tree}") -eq $tree)) {
      Log 'No changes since last backup; nothing pushed.'
      exit 0
    }
  }

  $current = Invoke-Git rev-parse --abbrev-ref HEAD
  $short = Invoke-Git rev-parse --short HEAD
  $msg = "Backup $(Get-Date -Format 'yyyy-MM-dd HH:mm') of '$current' ($short) incl. uncommitted work"
  $parents = @()
  foreach ($p in @($parent) + $tips) { if ($p) { $parents += @('-p', $p) } }
  $commit = Invoke-Git commit-tree $tree @parents -m $msg
  Invoke-Git update-ref "refs/heads/$branch" $commit | Out-Null
  if ($NoPush) { Log "Test snapshot (not pushed) $branch $($commit.Substring(0,7)): $msg"; exit 0 }
  Invoke-Git push origin "refs/heads/${branch}:refs/heads/$branch" | Out-Null
  Log "Pushed $branch $($commit.Substring(0,7)): $msg"
}
catch {
  Log "BACKUP FAILED: $_"
  exit 1
}
finally {
  Remove-Item Env:\GIT_INDEX_FILE -ErrorAction SilentlyContinue
  Remove-Item -Force $tmpIndex -ErrorAction SilentlyContinue
}
