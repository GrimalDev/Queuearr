import { eq, count, asc, or, like } from 'drizzle-orm';
import { db } from './index';
import { users } from './schema';
import type { User, NewUser } from './schema';

export async function upsertUser(user: NewUser): Promise<User> {
  const now = new Date();

  const existing = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  if (existing) {
    // Preserve existing role on update — only update profile fields
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

    return (await db.query.users.findFirst({
      where: eq(users.id, user.id),
    })) as User;
  } else {
    // First user ever becomes admin
    const [{ value: userCount }] = await db
      .select({ value: count() })
      .from(users);
    const role = userCount === 0 ? 'admin' : 'user';

    const insertData = {
      ...user,
      role,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(users).values(insertData);

    return (await db.query.users.findFirst({
      where: eq(users.id, user.id),
    })) as User;
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

export async function deleteUser(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}
