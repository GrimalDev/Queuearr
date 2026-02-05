import { eq } from 'drizzle-orm';
import { db } from './index';
import { users } from './schema';
import type { User, NewUser } from './schema';

export async function upsertUser(user: NewUser): Promise<User> {
  const now = new Date();

  const existing = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  if (existing) {
    const updateData = {
      ...user,
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
    const insertData = {
      ...user,
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
