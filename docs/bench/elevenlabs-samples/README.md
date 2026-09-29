# ElevenLabs voice samples — 2026-09-29 (not generated)

The access check failed, so I generated no samples and did not write timings.json.

Check command:
    curl -sS -o /dev/null -w '%{http_code}' https://api.elevenlabs.io/v1/models -H 'xi-api-key: placeholder'

Result for api.elevenlabs.io: HTTP status `000`. The sandbox proxy refused the connection (`curl: (56) CONNECT tunnel failed, response 403`), so there was no response body. This host is not on the environment's network allowlist.

This environment's credential injection is set up for **api.elevenlabs.com** instead. The same request to https://api.elevenlabs.com/v1/models returned HTTP `502` with the body `upstream request failed`.

No env var with ELEVEN in its name exists in the session.

Likely fix: in the environment's settings, point the ElevenLabs credential and network rule at `api.elevenlabs.io`, the real API host, instead of `api.elevenlabs.com`.
