# pi-zellij-tab-status

## 0.7.3

- Check all maintained TypeScript source, tests and tooling with strict non-emitting typechecks and zero-warning type-aware lint.
- Replace unchecked external-value assertions with validated `unknown` inputs and convert maintained JavaScript test helpers to TypeScript.
- Enforce no-any, unsafe-operation and suppression checks with negative fixtures in local commands and CI; preserve status publication and isolated E2E behavior.

## 0.7.2

- Track Tintin's queued/running work through a session-scoped manager observation.
- Keep known terminal reports working until their consumption is verified, without consuming results on the user's behalf.
- Detect silent queued cancellations and retain uncertain ownership until session reset.

## 0.7.1

- Include version-matched release notes for Pi 1.5 extension update notices.
