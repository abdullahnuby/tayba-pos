# B11 Audit Trail Policy

Google Sheets is the source of truth. Every successful state-changing API action is recorded in `AuditLog` after the business operation completes.

Tracked actions include sales, sale returns, customer/supplier payments, purchases, stock adjustments, register open/close, and generic mutations.

Fields: userId, action, entity, entityId, before, after, ip, createdAt.

Audit logging is best-effort and never rolls back a successful business transaction. Audit records are not themselves audited recursively.

Final release checks must verify that sensitive mutation endpoints create exactly one audit record and that ordinary read requests do not create audit records.
