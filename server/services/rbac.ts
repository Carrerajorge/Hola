/**
 * Role-Based Access Control (RBAC) Service (#65)
 * Granular permissions system for enterprise-grade access control
 */

import { Request, Response, NextFunction } from 'express';

// Define permission types
type Permission =
    // Chat permissions
    | 'chat:read' | 'chat:create' | 'chat:edit' | 'chat:delete' | 'chat:share'
    // Message permissions
    | 'message:read' | 'message:create' | 'message:edit' | 'message:delete'
    // Document permissions
    | 'document:read' | 'document:create' | 'document:export' | 'document:delete'
    // Project permissions
    | 'project:read' | 'project:create' | 'project:edit' | 'project:delete' | 'project:share'
    // File permissions
    | 'file:upload' | 'file:download' | 'file:delete'
    // AI permissions
    | 'ai:chat' | 'ai:research' | 'ai:production' | 'ai:custom_prompts'
    // Settings permissions
    | 'settings:read' | 'settings:edit'
    // Admin permissions
    | 'admin:users' | 'admin:billing' | 'admin:analytics' | 'admin:settings' | 'admin:audit'
    // API permissions
    | 'api:read' | 'api:write' | 'api:admin';

// Define roles with their permissions
interface Role {
    name: string;
    description: string;
    permissions: Permission[];
    inherits?: string[];
}

const ROLES: Record<string, Role> = {
    guest: {
        name: 'Guest',
        description: 'Unauthenticated or limited access user',
        permissions: ['chat:read'],
    },

    free: {
        name: 'Free User',
        description: 'Basic free tier user',
        permissions: [
            'chat:read', 'chat:create', 'chat:edit', 'chat:delete',
            'message:read', 'message:create', 'message:edit', 'message:delete',
            'document:read',
            'file:upload', 'file:download',
            'ai:chat',
            'settings:read', 'settings:edit',
        ],
    },

    pro: {
        name: 'Pro User',
        description: 'Paid individual user',
        inherits: ['free'],
        permissions: [
            'chat:share',
            'document:create', 'document:export', 'document:delete',
            'project:read', 'project:create', 'project:edit', 'project:delete', 'project:share',
            'file:delete',
            'ai:research', 'ai:production', 'ai:custom_prompts',
            'api:read',
        ],
    },

    team_member: {
        name: 'Team Member',
        description: 'Member of a team/organization',
        inherits: ['pro'],
        permissions: [],
    },

    team_admin: {
        name: 'Team Admin',
        description: 'Administrator of a team/organization',
        inherits: ['team_member'],
        permissions: [
            'admin:users',
            'admin:analytics',
            'api:write',
        ],
    },

    admin: {
        name: 'System Admin',
        description: 'Full system administrator',
        inherits: ['team_admin'],
        permissions: [
            'admin:billing',
            'admin:settings',
            'admin:audit',
            'api:admin',
        ],
    },

    superadmin: {
        name: 'Super Admin',
        description: 'Unrestricted access',
        permissions: ['*'] as any, // All permissions
    },
};

// Cache for resolved permissions
const permissionCache = new Map<string, Set<Permission>>();

/**
 * Resolve all permissions for a role (including inherited)
 */
function resolveRolePermissions(roleName: string): Set<Permission> {
    // Check cache
    if (permissionCache.has(roleName)) {
        return permissionCache.get(roleName)!;
    }

    const role = ROLES[roleName];
    if (!role) {
        return new Set();
    }

    // Start with role's own permissions
    const permissions = new Set<Permission>(role.permissions as Permission[]);

    // Add inherited permissions
    if (role.inherits) {
        for (const parentRole of role.inherits) {
            const parentPermissions = resolveRolePermissions(parentRole);
            for (const perm of parentPermissions) {
                permissions.add(perm);
            }
        }
    }

    // Cache and return
    permissionCache.set(roleName, permissions);
    return permissions;
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(roleName: string, permission: Permission): boolean {
    const permissions = resolveRolePermissions(roleName);

    // Superadmin has all permissions
    if (permissions.has('*' as any)) {
        return true;
    }

    return permissions.has(permission);
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(roleName: string, requiredPermissions: Permission[]): boolean {
    return requiredPermissions.some(perm => hasPermission(roleName, perm));
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(roleName: string, requiredPermissions: Permission[]): boolean {
    return requiredPermissions.every(perm => hasPermission(roleName, perm));
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(roleName: string): Permission[] {
    return Array.from(resolveRolePermissions(roleName));
}

/**
 * Get all available roles
 */
export function getAllRoles(): { name: string; description: string }[] {
    return Object.entries(ROLES).map(([key, role]) => ({
        name: key,
        description: role.description,
    }));
}

/**
 * Express middleware for permission checking
 */
export function requirePermission(...permissions: Permission[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = (req as any).user;

        if (!user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED',
            });
        }

        const roleName = user.role || 'guest';

        if (!hasAllPermissions(roleName, permissions)) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                code: 'PERMISSION_DENIED',
                required: permissions,
                role: roleName,
            });
        }

        next();
    };
}

/**
 * Express middleware for requiring any of the permissions
 */
export function requireAnyPermission(...permissions: Permission[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = (req as any).user;

        if (!user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED',
            });
        }

        const roleName = user.role || 'guest';

        if (!hasAnyPermission(roleName, permissions)) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                code: 'PERMISSION_DENIED',
                requiredAny: permissions,
                role: roleName,
            });
        }

        next();
    };
}

/**
 * Express middleware for admin-only routes
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    const user = (req as any).user;

    if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const roleName = user.role || 'guest';

    if (!['admin', 'superadmin'].includes(roleName)) {
        return res.status(403).json({
            error: 'Admin access required',
            code: 'ADMIN_REQUIRED',
        });
    }

    next();
}

/**
 * Resource-level permission check (for sharing)
 */
interface ResourcePermission {
    resourceType: string;
    resourceId: string;
    userId: number;
    permission: 'read' | 'write' | 'admin';
}

// In-memory store for resource permissions (use DB in production)
const resourcePermissions = new Map<string, ResourcePermission[]>();

/**
 * Grant permission on a resource
 */
export function grantResourcePermission(
    resourceType: string,
    resourceId: string,
    userId: number,
    permission: 'read' | 'write' | 'admin'
): void {
    const key = `${resourceType}:${resourceId}`;
    const existing = resourcePermissions.get(key) || [];

    // Remove existing permission for this user
    const filtered = existing.filter(p => p.userId !== userId);

    // Add new permission
    filtered.push({ resourceType, resourceId, userId, permission });
    resourcePermissions.set(key, filtered);
}

/**
 * Revoke permission on a resource
 */
export function revokeResourcePermission(
    resourceType: string,
    resourceId: string,
    userId: number
): void {
    const key = `${resourceType}:${resourceId}`;
    const existing = resourcePermissions.get(key) || [];
    const filtered = existing.filter(p => p.userId !== userId);
    resourcePermissions.set(key, filtered);
}

/**
 * Check if user has permission on a resource
 */
export function hasResourcePermission(
    resourceType: string,
    resourceId: string,
    userId: number,
    requiredPermission: 'read' | 'write' | 'admin'
): boolean {
    const key = `${resourceType}:${resourceId}`;
    const permissions = resourcePermissions.get(key) || [];

    const userPerm = permissions.find(p => p.userId === userId);
    if (!userPerm) return false;

    // Permission hierarchy: admin > write > read
    const hierarchy: Record<string, number> = { read: 1, write: 2, admin: 3 };
    return hierarchy[userPerm.permission] >= hierarchy[requiredPermission];
}

/**
 * Get all users with access to a resource
 */
export function getResourcePermissions(
    resourceType: string,
    resourceId: string
): ResourcePermission[] {
    const key = `${resourceType}:${resourceId}`;
    return resourcePermissions.get(key) || [];
}
