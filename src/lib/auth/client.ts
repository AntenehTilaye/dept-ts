"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, organizationClient } from "better-auth/client/plugins";
import { ac, roles } from "./access";

// Browser client. The same access-control statement and roles are registered here and on the
// server plugin so permission helpers agree.
export const authClient = createAuthClient({
  plugins: [adminClient(), organizationClient({ ac, roles })],
});
