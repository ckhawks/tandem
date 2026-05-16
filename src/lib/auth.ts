import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verify } from "@node-rs/argon2";
import { sql } from "./db";

declare module "next-auth" {
  interface Session {
    user: { id: string; email: string; name: string; isAdmin: boolean; color: string } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  pages: { signIn: "/login" },
  cookies: {
    sessionToken: {
      name: process.env.AUTH_COOKIE_NAME ?? "authjs.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;
        const [row] = await sql<{ id: string; email: string; display_name: string; password_hash: string; is_admin: boolean; color: string }[]>`
          SELECT id, email, display_name, password_hash, is_admin, color
          FROM tandem.users WHERE email = ${email} LIMIT 1`;
        if (!row) return null;
        const ok = await verify(row.password_hash, password);
        if (!ok) return null;
        return { id: row.id, email: row.email, name: row.display_name, isAdmin: row.is_admin, color: row.color };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.isAdmin = (user as { isAdmin: boolean }).isAdmin;
        token.color = (user as { color: string }).color;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.isAdmin = Boolean(token.isAdmin);
        session.user.color = (token.color as string) ?? "#888888";
      }
      return session;
    },
  },
});
