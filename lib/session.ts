import { cookies } from "next/headers";
import { firebaseAdminAuth } from "@/lib/firebaseAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function getCurrentUser() {
  const sessionCookie = cookies().get("session")?.value;
  if (!sessionCookie) return null;

  const decoded = await firebaseAdminAuth.verifySessionCookie(sessionCookie).catch(() => null);
  if (!decoded) return null;

  const { data } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("firebase_uid", decoded.uid)
    .single();

  return data || null;
}
