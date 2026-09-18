import { describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/auth";
import { parseMemberRoles } from "@/lib/auth/access";
import { provisionUser, setMembershipRoles } from "@/platform/identity/provision";
import { syncMemberGrants } from "@/platform/identity/derive";
import { migratorDb, withDept } from "../../setup/db";
import { DEPT_CS, DEPT_EE } from "../../setup/seed-minimal";
import { uniqueSuffix } from "../../setup/factories";
import { SEED_PASSWORD } from "../../../prisma/seed/users";

async function grantsOf(userId: string, departmentId: string) {
  return withDept(departmentId, (tx) =>
    tx.roleGrant.findMany({
      where: { userId },
      include: { role: true },
      orderBy: { role: { key: "asc" } },
    }),
  );
}

describe("account provisioning", () => {
  it("creates a verified user, the membership and one derived department grant per role", async () => {
    const email = `new.${uniqueSuffix()}@deptts.local`;
    const res = await provisionUser({
      email,
      name: "New Person",
      departmentId: DEPT_CS,
      roleKeys: ["instructor", "deputy_head"],
      sendMail: false,
    });
    expect(res.created).toBe(true);
    const user = await migratorDb.user.findUnique({ where: { email } });
    expect(user).toMatchObject({ emailVerified: true, role: "user" });
    const member = await migratorDb.member.findFirst({
      where: { userId: res.userId, organizationId: DEPT_CS },
    });
    expect(parseMemberRoles(member?.role).sort()).toEqual(["deputy_head", "instructor"]);
    const grants = await grantsOf(res.userId, DEPT_CS);
    expect(grants.map((g) => [g.role.key, g.scopeType, g.source, g.validTo])).toEqual([
      ["deputy_head", "department", "derived", null],
      ["instructor", "department", "derived", null],
    ]);
  });

  it("is idempotent by email and merges roles on re-provisioning", async () => {
    const email = `again.${uniqueSuffix()}@deptts.local`;
    const first = await provisionUser({
      email,
      name: "A",
      departmentId: DEPT_CS,
      roleKeys: ["instructor"],
      sendMail: false,
    });
    const second = await provisionUser({
      email: email.toUpperCase(),
      name: "A",
      departmentId: DEPT_CS,
      roleKeys: ["student"],
      sendMail: false,
    });
    expect(second.created).toBe(false);
    expect(second.userId).toBe(first.userId);
    expect(second.roles.sort()).toEqual(["instructor", "student"]);
    expect(await migratorDb.user.count({ where: { email } })).toBe(1);
  });

  it("expires grants for removed roles and removes the membership on an empty list", async () => {
    const email = `roles.${uniqueSuffix()}@deptts.local`;
    const { userId } = await provisionUser({
      email,
      name: "R",
      departmentId: DEPT_CS,
      roleKeys: ["instructor", "student"],
      sendMail: false,
    });
    await setMembershipRoles(userId, DEPT_CS, ["instructor"]);
    let grants = await grantsOf(userId, DEPT_CS);
    expect(grants.find((g) => g.role.key === "student")?.validTo).toBeInstanceOf(Date);
    expect(grants.find((g) => g.role.key === "instructor")?.validTo).toBeNull();
    // re-adding reopens the same row instead of creating another
    await setMembershipRoles(userId, DEPT_CS, ["instructor", "student"]);
    grants = await grantsOf(userId, DEPT_CS);
    expect(grants).toHaveLength(2);
    expect(grants.every((g) => g.validTo === null)).toBe(true);
    await setMembershipRoles(userId, DEPT_CS, []);
    expect(await migratorDb.member.count({ where: { userId, organizationId: DEPT_CS } })).toBe(0);
    grants = await grantsOf(userId, DEPT_CS);
    expect(grants.every((g) => g.validTo !== null)).toBe(true);
  });

  it("keeps grants per department: membership in EE never touches CS grants", async () => {
    const email = `two.${uniqueSuffix()}@deptts.local`;
    const { userId } = await provisionUser({
      email,
      name: "T",
      departmentId: DEPT_CS,
      roleKeys: ["instructor"],
      sendMail: false,
    });
    await provisionUser({
      email,
      name: "T",
      departmentId: DEPT_EE,
      roleKeys: ["department_head"],
      sendMail: false,
    });
    expect((await grantsOf(userId, DEPT_CS)).map((g) => g.role.key)).toEqual(["instructor"]);
    expect((await grantsOf(userId, DEPT_EE)).map((g) => g.role.key)).toEqual(["department_head"]);
    await syncMemberGrants(userId, DEPT_EE);
    expect((await grantsOf(userId, DEPT_CS)).map((g) => g.role.key)).toEqual(["instructor"]);
  });

  it("seeded users can sign in with the seed password and unknown emails cannot", async () => {
    const ok = await auth.api.signInEmail({
      body: { email: "dh.cs@deptts.local", password: SEED_PASSWORD },
    });
    expect(ok.user.email).toBe("dh.cs@deptts.local");
    await expect(
      auth.api.signInEmail({ body: { email: "dh.cs@deptts.local", password: "wrong-password-1" } }),
    ).rejects.toThrow();
    await expect(
      auth.api.signUpEmail({
        body: { email: "self@deptts.local", password: "Passw0rd!dev", name: "x" },
      }),
    ).rejects.toThrow();
  });
});
