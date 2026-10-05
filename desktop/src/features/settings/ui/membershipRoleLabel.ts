/** Plain label for a relay membership role, or "" when the role is unknown. */
export function membershipRoleLabel(role: string | undefined) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "member") return "Member";
  return "";
}
