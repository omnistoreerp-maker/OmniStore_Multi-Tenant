#!/bin/bash
# Watches .io registry delegation for spdy.io until it flips to alexa/andy NS.
LOG=/e/Projects/OmniStore_Multi-Tenant/.freebuff/ns-watch.log
: > "$LOG"
for i in $(seq 1 40); do
  TS=$(date +%H:%M:%S)
  NS=$(curl -s -m 10 "https://rdap.identitydigital.services/rdap/domain/spdy.io" | python -c "import json,sys; d=json.load(sys.stdin); print(','.join(n.get('ldhName','') for n in d.get('nameservers',[])))" 2>/dev/null)
  DOH=$(curl -s -m 10 "https://cloudflare-dns.com/dns-query?name=spdy.io&type=NS" -H "accept: application/dns-json" | python -c "import json,sys; d=json.load(sys.stdin); print(';'.join(a['data'] for a in d.get('Answer',[]) if a.get('type')==2))" 2>/dev/null)
  echo "$TS poll=$i registry=[$NS] doh=[$DOH]" >> "$LOG"
  case "$NS" in
    *alexa*|*andy*) echo "$TS DELEGATION_UPDATED" >> "$LOG"; exit 0;;
  esac
  sleep 120
done
echo "$(date +%H:%M:%S) WATCH_TIMEOUT" >> "$LOG"
