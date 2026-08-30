# Implementation Summary

## Tenant document storage reconciliation

The backend currently contains two parallel tenant-document implementations:

- `tenantDocumentVaultStore`, used by the mounted tenant document vault router and the document-vault UI flow.
- `TenantDocumentRepository`, used by the currently unmounted `tenantDocuments` router and its service.

The presigned document router uses `tenantDocumentVaultStore`, but is also currently unmounted. Before changing production behavior, all erasure and export paths must be audited to ensure tenant documents and their underlying storage objects are covered.

### Recommendation

Treat `tenantDocumentVaultStore` as the canonical implementation because it backs the mounted vault HTTP surface. Remove the superseded router, repository, schema, service, and their exclusive tests only after confirming that no lease ingestion, erasure, export, migration, or background-job path still imports `TenantDocumentRepository` or `tenantDocumentService`. The presigned routes should either be mounted as part of the canonical vault API or removed if the mounted vault flow does not require them.

No functional reconciliation is implemented by this documentation-only change.
