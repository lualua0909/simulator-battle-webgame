// App users (Firebase Auth + Firestore `users/{uid}`): roles and CMS payloads.
import { z } from 'zod';

export const ROLE = { root: 0, admin: 1, user: 2 } as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];
export const ROLES: Role[] = [ROLE.root, ROLE.admin, ROLE.user];
export const ROLE_LABELS: Record<Role, string> = { 0: 'Root', 1: 'Admin', 2: 'Người dùng' };

export const USERS_COLLECTION = 'users';

export type AppUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: Role;
  providers: string[];
  disabled: boolean;
  fcmTokens: string[];
  /** epoch ms */
  createdAt: number | null;
  updatedAt: number | null;
  lastLoginAt: number | null;
  /** Last client ping (see /api/auth/ping). */
  lastActiveAt: number | null;
};

/** Signed-in clients ping the server this often. */
export const PING_INTERVAL_MS = 5 * 60_000;
/** A user is online while the server clock is within this long of their last ping. */
export const ONLINE_WINDOW_MS = 5 * 60_000;

export function isOnline(user: Pick<AppUser, 'lastActiveAt'>, serverNow: number): boolean {
  return user.lastActiveAt !== null && serverNow - user.lastActiveAt <= ONLINE_WINDOW_MS;
}

export function canAccessCms(user: Pick<AppUser, 'role' | 'disabled'> | null): boolean {
  return Boolean(user && !user.disabled && user.role <= ROLE.admin);
}

/** Root manages everyone; admin manages only normal users. Nobody edits themself through the CMS. */
export function canManage(actor: Pick<AppUser, 'uid' | 'role'>, target: Pick<AppUser, 'uid' | 'role'>): boolean {
  if (actor.uid === target.uid) return false;
  return actor.role === ROLE.root || actor.role < target.role;
}

/** Roles the actor may hand out. */
export function assignableRoles(actor: Pick<AppUser, 'role'>): Role[] {
  return actor.role === ROLE.root ? ROLES : ROLES.filter((r) => r > actor.role);
}

const roleSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const displayName = z.string().trim().max(64);

export const createUserSchema = z.object({
  email: z.email('email không hợp lệ').max(254),
  password: z.string().min(6, 'tối thiểu 6 ký tự').max(128),
  displayName: displayName.default(''),
  role: roleSchema.default(ROLE.user),
  disabled: z.boolean().default(false),
});

export const updateUserSchema = z.object({
  email: z.email('email không hợp lệ').max(254).optional(),
  password: z.string().min(6, 'tối thiểu 6 ký tự').max(128).optional(),
  displayName: displayName.optional(),
  role: roleSchema.optional(),
  disabled: z.boolean().optional(),
});

export const notifySchema = z.object({
  title: z.string().trim().min(1, 'bắt buộc').max(120),
  body: z.string().trim().max(1000).default(''),
});
