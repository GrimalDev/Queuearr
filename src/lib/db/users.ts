import { eq, count, asc, or, like, and, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, invitedUsers } from '@/lib/db/schema';
import type { User, NewUser, InvitedUser, NewInvitedUser } from '@/lib/db/schema';
import { getInviteExpiresAt } from '@/lib/invite-policy';

export async function upsertUser(user: NewUser): Promise<{ user: User; isNew: boolean }> {
  const now = new Date();

  const existing = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  if (existing) {
    const { role: _role, ...profileFields } = user;
    void _role;
    const updateData = {
      ...profileFields,
      updatedAt: now,
    };
    await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, user.id));

    return {
      user: (await db.query.users.findFirst({
        where: eq(users.id, user.id),
      })) as User,
      isNew: false,
    };
  } else {
    const [{ value: userCount }] = await db
      .select({ value: count() })
      .from(users);
    const isFirstUser = userCount === 0;
    const role = isFirstUser ? 'admin' : 'user';

    const insertData = {
      ...user,
      role,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(users).values(insertData);

    return {
      user: (await db.query.users.findFirst({
        where: eq(users.id, user.id),
      })) as User,
      isNew: true,
    };
  }
}

export async function getUserById(id: string): Promise<User | undefined> {
  return db.query.users.findFirst({
    where: eq(users.id, id),
  });
}

export async function updateUser(
  id: string,
  data: Partial<NewUser>
): Promise<void> {
  const updateData = {
    ...data,
    updatedAt: new Date(),
  };
  await db
    .update(users)
    .set(updateData)
    .where(eq(users.id, id));
}

export async function getUsers(opts: {
  page: number;
  limit: number;
  search?: string;
}): Promise<{ users: User[]; total: number }> {
  const { page, limit, search } = opts;
  const offset = page * limit;

  const searchFilter = search
    ? or(
        like(users.username, `%${search}%`),
        like(users.email, `%${search}%`)
      )
    : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(searchFilter);

  const rows = await db
    .select()
    .from(users)
    .where(searchFilter)
    .orderBy(asc(users.createdAt))
    .limit(limit)
    .offset(offset);

  return { users: rows, total };
}

export async function setUserRole(id: string, role: string): Promise<void> {
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
}

export async function getAdminUserIds(): Promise<string[]> {
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  return admins.map((a) => a.id);
}

export async function deleteUser(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

export async function getUserByApiToken(token: string): Promise<User | undefined> {
  return db.query.users.findFirst({
    where: eq(users.apiToken, token),
  });
}

export async function regenerateUserApiToken(userId: string): Promise<string> {
  const token = crypto.randomUUID();
  await db
    .update(users)
    .set({ apiToken: token, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return token;
}

// ============================================================
// Invited Users (Whitelist) Functions
// ============================================================

function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getInvitedUserByEmail(email: string): Promise<InvitedUser | undefined> {
  const normalizedEmail = normalizeInviteEmail(email);
  return db.query.invitedUsers.findFirst({
    where: sql`lower(trim(${invitedUsers.email})) = ${normalizedEmail}`,
  });
}

export async function addInvitedUser(
  data: Omit<NewInvitedUser, 'id' | 'invitedAt'>
): Promise<InvitedUser> {
  const now = new Date();
  const normalizedEmail = normalizeInviteEmail(data.email);
  const insertData = {
    ...data,
    email: normalizedEmail,
    invitedAt: now,
  };
  await db.insert(invitedUsers).values(insertData);
  return db.query.invitedUsers.findFirst({
    where: eq(invitedUsers.email, insertData.email),
  }) as Promise<InvitedUser>;
}

export async function upsertInvitedUser(
  data: Omit<NewInvitedUser, 'id' | 'invitedAt'>
): Promise<InvitedUser> {
  const now = new Date();
  const normalizedEmail = normalizeInviteEmail(data.email);
  const serializedLibraryIds = data.librarySectionIds ?? null;

  await db
    .insert(invitedUsers)
    .values({
      ...data,
      email: normalizedEmail,
      librarySectionIds: serializedLibraryIds,
      invitedAt: now,
    })
    .onConflictDoUpdate({
      target: invitedUsers.email,
      set: {
        librarySectionIds: serializedLibraryIds,
        invitedBy: data.invitedBy,
        plexInviteSent: data.plexInviteSent ?? false,
        invitedAt: now,
      },
    });

  const invitedUser = await db.query.invitedUsers.findFirst({
    where: eq(invitedUsers.email, normalizedEmail),
  });

  if (!invitedUser) {
    throw new Error('Failed to upsert invited user');
  }

  return invitedUser;
}

export async function updateInvitedUser(
  email: string,
  data: Partial<NewInvitedUser>
): Promise<void> {
  const normalizedEmail = normalizeInviteEmail(email);
  await db
    .update(invitedUsers)
    .set(data)
    .where(eq(invitedUsers.email, normalizedEmail));
}

export async function deleteInvitedUser(email: string): Promise<void> {
  const normalizedEmail = normalizeInviteEmail(email);
  await db.delete(invitedUsers).where(sql`lower(trim(${invitedUsers.email})) = ${normalizedEmail}`);
}

export async function deleteRegisteredUserInvites(): Promise<void> {
  await db.delete(invitedUsers).where(sql`exists (
    select 1 from ${users}
    where lower(trim(${users.email})) = lower(trim(${invitedUsers.email}))
  )`);
}

export async function getAllInvitedUsers(): Promise<InvitedUser[]> {
  return db.select().from(invitedUsers);
}

export async function deleteUnchangedInvite(invite: InvitedUser): Promise<void> {
  // Do not remove an invite that was renewed while Plex was being queried.
  await db.delete(invitedUsers).where(and(
    eq(invitedUsers.id, invite.id),
    invite.invitedAt ? eq(invitedUsers.invitedAt, invite.invitedAt) : isNull(invitedUsers.invitedAt),
    invite.plexInviteSent === null
      ? isNull(invitedUsers.plexInviteSent)
      : eq(invitedUsers.plexInviteSent, invite.plexInviteSent),
  ));
}

export async function getInvitedUsers(opts: {
  page: number;
  limit: number;
}): Promise<{ invitedUsers: InvitedUser[]; total: number }> {
  const { page, limit } = opts;
  const offset = page * limit;

  const [{ total }] = await db
    .select({ total: count() })
    .from(invitedUsers);

  const rows = await db
    .select()
    .from(invitedUsers)
    .orderBy(asc(invitedUsers.invitedAt))
    .limit(limit)
    .offset(offset);

  return { invitedUsers: rows, total };
}

export async function isEmailInvited(email: string): Promise<boolean> {
  const normalizedEmail = normalizeInviteEmail(email);
  const invited = await db.query.invitedUsers.findFirst({
    where: eq(invitedUsers.email, normalizedEmail),
  });
  return !!invited && getInviteExpiresAt(invited.invitedAt).getTime() > Date.now();
}
