#!/usr/bin/env python3
"""Bounded nonsecret diagnostics for Guard's /state volume. Never starts guard.py."""
from pathlib import Path
import subprocess
import os
import stat
ROOT = Path("/home/gace/legacy-group-guard-deploy/operations/legacy-group-guard")
print("========== GACE_RESULT_BEGIN ==========", flush=True)
print("PROJECT=LegacyGuard")
print("ACTION=STATE_OWNERSHIP_DIAG_READ_ONLY")
status="FAIL"
error="UNKNOWN"
try:
    if not ROOT.is_dir():
        error="DEPLOY_ROOT_MISSING"
    else:
        state=ROOT/"state"
        if state.is_symlink() or not state.is_dir():
            error="STATE_DIR_MISSING_OR_UNSAFE"
        else:
            s=state.stat()
            print("HOST_STATE_UID="+str(s.st_uid))
            print("HOST_STATE_GID="+str(s.st_gid))
            print("HOST_STATE_MODE="+oct(stat.S_IMODE(s.st_mode)))
            cmd=["docker","compose","run","--rm","--no-deps","--user","guard","--entrypoint","id","legacy-group-guard"]
            res=subprocess.run(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,text=True)
            print("CONTAINER_ID_EXIT="+str(res.returncode))
            if res.returncode==0:
                print("CONTAINER_ID="+res.stdout.strip()[:150])
                probe=subprocess.run(["docker","compose","run","--rm","--no-deps","--user","guard","--entrypoint","stat","legacy-group-guard","-c","%u:%g:%a","/state"],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,text=True)
                print("CONTAINER_STATE_STAT_EXIT="+str(probe.returncode))
                if probe.returncode==0:
                    print("CONTAINER_STATE_STAT="+probe.stdout.strip()[:100])
                    status="PASS"
                    error="NONE"
                else:
                    error="CONTAINER_STATE_STAT_FAILED"
            else:
                stderr=res.stderr.lower()
                if "permission denied" in stderr:
                    error="DOCKER_PERMISSION_DENIED"
                elif "cannot connect" in stderr or "daemon" in stderr:
                    error="DOCKER_DAEMON_UNREACHABLE"
                elif "network" in stderr:
                    error="DOCKER_NETWORK_FAILURE"
                else:
                    error="DOCKER_RUN_FAILED"
except subprocess.TimeoutExpired:
    error="DOCKER_RUN_TIMEOUT"
except (OSError,ValueError):
    error="LOCAL_DIAG_EXCEPTION"
finally:
    print("VERIFY="+status)
    print("ERROR="+error)
    print("EXIT_CODE="+("0" if status=="PASS" else "1"))
    print("PROJECT_END=LegacyGuard")
    print("========== GACE_RESULT_END ==========", flush=True)
