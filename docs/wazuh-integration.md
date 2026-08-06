# Wazuh Integration Manual

This manual details the integration between Wazuh Manager and the Next.js dashboard using custom webhooks.

## 1. File Placement & Permissions

Copy the integration scripts to the Wazuh Manager integrations directory:

```bash
cp on-wazuh-server/custom-webhook /var/ossec/integrations/
cp on-wazuh-server/custom-webhook.py /var/ossec/integrations/
chmod 750 /var/ossec/integrations/custom-webhook
chmod 750 /var/ossec/integrations/custom-webhook.py
chown root:wazuh /var/ossec/integrations/custom-webhook
chown root:wazuh /var/ossec/integrations/custom-webhook.py
```

## 2. Environment Configuration

Copy `on-wazuh-server/custom-webhook.env.example` to an environment file or expose the environment variables globally to the Wazuh service:

```bash
export WAZUH_WEBHOOK_URL="https://dashboard.example.com/api/integrations/wazuh/alerts"
export WAZUH_WEBHOOK_SECRET="replace-with-your-hmac-secret-matching-backend"
```

## 3. Configure ossec.conf

Add the following block within your `/var/ossec/etc/ossec.conf` configuration on the Wazuh Manager:

```xml
<integration>
  <name>custom-webhook</name>
  <hook_url>local</hook_url>
  <level>3</level>
  <alert_format>json</alert_format>
</integration>
```

Restart the Wazuh manager to activate the integration:

```bash
systemctl restart wazuh-manager
```

## 4. Signature & Verification Architecture

When an alert trigger fires:
1. `custom-webhook` script delegates execution to `custom-webhook.py`.
2. Python script reads JSON alert from disk and serializes it deterministically (utf-8 bytes, no whitespace padding).
3. Computes HMAC-SHA256 digest using `WAZUH_WEBHOOK_SECRET` over raw alert bytes.
4. Posts raw payload to endpoint with headers `x-wazuh-timestamp` and `x-wazuh-signature`.
5. Dashboard backend verifies timestamp freshness against replay tolerance window (`WEBHOOK_REPLAY_WINDOW_SECONDS`), verifies signature using constant-time comparison, and records replay key hashes to block duplicate requests.
