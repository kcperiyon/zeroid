#!/bin/sh
# Forwards ONE raw inbound message from the mail server to Zeroid, so replies, bounces and spam
# complaints are matched to the campaign email they answer.
#
# Postfix example (reply mailbox for the sending domain):
#   /etc/aliases   ->   zeroid-inbound: "|/opt/zeroid/scripts/postfix-pipe.sh"
#   and route  reply@yourdomain  and  bounce@yourdomain  (including  reply+token@...)  to that alias,
#   e.g. with a virtual alias map or  recipient_delimiter = +  plus  local_recipient_maps.
#
# Needs two environment variables for the user that runs it (set them in the alias wrapper or a
# root-only /etc/default file):
#   ZEROID_INBOUND_URL     e.g. https://zeroid.moneyvarsity.net/api/inbound/email
#   INBOUND_EMAIL_SECRET   the same value as on the Zeroid server
#
# Exit status: 0 = handled (or not worth retrying); 75 = temporary failure, so the mail server
# keeps the message and retries later (Zeroid down or erroring).
set -eu
: "${ZEROID_INBOUND_URL:?ZEROID_INBOUND_URL is not set}"
: "${INBOUND_EMAIL_SECRET:?INBOUND_EMAIL_SECRET is not set}"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
cat > "$TMP"

# curl prints 000 as the status when it cannot connect, so do not append a second one.
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
  -X POST -H "x-inbound-secret: ${INBOUND_EMAIL_SECRET}" \
  --data-binary "@${TMP}" "${ZEROID_INBOUND_URL}" 2>/dev/null || true)"
[ -n "$CODE" ] || CODE=000

case "$CODE" in
  2??) exit 0 ;;
  000|5??) exit 75 ;; # Zeroid down or erroring: let the mail server retry later
  *) exit 0 ;;        # 4xx (bad secret, too large): retrying will not help
esac
