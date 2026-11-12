#!/usr/bin/env bash
# One-time guarded sync of PR #12 Python files. Never touches .env or live Telegram.
cd /home/gace/legacy-group-guard-deploy/operations/legacy-group-guard || { echo DEPLOY_PATH_MISSING; exit 2; }
printf '========== GACE_RESULT_BEGIN ==========\nPROJECT=LegacyGuard\nACTION=SAFE_SOURCE_SYNC\n'
status=FAIL
error=UNKNOWN
work=$(mktemp -d)
if [ -z "$work" ] || [ ! -d "$work" ]; then
  error=TEMP_DIR_FAILED
elif [ "$(git hash-object guard.py 2>/dev/null)" != 5c27a0319fb6c698c9659eaa6db831c9149a3194 ]; then
  error=LOCAL_SOURCE_CHANGED
else
  base=https://raw.githubusercontent.com/seigo-gace/GateApp-Bot/6f830349960e3d68aa804d43d52f2e4d14315574/operations/legacy-group-guard
  if ! curl -fsSL --max-time 25 "$base/guard.py" -o "$work/guard.py" 2>/dev/null || ! curl -fsSL --max-time 25 "$base/test_guard.py" -o "$work/test_guard.py" 2>/dev/null; then
    error=DOWNLOAD_FAILED
  elif [ "$(git hash-object "$work/guard.py")" != f96374a68fc20d6c941d0f627ce3e795b6ce3fcf ] || [ "$(git hash-object "$work/test_guard.py")" != cd235fa397c98cc1f7779ed6aba2ff6347da597f ]; then
    error=HASH_MISMATCH
  elif ! python3 -m unittest discover -s "$work" -p 'test_*.py' >/dev/null 2>&1; then
    error=UNIT_TEST_FAILED
  else
    backup=$(mktemp -d .guard-backup.XXXXXXXX)
    if [ -z "$backup" ] || [ ! -d "$backup" ]; then
      error=BACKUP_DIR_FAILED
    elif ! cp -p guard.py "$backup/guard.py" || ! cp -p test_guard.py "$backup/test_guard.py"; then
      error=BACKUP_FAILED
    elif ! cp "$work/guard.py" .guard.py.gace-new || ! cp "$work/test_guard.py" .test_guard.py.gace-new; then
      error=STAGE_FAILED
    elif ! mv .guard.py.gace-new guard.py || ! mv .test_guard.py.gace-new test_guard.py; then
      cp "$backup/guard.py" guard.py
      cp "$backup/test_guard.py" test_guard.py
      error=INSTALL_FAILED_ROLLED_BACK
    else
      status=PASS
      error=NONE
      printf 'SOURCE_HEAD=6f830349\n'
    fi
  fi
fi
if [ -n "$work" ] && [ -d "$work" ]; then rm -rf -- "$work"; fi
if [ "$status" = PASS ]; then code=0; else code=1; fi
printf 'VERIFY=%s\nERROR=%s\nEXIT_CODE=%s\nPROJECT_END=LegacyGuard\n========== GACE_RESULT_END ==========\n' "$status" "$error" "$code"
exit "$code"
