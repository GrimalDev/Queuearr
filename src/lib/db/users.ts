import { eq, count, asc, or, like } from 'drizzle-orm';
import { db } from './index';
import { users } from './schema';
import type { User, NewUser } from './schema';

export async function upsertUser(user: NewUser): Promise<{ user: User; isNew: boolean }> {
  const now = new Date();

  const existing = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  if (existing) {
    // Preserve existing role and active status on update — only update profile fields
    const { role: _role, active: _active, ...profileFields } = user;
    void _role;
    void _active;
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
    // First user ever becomes admin and is immediately active
    const [{ value: userCount }] = await db
      .select({ value: count() })
      .from(users);
    const isFirstUser = userCount === 0;
    const role = isFirstUser ? 'admin' : 'user';
    const active = isFirstUser;

    const insertData = {
      ...user,
      role,
      active,
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

export async function setUserActive(id: string, active: boolean): Promise<void> {
  await db.update(users).set({ active, updatedAt: new Date() }).where(eq(users.id, id));
}

export async function getAdminUserIds(): Promise<string[]> {
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  return admins.map((a) => a.id);
}

export async function deleteUser(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}
