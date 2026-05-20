#!/bin/bash

GATEWAY="10.2.0.1"
TM_HOST="localhost:9091"
TM_USER="${TM_USER}"
TM_PASS="${TM_PASS}"

while true; do
    PORT=$(natpmpc -a 1 0 udp 60 -g $GATEWAY | grep "Mapped public port" | awk '{print $4}')
    natpmpc -a 1 0 tcp 60 -g $GATEWAY

    if [ -n "$PORT" ]; then
        TOKEN=$(curl -s -u "$TM_USER:$TM_PASS" \
            -c /tmp/cookies \
            http://$TM_HOST/transmission/rpc 2>&1 | \
            grep -o 'X-Transmission-Session-Id: [^<]*' | awk '{print $2}')

        curl -s -u "$TM_USER:$TM_PASS" \
            -H "X-Transmission-Session-Id: $TOKEN" \
            -d "{\"method\":\"session-set\",\"arguments\":{\"peer-port\":$PORT}}" \
            http://$TM_HOST/transmission/rpc

        echo "Port mis à jour : $PORT"
    fi

    sleep 45
done
