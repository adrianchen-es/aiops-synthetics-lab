```
FROM .alerts-observability.*.alerts-*
| WHERE @timestamp > NOW() - 14 days
  AND kibana.alert.rule.name == "Custom Certificate Expiry"
| STATS fires = COUNT(*) BY tls.server.x509.subject.common_name
| WHERE fires > 1
| SORT fires DESC
```