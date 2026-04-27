```
FROM synthetics-*,*:synthetics-*
| WHERE tls.server.x509.not_before IS NOT NULL
    AND tls.server.x509.not_after IS NOT NULL
    AND tls.server.x509.subject.common_name IS NOT NULL
| STATS
    record_count = COUNT(*),
    tls.server.x509.not_after = MAX(tls.server.x509.not_after),
    tls.server.x509.not_before = MIN(tls.server.x509.not_before),
    monitor.name = VALUES(monitor.name),
    @timestamp = MAX(@timestamp)
  BY tls.server.x509.subject.common_name, tags
| WHERE NOW() + 30d > tls.server.x509.not_after
    OR tls.server.x509.not_before > NOW()
| EVAL days_until_expiry = DATE_DIFF("days",
    tls.server.x509.not_before,
    tls.server.x509.not_after)
| KEEP @timestamp, tls.server.x509.subject.common_name,
       tls.server.x509.not_before, tls.server.x509.not_after,
       monitor.name, tags, days_until_expiry
| SORT @timestamp
| LIMIT 1000
```