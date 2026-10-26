-- Migration: Add payment, deposit, application, and compliance permissions
-- Resolves issues #2019, #2021, and #1981

-- Add permissions for payment and deposit confirmation
INSERT INTO permissions (resource, action) VALUES
('payments', 'confirm'),
('deposits', 'confirm'),
('applications', 'view'),
('compliance', 'manage')
ON CONFLICT (resource, action) DO NOTHING;

-- Link finance role to payments:confirm and deposits:confirm
-- Finance admins are responsible for transaction confirmations
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'finance' AND (
    (p.resource = 'payments' AND p.action = 'confirm') OR
    (p.resource = 'deposits' AND p.action = 'confirm')
)
ON CONFLICT DO NOTHING;

-- Link operations role to payments:confirm, deposits:confirm, and applications:view
-- Operations role may also need to handle confirmations and view applications
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'operations' AND (
    (p.resource = 'payments' AND p.action = 'confirm') OR
    (p.resource = 'deposits' AND p.action = 'confirm') OR
    (p.resource = 'applications' AND p.action = 'view')
)
ON CONFLICT DO NOTHING;

-- Link support role to applications:view
-- Support agents may need to view application disputes
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'support' AND (
    (p.resource = 'applications' AND p.action = 'view')
)
ON CONFLICT DO NOTHING;

-- Link super_admin to compliance:manage
-- Super admins have full access to compliance reports
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'super_admin' AND (
    (p.resource = 'compliance' AND p.action = 'manage')
)
ON CONFLICT DO NOTHING;
