-- Ventas deja de ver el monitor técnico de correos (spec 2026-09-29 §5.2): sus avisos de correo no
-- entregado llegan a su bandeja. El seed sólo agrega permisos, así que el retiro va aquí.
DELETE FROM "role_permissions"
WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "key" = 'sales')
  AND "permissionId" IN (SELECT "id" FROM "permissions" WHERE "key" = 'notifications.read');
