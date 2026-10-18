import type { Role } from "@/server/db/schema";

/**
 * Role capabilities. Server-side authorization calls `can()`; the UI only uses
 * it to hide controls, never as the enforcement point.
 */
export const PERMISSIONS = [
  "org.manage", // billing, branding, domains, deleting the org
  "members.manage",
  "clients.manage",
  "business.create",
  "business.edit",
  "business.view",
  "integrations.manage",
  "automations.manage",
  "content.create",
  "content.approve",
  "reviews.reply",
  "reviews.manage",
  "campaigns.manage",
  "media.manage",
  "media.approve",
  "website.edit",
  "website.publish",
  "reports.view",
  "reports.manage",
  "audits.run",
  "training.edit",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

const MATRIX: Record<Role, Set<Permission>> = {
  owner: ALL,
  admin: new Set(PERMISSIONS.filter((p) => p !== "org.manage")),
  member: new Set<Permission>([
    "business.edit",
    "business.view",
    "automations.manage",
    "content.create",
    "content.approve",
    "reviews.reply",
    "reviews.manage",
    "campaigns.manage",
    "media.manage",
    "media.approve",
    "website.edit",
    "website.publish",
    "reports.view",
    "reports.manage",
    "audits.run",
    "training.edit",
  ]),
  client_approver: new Set<Permission>(["business.view", "content.approve", "media.approve", "reports.view"]),
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.has(permission) ?? false;
}

export function permissionsFor(role: Role): Permission[] {
  return [...(MATRIX[role] ?? [])];
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Administrator",
  member: "Team member",
  client_approver: "Client approver",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full access including billing, branding and domains.",
  admin: "Manage team, clients, integrations and every business.",
  member: "Work on content, reviews, media, websites and reports.",
  client_approver: "View assigned businesses and approve or reject content.",
};
