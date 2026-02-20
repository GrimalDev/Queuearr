import NextAuth, { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PlexAuthClient } from '@/lib/api/plex';
import { upsertUser, getAdminUserIds } from '@/lib/db/users';
import { sendToUser } from '@/lib/push';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      plexToken: string;
      role: string;
    };
  }

  interface User {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    plexToken: string;
    role: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    plexToken?: string;
    id?: string;
    role?: string;
  }
}

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'plex',
      name: 'Plex',
      credentials: {
        authToken: { label: 'Auth Token', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.authToken) {
          return null;
        }

        try {
          const authToken = credentials.authToken as string;
          const plexClient = new PlexAuthClient(process.env.PLEX_CLIENT_ID);
          const plexUser = await plexClient.getUser(authToken);

          const serverMachineId = process.env.PLEX_SERVER_MACHINE_IDENTIFIER;
          if (!serverMachineId) {
            console.error('PLEX_SERVER_MACHINE_IDENTIFIER is required to restrict access');
            return null;
          }

           const hasAccess = await plexClient.validateServerAccess(authToken, serverMachineId);
           if (!hasAccess) {
             console.error('User does not have access to the configured Plex server');
             return null;
           }

           const { user: dbUser, isNew } = await upsertUser({
             id: plexUser.id.toString(),
             username: plexUser.username || plexUser.title || plexUser.id.toString(),
             email: plexUser.email,
             avatarUrl: plexUser.thumb,
             plexToken: authToken,
           });

           // Notify all admins when a new non-admin user registers
           if (isNew && dbUser.role !== 'admin') {
             getAdminUserIds().then((adminIds) =>
               Promise.allSettled(
                 adminIds.map((id) =>
                   sendToUser(id, {
                     title: 'New user registered',
                     body: `${dbUser.username} is waiting for approval`,
                     url: '/settings',
                     tag: 'new-user-registration',
                   })
                 )
               )
             ).catch(() => {});
           }

           const user = {
             id: dbUser.id,
             name: dbUser.username,
             email: dbUser.email,
             image: dbUser.avatarUrl,
             plexToken: authToken,
             role: dbUser.role,
           };

           return user;
        } catch (error) {
          console.error('Plex authentication error:', error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.plexToken = user.plexToken;
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.plexToken = token.plexToken as string;
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

export { authOptions as auth };
