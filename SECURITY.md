# Security Policy

If you find a security issue, please avoid opening a public issue with exploit details.

Use the repository's **Security** tab to open a private vulnerability report. If
private reporting is unavailable, contact the repository owner through GitHub
without including exploit details in a public issue.

Include:

- affected component
- impact summary
- reproduction outline
- any temporary mitigation you recommend

Please do not include secrets or live credentials in reports.

## Supported deployment boundary

The supported public deployment uses `compose.yaml`: Caddy is the only
internet-facing service, the PolicyGOS API requires named bearer tokens, and
the OCR service is reachable only on the Compose network. Exposing the OCR
container port directly is not a supported production configuration.
