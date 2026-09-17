# paramiko-based read-only gate runner; password via GATE_SSH_PASS env var
import sys, os
import paramiko

HOST = "192.168.1.64"
USER = "omnistore"

def main():
    if len(sys.argv) < 2:
        print("usage: ssh_gate.py <remote-command>"); return 2
    pw = os.environ.get("GATE_SSH_PASS")
    if not pw:
        print("GATE_SSH_PASS not set"); return 2
    cmd = sys.argv[1]
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(HOST, username=USER, password=pw, timeout=15, banner_timeout=15, auth_timeout=15)
    stdin, stdout, stderr = cli.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    rc = stdout.channel.recv_exit_status()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if out: print(out, end="")
    if err: print("[stderr]", err[:800], end="")
    cli.close()
    return rc

if __name__ == "__main__":
    sys.exit(main())
